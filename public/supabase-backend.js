/* Supabase-Anbindung: setzt window.API_OVERRIDE, damit die App ihre /api-Aufrufe über Supabase (Postgres + Auth) ausführt.
   Der Schutz (wer was darf) liegt in den Row-Level-Security-Regeln in supabase/schema.sql. Hier steht nur der öffentliche anon-Key. */
(function () {
  window.SUPABASE_MODE = true;
  const sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const nowS = () => { const d = new Date(); return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const NICE = { '42501': 'Keine Berechtigung, oder der Monat wurde vom Admin gesperrt', '23514': 'Bitte Eingaben prüfen (z. B. Ende nach Start)', '23505': 'Existiert bereits', 'PGRST116': 'Nicht gefunden' };
  const chk = e => { if (e) throw fail(e.code === '42501' ? 403 : 400, NICE[e.code] || e.message || 'Fehler'); };
  const num = v => (v === '' || v == null ? null : +v);

  async function me() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw fail(401, 'Nicht angemeldet');
    const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).single(); chk(error);
    if (data.status !== 'active') { await sb.auth.signOut(); throw fail(401, 'Nicht angemeldet'); }
    return data;
  }
  async function fn(body) {           // Edge Function "admin-users" (Konto anlegen / Passwort setzen), nur für den Admin
    const { data, error } = await sb.functions.invoke('admin-users', { body });
    if (error) { let msg = 'Die Funktion „admin-users“ ist nicht erreichbar. Wurde sie in Supabase veröffentlicht?'; try { msg = (await error.context.json()).error || msg; } catch (e) { } throw fail(400, msg); }
    if (data && data.error) throw fail(400, data.error);
    return data;
  }
  async function all(build) {          // holt auch mehr als 1000 Zeilen (PostgREST-Limit)
    let out = [], from = 0;
    for (;;) { const { data, error } = await build().range(from, from + 999); chk(error); out = out.concat(data); if (data.length < 1000) return out; from += 1000; }
  }
  const nextDay = s => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + 1); return ymd(d); };
  const entryRow = (b, uid) => ({ user_id: uid, kind: b.kind, project_id: b.kind === 'arbeit' ? num(b.project_id) : null, description: b.kind === 'arbeit' ? (b.description || '') : '', location: b.location || 'Büro', start_at: b.start_at, end_at: b.end_at || null });

  window.API_OVERRIDE = async function (method, url, body = {}) {
    const [path, qs] = url.split('?'), q = Object.fromEntries(new URLSearchParams(qs || '')), m = re => path.match(re);
    let x;
    if (method === 'POST' && path === '/login') {
      const { error } = await sb.auth.signInWithPassword({ email: String(body.email || '').trim(), password: body.password || '' });
      if (error) throw fail(401, /confirm/i.test(error.message) ? 'Bitte zuerst die E-Mail-Adresse bestätigen (Mail prüfen)' : 'E-Mail oder Passwort stimmt nicht');
      const { data: { session } } = await sb.auth.getSession();
      const { data: p, error: e2 } = await sb.from('profiles').select('*').eq('id', session.user.id).single(); chk(e2);
      if (p.status !== 'active') { await sb.auth.signOut(); throw fail(403, p.status === 'pending' ? 'Dein Konto wartet noch auf die Freischaltung durch den Admin' : 'Dein Konto ist deaktiviert'); }
      return p;
    }
    if (method === 'POST' && path === '/logout') { await sb.auth.signOut(); return { ok: true }; }
    if (method === 'GET' && path === '/me') return me();
    if (method === 'POST' && path === '/me/password') {
      const u = await me();
      const { error } = await sb.auth.signInWithPassword({ email: u.email, password: body.old || '' }); if (error) throw fail(400, 'Das alte Passwort stimmt nicht');
      if ((body.new || '').length < 8) throw fail(400, 'Neues Passwort: mind. 8 Zeichen');
      const r = await sb.auth.updateUser({ password: body.new }); chk(r.error); return { ok: true };
    }
    if (method === 'GET' && path === '/users') { const { data, error } = await sb.from('profiles').select('*').order('role').order('name'); chk(error); return data; }
    if (method === 'POST' && path === '/users') {
      await me(); const b = body; return fn({ action: 'create', name: b.name, email: b.email, password: b.password, department: b.department, weekly_hours: b.weekly_hours, vacation_days: b.vacation_days, work_days: b.work_days, start_date: b.start_date, opening_balance: b.opening_balance });
    }
    if (method === 'PUT' && (x = m(/^\/users\/([\w-]+)$/))) {
      const b = body, { error, data } = await sb.from('profiles').update({ name: b.name, department: b.department || '', weekly_hours: +b.weekly_hours || 38.5, vacation_days: +b.vacation_days || 0, work_days: b.work_days, start_date: b.start_date, opening_balance: +b.opening_balance || 0, status: b.status }).eq('id', x[1]).select();
      chk(error); if (!data.length) throw fail(403, 'Nur der Admin darf das');
      if (b.password) await fn({ action: 'set_password', id: x[1], password: b.password });
      return { ok: true };
    }
    if (method === 'GET' && path === '/admin/pending') {
      const c = async f => { const { count, error } = await f; chk(error); return count || 0; };
      return { users: await c(sb.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending')), absences: await c(sb.from('absences').select('id', { count: 'exact', head: true }).eq('status', 'beantragt')) };
    }
    if (method === 'GET' && path === '/admin/absences') {
      let r = await all(() => sb.from('absences').select('*, profiles(name)').order('date_from', { ascending: false }));
      if ((q.status || 'beantragt') !== 'all') r = r.filter(a => a.status === q.status);
      return r.map(a => ({ ...a, user_name: a.profiles ? a.profiles.name : '' })).sort((a, b) => (b.status === 'beantragt') - (a.status === 'beantragt'));
    }
    if (method === 'GET' && path === '/projects') { const { data, error } = await sb.from('projects').select('*').eq('archived', false).order('name'); chk(error); return data; }
    if (method === 'POST' && path === '/projects') { const { data, error } = await sb.from('projects').insert({ name: body.name, color: body.color }).select('id').single(); chk(error); return { id: data.id }; }
    if (method === 'PUT' && (x = m(/^\/projects\/(\d+)$/))) { const { error } = await sb.from('projects').update({ name: body.name, color: body.color }).eq('id', x[1]); chk(error); return { ok: true }; }
    if (method === 'DELETE' && (x = m(/^\/projects\/(\d+)$/))) { const { error } = await sb.from('projects').update({ archived: true }).eq('id', x[1]); chk(error); return { ok: true }; }

    if (method === 'GET' && path === '/data') {
      const uid = q.user, { from, to } = q;
      const [{ data: user, error: e0 }, entries, absences, holidays, locks] = await Promise.all([
        sb.from('profiles').select('*').eq('id', uid).single(),
        all(() => sb.from('time_entries').select('*').eq('user_id', uid).gte('start_at', from + 'T00:00:00').lt('start_at', nextDay(to) + 'T00:00:00').order('start_at').order('id')),
        all(() => sb.from('absences').select('*').eq('user_id', uid).gte('date_to', from).lte('date_from', to).order('date_from').order('id')),
        all(() => sb.from('holidays').select('*').gte('date', from).lte('date', to).order('date')),
        sb.from('month_locks').select('ym').eq('user_id', uid)]);
      chk(e0); chk(locks.error);
      return { user, entries, absences, holidays, locks: locks.data.map(r => r.ym) };
    }
    if (method === 'POST' && path === '/entries') { const u = await me(); const { data, error } = await sb.from('time_entries').insert(entryRow(body, body.user_id || u.id)).select('id').single(); chk(error); return { id: data.id }; }
    if (method === 'PUT' && (x = m(/^\/entries\/(\d+)$/))) { const r = entryRow(body, null); delete r.user_id; const { data, error } = await sb.from('time_entries').update(r).eq('id', x[1]).select('id'); chk(error); if (!data.length) throw fail(403, NICE['42501']); return { ok: true }; }
    if (method === 'DELETE' && (x = m(/^\/entries\/(\d+)$/))) { const { data, error } = await sb.from('time_entries').delete().eq('id', x[1]).select('id'); chk(error); if (!data.length) throw fail(403, NICE['42501']); return { ok: true }; }
    if (method === 'POST' && path === '/timer/start') {
      const u = await me();
      let r = await sb.from('time_entries').update({ end_at: nowS() }).eq('user_id', u.id).is('end_at', null); chk(r.error);
      r = await sb.from('time_entries').insert({ user_id: u.id, kind: 'arbeit', project_id: num(body.project_id), description: body.description || '', location: 'Büro', start_at: nowS() }); chk(r.error); return { ok: true };
    }
    if (method === 'POST' && path === '/timer/stop') { const u = await me(); const { error } = await sb.from('time_entries').update({ end_at: nowS() }).eq('user_id', u.id).is('end_at', null); chk(error); return { ok: true }; }

    if (method === 'POST' && path === '/absences') {
      const u = await me();
      if (!body.date_from || !body.date_to || body.date_to < body.date_from) throw fail(400, 'Bitte gültigen Zeitraum angeben');
      const { data, error } = await sb.from('absences').insert({ user_id: body.user_id || u.id, type: body.type, date_from: body.date_from, date_to: body.date_to, note: body.note || '' }).select('id,status').single(); chk(error);
      return { id: data.id, status: data.status };
    }
    if (method === 'DELETE' && (x = m(/^\/absences\/(\d+)$/))) { const { data, error } = await sb.from('absences').delete().eq('id', x[1]).select('id'); chk(error); if (!data.length) throw fail(403, 'Nur offene Anträge können zurückgezogen werden'); return { ok: true }; }
    if (method === 'PUT' && (x = m(/^\/absences\/(\d+)\/status$/))) { const { data, error } = await sb.from('absences').update({ status: body.status }).eq('id', x[1]).select('id'); chk(error); if (!data.length) throw fail(403, 'Nur der Admin darf das'); return { ok: true }; }
    if (method === 'PUT' && path === '/locks') {
      const r = body.locked ? await sb.from('month_locks').upsert({ user_id: body.user_id, ym: body.ym }, { onConflict: 'user_id,ym' }) : await sb.from('month_locks').delete().eq('user_id', body.user_id).eq('ym', body.ym);
      chk(r.error); return { ok: true };
    }
    throw fail(404, 'Nicht gefunden');
  };
})();
