-- Update 2: E-Mail-Änderung durch den Admin (wird von auth.users nach profiles übernommen).
-- Einmal im Supabase SQL Editor ausführen (gefahrlos wiederholbar).

create or replace function public.protect_profile() returns trigger
language plpgsql as $$
begin
  new.id := old.id; new.role := old.role;
  if pg_trigger_depth() < 2 then new.email := old.email; end if;   -- E-Mail nur über den Abgleich aus auth.users änderbar
  if old.role = 'admin' then new.status := 'active'; end if;
  return new;
end $$;

create or replace function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function public.sync_profile_email();
