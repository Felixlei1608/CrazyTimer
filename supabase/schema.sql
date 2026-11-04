-- =====================================================================
-- CrazyTimer / Zeitfluss – Datenbank für Supabase (Projekt "CrazyTime")
-- Einfügen in: Supabase → SQL Editor → New query → Run
-- VORHER unten bei app_settings die Admin-E-Mail eintragen!
-- Der Zugriffsschutz (wer was sehen/ändern darf) liegt hier in der Datenbank
-- (Row Level Security), nicht im Browser.
-- =====================================================================

-- ---------- Einstellungen (nur für Trigger lesbar, nicht für Clients) ----------
create table if not exists public.app_settings (key text primary key, value text not null);
alter table public.app_settings enable row level security;          -- keine Policy = kein Client-Zugriff
insert into public.app_settings (key, value) values ('admin_email', 'DEINE@EMAIL.AT')   -- <<< HIER ÄNDERN
on conflict (key) do nothing;

-- ---------- Tabellen ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  role text not null default 'user' check (role in ('admin','user')),
  status text not null default 'pending' check (status in ('active','pending','disabled')),
  department text not null default '',
  weekly_hours numeric(4,1) not null default 38.5 check (weekly_hours >= 0),
  vacation_days numeric(4,1) not null default 25 check (vacation_days >= 0),
  work_days text not null default '1,2,3,4,5',
  start_date date not null default current_date,
  opening_balance numeric(7,2) not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists one_admin on public.profiles (role) where role = 'admin';   -- es gibt genau einen Admin

create table if not exists public.projects (
  id bigint generated always as identity primary key,
  name text not null,
  color text not null default '#0a84ff',
  archived boolean not null default false
);

-- Arbeit, Pause, Arzt/Behördenweg (Ortszeit, ohne Zeitzone). Arbeit und Arzt zählen als Ist, Pause nicht.
create table if not exists public.time_entries (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'arbeit' check (kind in ('arbeit','pause','arzt')),
  project_id bigint references public.projects(id) on delete set null,
  description text not null default '' check (char_length(description) <= 255),
  location text not null default 'Büro',
  start_at timestamp not null,
  end_at timestamp,                                   -- null = Timer läuft
  check (end_at is null or end_at > start_at)
);
create index if not exists idx_entries_user_start on public.time_entries (user_id, start_at);

create table if not exists public.absences (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('urlaub','krank','sonderurlaub','zeitausgleich')),
  date_from date not null,
  date_to date not null,
  note text not null default '' check (char_length(note) <= 255),
  status text not null default 'beantragt' check (status in ('beantragt','genehmigt','abgelehnt')),
  created_at timestamptz not null default now(),
  check (date_to >= date_from)
);
create index if not exists idx_absences_user on public.absences (user_id, date_from);

create table if not exists public.holidays (date date primary key, name text not null);

create table if not exists public.month_locks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  ym text not null check (ym ~ '^\d{4}-\d{2}$'),
  primary key (user_id, ym)
);

-- ---------- Hilfsfunktionen ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active');
$$;
create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;
-- Monat ist beschreibbar: Admin immer, sonst nur wenn der Admin den Monat nicht freigegeben (gesperrt) hat
create or replace function public.month_open(uid uuid, ts timestamp) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or not exists (select 1 from public.month_locks l where l.user_id = uid and l.ym = to_char(ts, 'YYYY-MM'));
$$;

-- ---------- Trigger ----------
-- Neues Konto: Admin wird nur die E-Mail aus app_settings (solange es noch keinen Admin gibt), alle anderen warten auf Freischaltung
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare make_admin boolean; ae text;
begin
  select value into ae from public.app_settings where key = 'admin_email';
  make_admin := not exists (select 1 from public.profiles where role = 'admin')
                and (coalesce(ae, '') = '' or lower(ae) = lower(new.email));
  insert into public.profiles (id, email, name, role, status, start_date)
  values (new.id, new.email, coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1)),
          case when make_admin then 'admin' else 'user' end, case when make_admin then 'active' else 'pending' end, current_date);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Rolle, ID und E-Mail lassen sich nie ändern, der Admin bleibt immer aktiv
create or replace function public.protect_profile() returns trigger
language plpgsql as $$
begin
  new.id := old.id; new.email := old.email; new.role := old.role;
  if old.role = 'admin' then new.status := 'active'; end if;
  return new;
end $$;
drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before update on public.profiles for each row execute function public.protect_profile();

