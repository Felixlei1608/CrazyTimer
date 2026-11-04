/* Browser-Mock der Zeitfluss-API (für die Demo ohne Server/MySQL). Gleiche Routen und Regeln wie server/index.js. */
window.LOCAL_MODE = true;
(function () {
  const pad = n => String(n).padStart(2, '0'), ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dt = (d, h) => { const m = Math.round(h * 60 / 5) * 5; return `${ymd(d)} ${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`; };
  const nowS = () => { const d = new Date(); return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451); return new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1); }
  function holidays(y) { const E = easter(y), off = n => { const d = new Date(E); d.setDate(d.getDate() + n); return ymd(d); }; return [[`${y}-01-01`, 'Neujahr'], [`${y}-01-06`, 'Heilige Drei Könige'], [off(1), 'Ostermontag'], [`${y}-05-01`, 'Staatsfeiertag'], [off(39), 'Christi Himmelfahrt'], [off(50), 'Pfingstmontag'], [off(60), 'Fronleichnam'], [`${y}-08-15`, 'Mariä Himmelfahrt'], [`${y}-10-26`, 'Nationalfeiertag'], [`${y}-11-01`, 'Allerheiligen'], [`${y}-12-08`, 'Mariä Empfängnis'], [`${y}-12-25`, 'Christtag'], [`${y}-12-26`, 'Stefanitag']]; }
  // Leerer Start, Speicherung im Browser (localStorage). Kein Server, keine Beispieldaten.
  const KEY = 'crazytimer-db-v1', SKEY = 'crazytimer-session-v1', mem = {};
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return mem[k] || null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } };
  let DB; try { DB = JSON.parse(lsGet(KEY)); } catch (e) { DB = null; }
  DB = DB || { users: [], projects: [], entries: [], absences: [], locks: [], id: 1 };
  const save = () => lsSet(KEY, JSON.stringify(DB));
  const nid = () => DB.id++;
  const hashPw = async (pw, salt) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pw)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const newSalt = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
  const pwOk = async (u, pw) => u.pw === await hashPw(String(pw || ''), u.salt);
  let cur = +lsGet(SKEY) || null; const setCur = v => { cur = v; lsSet(SKEY, v ? String(v) : ''); };
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const pub = u => { const { pw, salt, ...x } = u; return { ...x, created_at: '' }; };
  const me = () => { const u = cur && DB.users.find(u => u.id === cur && u.status === 'active'); if (!u) throw fail(401, 'Nicht angemeldet'); return u; };
  const adm = () => { if (me().role !== 'admin') throw fail(403, 'Nur der Admin darf das'); };
  const entryOk = (b) => { if (!['arbeit', 'pause', 'arzt'].includes(b.kind)) throw fail(400, 'Ungültige Art'); if (b.end_at && b.end_at <= b.start_at) throw fail(400, 'Das Ende muss nach dem Start liegen'); };
  const editable = (uid, d) => { if (me().role !== 'admin' && DB.locks.some(l => l.user_id === uid && l.ym === String(d).slice(0, 7))) throw fail(423, 'Dieser Monat wurde vom Admin freigegeben und ist gesperrt'); };
  const target = q => { const id = +(q.user || me().id); if (id !== me().id && me().role !== 'admin') throw fail(403, 'Kein Zugriff'); return id; };
  const ownE = id => { const e = DB.entries.find(x => x.id == id); if (!e || (e.user_id !== me().id && me().role !== 'admin')) throw fail(404, 'Eintrag nicht gefunden'); return e; };
  const clone = o => JSON.parse(JSON.stringify(o));

  const run = async function (method, url, body = {}) {
    if (!DB.users.length) { const salt = newSalt(); DB.users.push({ id: nid(), name: 'Demo Admin', email: 'admin@demo.at', salt, pw: await hashPw('demo1234', salt), role: 'admin', status: 'active', department: '', weekly_hours: 38.5, vacation_days: 25, work_days: '1,2,3,4,5', start_date: ymd(new Date()), opening_balance: 0 }); DB.projects.push({ id: nid(), name: 'Allgemein', color: '#0a84ff', archived: 0 }); save(); }
    await new Promise(r => setTimeout(r, 30));
    const [path, qs] = url.split('?'), q = Object.fromEntries(new URLSearchParams(qs || '')), m = (re) => path.match(re);
    let x;
    if (method === 'POST' && path === '/login') { const u = DB.users.find(u => u.email === String(body.email).toLowerCase()); if (!u || !(await pwOk(u, body.password))) throw fail(401, 'E-Mail oder Passwort stimmt nicht'); if (u.status === 'pending') throw fail(403, 'Dein Konto wartet noch auf die Freischaltung durch den Admin'); if (u.status === 'disabled') throw fail(403, 'Dein Konto ist deaktiviert'); setCur(u.id); return pub(u); }
    if (method === 'POST' && path === '/logout') { setCur(null); return { ok: true }; }
    if (method === 'GET' && path === '/me') return pub(me());
    if (method === 'POST' && path === '/me/password') { if (!(await pwOk(me(), body.old))) throw fail(400, 'Das alte Passwort stimmt nicht'); if ((body.new || '').length < 8) throw fail(400, 'Neues Passwort: mind. 8 Zeichen'); me().pw = await hashPw(body.new, me().salt); return { ok: true }; }
    if (method === 'GET' && path === '/users') { adm(); return DB.users.map(pub); }
    if (method === 'POST' && path === '/users') { adm(); if (!body.name || !body.email || (body.password || '').length < 8) throw fail(400, 'Name, E-Mail und Passwort (mind. 8 Zeichen) angeben'); if (DB.users.some(u => u.email === body.email.toLowerCase())) throw fail(409, 'Diese E-Mail ist bereits registriert'); const salt = newSalt(), u = { id: nid(), role: 'user', status: 'active', salt, pw: await hashPw(body.password, salt), name: body.name, email: body.email.toLowerCase(), department: body.department || '', weekly_hours: +body.weekly_hours || 38.5, vacation_days: +body.vacation_days || 0, work_days: body.work_days || '1,2,3,4,5', start_date: body.start_date || ymd(new Date()), opening_balance: +body.opening_balance || 0 }; DB.users.push(u); return { id: u.id }; }
    if (method === 'PUT' && (x = m(/^\/users\/(\d+)$/))) { adm(); const u = DB.users.find(u => u.id == x[1]); if (!u) throw fail(404, 'Mitarbeiter nicht gefunden'); const b = body; Object.assign(u, { name: b.name, email: b.email.toLowerCase(), department: b.department || '', weekly_hours: +b.weekly_hours || 38.5, vacation_days: +b.vacation_days || 0, work_days: b.work_days, start_date: b.start_date, opening_balance: +b.opening_balance || 0, status: u.role === 'admin' ? 'active' : b.status }); if (b.password) { if (b.password.length < 8) throw fail(400, 'Passwort: mind. 8 Zeichen'); u.salt = newSalt(); u.pw = await hashPw(b.password, u.salt); } return { ok: true }; }
    if (method === 'DELETE' && (x = m(/^\/users\/(\d+)$/))) { adm(); const u = DB.users.find(u => u.id == x[1]); if (!u) throw fail(404, 'Mitarbeiter nicht gefunden'); if (u.role === 'admin') throw fail(400, 'Der Admin kann nicht gelöscht werden'); DB.users = DB.users.filter(v => v !== u); DB.entries = DB.entries.filter(e => e.user_id !== u.id); DB.absences = DB.absences.filter(a => a.user_id !== u.id); DB.locks = DB.locks.filter(l => l.user_id !== u.id); return { ok: true }; }
    if (method === 'GET' && path === '/admin/pending') { adm(); return { users: DB.users.filter(u => u.status === 'pending').length, absences: DB.absences.filter(a => a.status === 'beantragt').length }; }
    if (method === 'GET' && path === '/admin/absences') { adm(); return clone(DB.absences).map(a => ({ ...a, user_name: DB.users.find(u => u.id === a.user_id).name })).filter(a => q.status === 'all' || a.status === (q.status || 'beantragt')).sort((a, b) => (b.status === 'beantragt') - (a.status === 'beantragt') || (a.date_from < b.date_from ? 1 : -1)); }
    if (method === 'GET' && path === '/projects') { me(); return clone(DB.projects.filter(p => !p.archived)); }
    if (method === 'POST' && path === '/projects') { adm(); const p = { id: nid(), name: body.name, color: body.color, archived: 0 }; DB.projects.push(p); return { id: p.id }; }
    if (method === 'PUT' && (x = m(/^\/projects\/(\d+)$/))) { adm(); Object.assign(DB.projects.find(p => p.id == x[1]), { name: body.name, color: body.color }); return { ok: true }; }
    if (method === 'DELETE' && (x = m(/^\/projects\/(\d+)$/))) { adm(); DB.projects.find(p => p.id == x[1]).archived = 1; return { ok: true }; }
    if (method === 'GET' && path === '/data') {
      const uid = target(q), h = []; for (let y = +q.from.slice(0, 4); y <= +q.to.slice(0, 4); y++) holidays(y).forEach(([date, name]) => h.push({ date, name }));
      return clone({ user: pub(DB.users.find(u => u.id === uid)), entries: DB.entries.filter(e => e.user_id === uid && e.start_at.slice(0, 10) >= q.from && e.start_at.slice(0, 10) <= q.to).sort((a, b) => a.start_at < b.start_at ? -1 : 1), absences: DB.absences.filter(a => a.user_id === uid && a.date_to >= q.from && a.date_from <= q.to), holidays: h.filter(x => x.date >= q.from && x.date <= q.to), locks: DB.locks.filter(l => l.user_id === uid).map(l => l.ym) });
    }
    if (method === 'POST' && path === '/entries') { const uid = target(body); entryOk(body); editable(uid, body.start_at); const e = { id: nid(), user_id: uid, kind: body.kind, project_id: body.kind === 'arbeit' ? +body.project_id || null : null, description: body.description || '', location: body.location || 'Büro', start_at: body.start_at, end_at: body.end_at || null }; DB.entries.push(e); return { id: e.id }; }
    if (method === 'PUT' && (x = m(/^\/entries\/(\d+)$/))) { const e = ownE(x[1]); entryOk(body); editable(e.user_id, e.start_at); editable(e.user_id, body.start_at); Object.assign(e, { kind: body.kind, project_id: body.kind === 'arbeit' ? +body.project_id || null : null, description: body.description || '', location: body.location || 'Büro', start_at: body.start_at, end_at: body.end_at || null }); return { ok: true }; }
    if (method === 'DELETE' && (x = m(/^\/entries\/(\d+)$/))) { const e = ownE(x[1]); editable(e.user_id, e.start_at); DB.entries = DB.entries.filter(v => v !== e); return { ok: true }; }
    if (method === 'POST' && path === '/timer/start') { editable(me().id, nowS()); DB.entries.filter(e => e.user_id === me().id && !e.end_at).forEach(e => e.end_at = nowS()); DB.entries.push({ id: nid(), user_id: me().id, kind: 'arbeit', project_id: +body.project_id || null, description: body.description || '', location: 'Büro', start_at: nowS(), end_at: null }); return { ok: true }; }
    if (method === 'POST' && path === '/timer/stop') { DB.entries.filter(e => e.user_id === me().id && !e.end_at).forEach(e => e.end_at = nowS()); return { ok: true }; }
    if (method === 'POST' && path === '/absences') { const uid = target(body); if (!['urlaub', 'krank', 'sonderurlaub', 'zeitausgleich'].includes(body.type) || !body.date_from || !body.date_to || body.date_to < body.date_from) throw fail(400, 'Bitte gültigen Zeitraum angeben'); editable(uid, body.date_from); const status = me().role === 'admin' || body.type === 'krank' ? 'genehmigt' : 'beantragt'; const a = { id: nid(), user_id: uid, type: body.type, date_from: body.date_from, date_to: body.date_to, note: body.note || '', status }; DB.absences.push(a); return { id: a.id, status }; }
    if (method === 'DELETE' && (x = m(/^\/absences\/(\d+)$/))) { const a = DB.absences.find(v => v.id == x[1]); if (!a || (a.user_id !== me().id && me().role !== 'admin')) throw fail(404, 'Antrag nicht gefunden'); if (me().role !== 'admin' && a.status !== 'beantragt') throw fail(403, 'Nur offene Anträge können zurückgezogen werden'); DB.absences = DB.absences.filter(v => v !== a); return { ok: true }; }
    if (method === 'PUT' && (x = m(/^\/absences\/(\d+)\/status$/))) { adm(); DB.absences.find(v => v.id == x[1]).status = body.status; return { ok: true }; }
    if (method === 'PUT' && path === '/locks') { adm(); DB.locks = DB.locks.filter(l => !(l.user_id === body.user_id && l.ym === body.ym)); if (body.locked) DB.locks.push({ user_id: body.user_id, ym: body.ym }); return { ok: true }; }
    throw fail(404, 'Nicht gefunden');
  };
  window.API_OVERRIDE = async (m, u, b) => { const r = await run(m, u, b); if (m !== 'GET') save(); return r; };
})();