-- Krankenstand und Einträge des Admins gelten sofort, Urlaub/Sonderurlaub/Zeitausgleich sind Anträge
create or replace function public.absence_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.status := case when public.is_admin() or new.type = 'krank' then 'genehmigt' else 'beantragt' end;
  return new;
end $$;
drop trigger if exists absence_defaults on public.absences;
create trigger absence_defaults before insert on public.absences for each row execute function public.absence_defaults();

-- ---------- Zugriffsregeln (Row Level Security) ----------
alter table public.profiles     enable row level security;
alter table public.projects     enable row level security;
alter table public.time_entries enable row level security;
alter table public.absences     enable row level security;
alter table public.holidays     enable row level security;
alter table public.month_locks  enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated using (public.is_active());
drop policy if exists projects_write on public.projects;
create policy projects_write on public.projects for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists entries_select on public.time_entries;
create policy entries_select on public.time_entries for select to authenticated using (public.is_active() and (user_id = auth.uid() or public.is_admin()));
drop policy if exists entries_insert on public.time_entries;
create policy entries_insert on public.time_entries for insert to authenticated
  with check (public.is_active() and (public.is_admin() or (user_id = auth.uid() and public.month_open(user_id, start_at))));
drop policy if exists entries_update on public.time_entries;
create policy entries_update on public.time_entries for update to authenticated
  using (public.is_active() and (public.is_admin() or (user_id = auth.uid() and public.month_open(user_id, start_at))))
  with check (public.is_active() and (public.is_admin() or (user_id = auth.uid() and public.month_open(user_id, start_at))));
drop policy if exists entries_delete on public.time_entries;
create policy entries_delete on public.time_entries for delete to authenticated
  using (public.is_active() and (public.is_admin() or (user_id = auth.uid() and public.month_open(user_id, start_at))));

drop policy if exists absences_select on public.absences;
create policy absences_select on public.absences for select to authenticated using (public.is_active() and (user_id = auth.uid() or public.is_admin()));
drop policy if exists absences_insert on public.absences;
create policy absences_insert on public.absences for insert to authenticated
  with check (public.is_active() and (public.is_admin() or (user_id = auth.uid() and public.month_open(user_id, date_from::timestamp))));
drop policy if exists absences_update on public.absences;
create policy absences_update on public.absences for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists absences_delete on public.absences;
create policy absences_delete on public.absences for delete to authenticated
  using (public.is_admin() or (user_id = auth.uid() and status = 'beantragt' and public.is_active()));

drop policy if exists holidays_select on public.holidays;
create policy holidays_select on public.holidays for select to authenticated using (public.is_active());

drop policy if exists locks_select on public.month_locks;
create policy locks_select on public.month_locks for select to authenticated using (public.is_active() and (user_id = auth.uid() or public.is_admin()));
drop policy if exists locks_write on public.month_locks;
create policy locks_write on public.month_locks for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Rechte: nur angemeldete Benutzer, anonym nichts
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on public.profiles, public.projects, public.time_entries, public.absences, public.month_locks to authenticated;
grant select on public.holidays to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------- Feiertage Österreich 2024–2045 ----------
insert into public.holidays (date, name) values
  ('2024-01-01','Neujahr'),
  ('2024-01-06','Heilige Drei Könige'),
  ('2024-04-01','Ostermontag'),
  ('2024-05-01','Staatsfeiertag'),
  ('2024-05-09','Christi Himmelfahrt'),
  ('2024-05-20','Pfingstmontag'),
  ('2024-05-30','Fronleichnam'),
  ('2024-08-15','Mariä Himmelfahrt'),
  ('2024-10-26','Nationalfeiertag'),
  ('2024-11-01','Allerheiligen'),
  ('2024-12-08','Mariä Empfängnis'),
  ('2024-12-25','Christtag'),
  ('2024-12-26','Stefanitag'),
  ('2025-01-01','Neujahr'),
  ('2025-01-06','Heilige Drei Könige'),
  ('2025-04-21','Ostermontag'),
  ('2025-05-01','Staatsfeiertag'),
  ('2025-05-29','Christi Himmelfahrt'),
  ('2025-06-09','Pfingstmontag'),
  ('2025-06-19','Fronleichnam'),
  ('2025-08-15','Mariä Himmelfahrt'),
  ('2025-10-26','Nationalfeiertag'),
  ('2025-11-01','Allerheiligen'),
  ('2025-12-08','Mariä Empfängnis'),
  ('2025-12-25','Christtag'),
  ('2025-12-26','Stefanitag'),
  ('2026-01-01','Neujahr'),
  ('2026-01-06','Heilige Drei Könige'),
  ('2026-04-06','Ostermontag'),
  ('2026-05-01','Staatsfeiertag'),
  ('2026-05-14','Christi Himmelfahrt'),
  ('2026-05-25','Pfingstmontag'),
  ('2026-06-04','Fronleichnam'),
  ('2026-08-15','Mariä Himmelfahrt'),
  ('2026-10-26','Nationalfeiertag'),
  ('2026-11-01','Allerheiligen'),
  ('2026-12-08','Mariä Empfängnis'),
  ('2026-12-25','Christtag'),
  ('2026-12-26','Stefanitag'),
  ('2027-01-01','Neujahr'),
  ('2027-01-06','Heilige Drei Könige'),
  ('2027-03-29','Ostermontag'),
  ('2027-05-01','Staatsfeiertag'),
  ('2027-05-06','Christi Himmelfahrt'),
  ('2027-05-17','Pfingstmontag'),
  ('2027-05-27','Fronleichnam'),
  ('2027-08-15','Mariä Himmelfahrt'),
  ('2027-10-26','Nationalfeiertag'),
  ('2027-11-01','Allerheiligen'),
  ('2027-12-08','Mariä Empfängnis'),
  ('2027-12-25','Christtag'),
  ('2027-12-26','Stefanitag'),
  ('2028-01-01','Neujahr'),
  ('2028-01-06','Heilige Drei Könige'),
  ('2028-04-17','Ostermontag'),
  ('2028-05-01','Staatsfeiertag'),
  ('2028-05-25','Christi Himmelfahrt'),
  ('2028-06-05','Pfingstmontag'),
  ('2028-06-15','Fronleichnam'),
  ('2028-08-15','Mariä Himmelfahrt'),
  ('2028-10-26','Nationalfeiertag'),
  ('2028-11-01','Allerheiligen'),
  ('2028-12-08','Mariä Empfängnis'),
  ('2028-12-25','Christtag'),
  ('2028-12-26','Stefanitag'),
  ('2029-01-01','Neujahr'),
  ('2029-01-06','Heilige Drei Könige'),
  ('2029-04-02','Ostermontag'),
  ('2029-05-01','Staatsfeiertag'),
  ('2029-05-10','Christi Himmelfahrt'),
  ('2029-05-21','Pfingstmontag'),
  ('2029-05-31','Fronleichnam'),
  ('2029-08-15','Mariä Himmelfahrt'),
  ('2029-10-26','Nationalfeiertag'),
  ('2029-11-01','Allerheiligen'),
  ('2029-12-08','Mariä Empfängnis'),
  ('2029-12-25','Christtag'),
  ('2029-12-26','Stefanitag'),
  ('2030-01-01','Neujahr'),
  ('2030-01-06','Heilige Drei Könige'),
  ('2030-04-22','Ostermontag'),
  ('2030-05-01','Staatsfeiertag'),
  ('2030-05-30','Christi Himmelfahrt'),
  ('2030-06-10','Pfingstmontag'),
  ('2030-06-20','Fronleichnam'),
  ('2030-08-15','Mariä Himmelfahrt'),
  ('2030-10-26','Nationalfeiertag'),
  ('2030-11-01','Allerheiligen'),
  ('2030-12-08','Mariä Empfängnis'),
  ('2030-12-25','Christtag'),
  ('2030-12-26','Stefanitag'),
  ('2031-01-01','Neujahr'),
  ('2031-01-06','Heilige Drei Könige'),
  ('2031-04-14','Ostermontag'),
  ('2031-05-01','Staatsfeiertag'),
  ('2031-05-22','Christi Himmelfahrt'),
  ('2031-06-02','Pfingstmontag'),
  ('2031-06-12','Fronleichnam'),
  ('2031-08-15','Mariä Himmelfahrt'),
  ('2031-10-26','Nationalfeiertag'),
  ('2031-11-01','Allerheiligen'),
  ('2031-12-08','Mariä Empfängnis'),
  ('2031-12-25','Christtag'),
  ('2031-12-26','Stefanitag'),
  ('2032-01-01','Neujahr'),
  ('2032-01-06','Heilige Drei Könige'),
  ('2032-03-29','Ostermontag'),
  ('2032-05-01','Staatsfeiertag'),
  ('2032-05-06','Christi Himmelfahrt'),
  ('2032-05-17','Pfingstmontag'),
  ('2032-05-27','Fronleichnam'),
  ('2032-08-15','Mariä Himmelfahrt'),
  ('2032-10-26','Nationalfeiertag'),
  ('2032-11-01','Allerheiligen'),
  ('2032-12-08','Mariä Empfängnis'),
  ('2032-12-25','Christtag'),
  ('2032-12-26','Stefanitag'),
  ('2033-01-01','Neujahr'),
  ('2033-01-06','Heilige Drei Könige'),
  ('2033-04-18','Ostermontag'),
  ('2033-05-01','Staatsfeiertag'),
  ('2033-05-26','Christi Himmelfahrt'),
  ('2033-06-06','Pfingstmontag'),
  ('2033-06-16','Fronleichnam'),
  ('2033-08-15','Mariä Himmelfahrt'),
  ('2033-10-26','Nationalfeiertag'),
  ('2033-11-01','Allerheiligen'),
  ('2033-12-08','Mariä Empfängnis'),
  ('2033-12-25','Christtag'),
  ('2033-12-26','Stefanitag'),
  ('2034-01-01','Neujahr'),
  ('2034-01-06','Heilige Drei Könige'),
  ('2034-04-10','Ostermontag'),
  ('2034-05-01','Staatsfeiertag'),
  ('2034-05-18','Christi Himmelfahrt'),
  ('2034-05-29','Pfingstmontag'),
  ('2034-06-08','Fronleichnam'),
  ('2034-08-15','Mariä Himmelfahrt'),
  ('2034-10-26','Nationalfeiertag'),
  ('2034-11-01','Allerheiligen'),
  ('2034-12-08','Mariä Empfängnis'),
  ('2034-12-25','Christtag'),
  ('2034-12-26','Stefanitag'),
  ('2035-01-01','Neujahr'),
  ('2035-01-06','Heilige Drei Könige'),
  ('2035-03-26','Ostermontag'),
  ('2035-05-01','Staatsfeiertag'),
  ('2035-05-03','Christi Himmelfahrt'),
  ('2035-05-14','Pfingstmontag'),
  ('2035-05-24','Fronleichnam'),
  ('2035-08-15','Mariä Himmelfahrt'),
  ('2035-10-26','Nationalfeiertag'),
  ('2035-11-01','Allerheiligen'),
  ('2035-12-08','Mariä Empfängnis'),
  ('2035-12-25','Christtag'),
  ('2035-12-26','Stefanitag'),
  ('2036-01-01','Neujahr'),
  ('2036-01-06','Heilige Drei Könige'),
  ('2036-04-14','Ostermontag'),
  ('2036-05-01','Staatsfeiertag'),
  ('2036-05-22','Christi Himmelfahrt'),
  ('2036-06-02','Pfingstmontag'),
  ('2036-06-12','Fronleichnam'),
  ('2036-08-15','Mariä Himmelfahrt'),
  ('2036-10-26','Nationalfeiertag'),
  ('2036-11-01','Allerheiligen'),
  ('2036-12-08','Mariä Empfängnis'),
  ('2036-12-25','Christtag'),
  ('2036-12-26','Stefanitag'),
  ('2037-01-01','Neujahr'),
  ('2037-01-06','Heilige Drei Könige'),
  ('2037-04-06','Ostermontag'),
  ('2037-05-01','Staatsfeiertag'),
  ('2037-05-14','Christi Himmelfahrt'),
  ('2037-05-25','Pfingstmontag'),
  ('2037-06-04','Fronleichnam'),
  ('2037-08-15','Mariä Himmelfahrt'),
  ('2037-10-26','Nationalfeiertag'),
  ('2037-11-01','Allerheiligen'),
  ('2037-12-08','Mariä Empfängnis'),
  ('2037-12-25','Christtag'),
  ('2037-12-26','Stefanitag'),
  ('2038-01-01','Neujahr'),
  ('2038-01-06','Heilige Drei Könige'),
  ('2038-04-26','Ostermontag'),
  ('2038-05-01','Staatsfeiertag'),
  ('2038-06-03','Christi Himmelfahrt'),
  ('2038-06-14','Pfingstmontag'),
  ('2038-06-24','Fronleichnam'),
  ('2038-08-15','Mariä Himmelfahrt'),
  ('2038-10-26','Nationalfeiertag'),
  ('2038-11-01','Allerheiligen'),
  ('2038-12-08','Mariä Empfängnis'),
  ('2038-12-25','Christtag'),
  ('2038-12-26','Stefanitag'),
  ('2039-01-01','Neujahr'),
  ('2039-01-06','Heilige Drei Könige'),
  ('2039-04-11','Ostermontag'),
  ('2039-05-01','Staatsfeiertag'),
  ('2039-05-19','Christi Himmelfahrt'),
  ('2039-05-30','Pfingstmontag'),
  ('2039-06-09','Fronleichnam'),
  ('2039-08-15','Mariä Himmelfahrt'),
  ('2039-10-26','Nationalfeiertag'),
  ('2039-11-01','Allerheiligen'),
  ('2039-12-08','Mariä Empfängnis'),
  ('2039-12-25','Christtag'),
  ('2039-12-26','Stefanitag'),
  ('2040-01-01','Neujahr'),
  ('2040-01-06','Heilige Drei Könige'),
  ('2040-04-02','Ostermontag'),
  ('2040-05-01','Staatsfeiertag'),
  ('2040-05-10','Christi Himmelfahrt'),
  ('2040-05-21','Pfingstmontag'),
  ('2040-05-31','Fronleichnam'),
  ('2040-08-15','Mariä Himmelfahrt'),
  ('2040-10-26','Nationalfeiertag'),
  ('2040-11-01','Allerheiligen'),
  ('2040-12-08','Mariä Empfängnis'),
  ('2040-12-25','Christtag'),
  ('2040-12-26','Stefanitag'),
  ('2041-01-01','Neujahr'),
  ('2041-01-06','Heilige Drei Könige'),
  ('2041-04-22','Ostermontag'),
  ('2041-05-01','Staatsfeiertag'),
  ('2041-05-30','Christi Himmelfahrt'),
  ('2041-06-10','Pfingstmontag'),
  ('2041-06-20','Fronleichnam'),
  ('2041-08-15','Mariä Himmelfahrt'),
  ('2041-10-26','Nationalfeiertag'),
  ('2041-11-01','Allerheiligen'),
  ('2041-12-08','Mariä Empfängnis'),
  ('2041-12-25','Christtag'),
  ('2041-12-26','Stefanitag'),
  ('2042-01-01','Neujahr'),
  ('2042-01-06','Heilige Drei Könige'),
  ('2042-04-07','Ostermontag'),
  ('2042-05-01','Staatsfeiertag'),
  ('2042-05-15','Christi Himmelfahrt'),
  ('2042-05-26','Pfingstmontag'),
  ('2042-06-05','Fronleichnam'),
  ('2042-08-15','Mariä Himmelfahrt'),
  ('2042-10-26','Nationalfeiertag'),
  ('2042-11-01','Allerheiligen'),
  ('2042-12-08','Mariä Empfängnis'),
  ('2042-12-25','Christtag'),
  ('2042-12-26','Stefanitag'),
  ('2043-01-01','Neujahr'),
  ('2043-01-06','Heilige Drei Könige'),
  ('2043-03-30','Ostermontag'),
  ('2043-05-01','Staatsfeiertag'),
  ('2043-05-07','Christi Himmelfahrt'),
  ('2043-05-18','Pfingstmontag'),
  ('2043-05-28','Fronleichnam'),
  ('2043-08-15','Mariä Himmelfahrt'),
  ('2043-10-26','Nationalfeiertag'),
  ('2043-11-01','Allerheiligen'),
  ('2043-12-08','Mariä Empfängnis'),
  ('2043-12-25','Christtag'),
  ('2043-12-26','Stefanitag'),
  ('2044-01-01','Neujahr'),
  ('2044-01-06','Heilige Drei Könige'),
  ('2044-04-18','Ostermontag'),
  ('2044-05-01','Staatsfeiertag'),
  ('2044-05-26','Christi Himmelfahrt'),
  ('2044-06-06','Pfingstmontag'),
  ('2044-06-16','Fronleichnam'),
  ('2044-08-15','Mariä Himmelfahrt'),
  ('2044-10-26','Nationalfeiertag'),
  ('2044-11-01','Allerheiligen'),
  ('2044-12-08','Mariä Empfängnis'),
  ('2044-12-25','Christtag'),
  ('2044-12-26','Stefanitag'),
  ('2045-01-01','Neujahr'),
  ('2045-01-06','Heilige Drei Könige'),
  ('2045-04-10','Ostermontag'),
  ('2045-05-01','Staatsfeiertag'),
  ('2045-05-18','Christi Himmelfahrt'),
  ('2045-05-29','Pfingstmontag'),
  ('2045-06-08','Fronleichnam'),
  ('2045-08-15','Mariä Himmelfahrt'),
  ('2045-10-26','Nationalfeiertag'),
  ('2045-11-01','Allerheiligen'),
  ('2045-12-08','Mariä Empfängnis'),
  ('2045-12-25','Christtag'),
  ('2045-12-26','Stefanitag')
on conflict (date) do nothing;
