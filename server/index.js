const express = require('express');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const path = require('path');
const { holidays } = require('./holidays');

const pool = mysql.createPool({
  port: +process.env.DB_PORT || 3306, ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
  host: process.env.DB_HOST || '127.0.0.1', user: process.env.DB_USER || 'zeit', password: process.env.DB_PASS || 'zeit',
  database: process.env.DB_NAME || 'zeiterfassung', dateStrings: true, timezone: 'local', connectionLimit: 8,
});
const q = async (sql, p = []) => (await pool.query(sql, p))[0];
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const wrap = fn => (req, res) => fn(req, res).catch(e => { if (!e.status) console.error(e); res.status(e.status || 500).json({ error: e.status ? e.message : 'Serverfehler' }); });
const fail = (status, message) => Object.assign(new Error(message), { status });
const pad = n => String(n).padStart(2, '0');
const nowLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

// ---- Passwörter & Sitzungen
const hash = pw => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const verify = (pw, h) => { const [s, k] = h.split(':'); return crypto.timingSafeEqual(Buffer.from(k, 'hex'), crypto.scryptSync(pw, s, 64)); };
const pub = u => { const { pass_hash, ...rest } = u; return rest; };
const cookie = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(c => c[0]));
async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await q('INSERT INTO sessions (token,user_id) VALUES (?,?)', [token, userId]);
  res.setHeader('Set-Cookie', `zt=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}${res.req.secure ? '; Secure' : ''}`);
}
const auth = wrap2(async (req, res, next) => {
  const t = cookie(req).zt;
  const u = t && (await q('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.status="active"', [t]))[0];
  if (!u) throw fail(401, 'Nicht angemeldet');
  req.user = u; next();
});
function wrap2(fn) { return (req, res, next) => fn(req, res, next).catch(e => res.status(e.status || 500).json({ error: e.status ? e.message : 'Serverfehler' })); }
const adminOnly = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Nur der Admin darf das' });
// Zugriff auf Daten eines Mitarbeiters: nur eigene, der Admin alle
const target = req => { const id = +(req.query.user || req.body?.user_id || req.user.id); if (id !== req.user.id && req.user.role !== 'admin') throw fail(403, 'Kein Zugriff'); return id; };

// ---- Login (keine Selbstregistrierung: Konten legt nur der Admin an)
app.post('/api/login', wrap(async (req, res) => {
  const u = (await q('SELECT * FROM users WHERE email=?', [String(req.body.email || '').toLowerCase()]))[0];
  if (!u || !verify(String(req.body.password || ''), u.pass_hash)) throw fail(401, 'E-Mail oder Passwort stimmt nicht');
  if (u.status === 'pending') throw fail(403, 'Dein Konto wartet noch auf die Freischaltung durch den Admin');
  if (u.status === 'disabled') throw fail(403, 'Dein Konto ist deaktiviert');
  await startSession(res, u.id); res.json(pub(u));
}));
app.post('/api/logout', wrap(async (req, res) => { const t = cookie(req).zt; if (t) await q('DELETE FROM sessions WHERE token=?', [t]); res.setHeader('Set-Cookie', 'zt=; Max-Age=0; Path=/'); res.json({ ok: true }); }));
app.get('/api/me', auth, (req, res) => res.json(pub(req.user)));
app.post('/api/me/password', auth, wrap(async (req, res) => {
  if (!verify(String(req.body.old || ''), req.user.pass_hash)) throw fail(400, 'Das alte Passwort stimmt nicht');
  if (String(req.body.new || '').length < 8) throw fail(400, 'Neues Passwort: mind. 8 Zeichen');
  await q('UPDATE users SET pass_hash=? WHERE id=?', [hash(req.body.new), req.user.id]); res.json({ ok: true });
}));

// ---- Benutzerverwaltung (nur Admin)
const userFields = b => [b.name, b.email?.toLowerCase(), b.department || '', +b.weekly_hours || 38.5, +b.vacation_days || 0, b.work_days || '1,2,3,4,5', b.start_date, +b.opening_balance || 0];
app.get('/api/users', auth, adminOnly, wrap(async (req, res) => res.json((await q('SELECT * FROM users ORDER BY role, name')).map(pub))));
app.post('/api/users', auth, adminOnly, wrap(async (req, res) => {
  const b = req.body; if (!b.name || !b.email || !b.password || b.password.length < 8) throw fail(400, 'Name, E-Mail und Passwort (mind. 8 Zeichen) angeben');
  const r = await q('INSERT INTO users (name,email,department,weekly_hours,vacation_days,work_days,start_date,opening_balance,pass_hash,role,status) VALUES (?,?,?,?,?,?,?,?,?,"user","active")',
    [...userFields({ ...b, start_date: b.start_date || nowLocal().slice(0, 10) }), hash(b.password)]);
  res.json({ id: r.insertId });
}));
app.put('/api/users/:id', auth, adminOnly, wrap(async (req, res) => {
  const b = req.body, id = +req.params.id, u = (await q('SELECT * FROM users WHERE id=?', [id]))[0];
  if (!u) throw fail(404, 'Mitarbeiter nicht gefunden');
  const status = u.role === 'admin' ? 'active' : (['active', 'pending', 'disabled'].includes(b.status) ? b.status : u.status);   // Rolle ist nicht änderbar
  await q('UPDATE users SET name=?,email=?,department=?,weekly_hours=?,vacation_days=?,work_days=?,start_date=?,opening_balance=?,status=? WHERE id=?', [...userFields(b), status, id]);
  if (b.password) { if (b.password.length < 8) throw fail(400, 'Passwort: mind. 8 Zeichen'); await q('UPDATE users SET pass_hash=? WHERE id=?', [hash(b.password), id]); await q('DELETE FROM sessions WHERE user_id=?', [id]); }
  res.json({ ok: true });
}));
app.delete('/api/users/:id', auth, adminOnly, wrap(async (req, res) => {
  const id = +req.params.id, u = (await q('SELECT * FROM users WHERE id=?', [id]))[0];
  if (!u) throw fail(404, 'Mitarbeiter nicht gefunden');
  if (u.role === 'admin') throw fail(400, 'Der Admin kann nicht gelöscht werden');
  await q('DELETE FROM users WHERE id=?', [id]); res.json({ ok: true });   // Zeiten, Anträge und Sperren werden per Fremdschlüssel mitgelöscht
}));
app.get('/api/admin/pending', auth, adminOnly, wrap(async (req, res) => res.json({
  users: (await q('SELECT COUNT(*) c FROM users WHERE status="pending"'))[0].c, absences: (await q('SELECT COUNT(*) c FROM absences WHERE status="beantragt"'))[0].c })));
app.get('/api/admin/absences', auth, adminOnly, wrap(async (req, res) => res.json(await q(
  `SELECT a.*, u.name user_name FROM absences a JOIN users u ON u.id=a.user_id WHERE (?='all' OR a.status=?) ORDER BY a.status='beantragt' DESC, a.date_from DESC LIMIT 200`, [req.query.status || 'beantragt', req.query.status || 'beantragt']))));

// ---- Projekte
app.get('/api/projects', auth, wrap(async (req, res) => res.json(await q('SELECT * FROM projects WHERE archived=0 ORDER BY name'))));
app.post('/api/projects', auth, adminOnly, wrap(async (req, res) => res.json({ id: (await q('INSERT INTO projects (name,color) VALUES (?,?)', [req.body.name, req.body.color || '#0A84FF'])).insertId })));
app.put('/api/projects/:id', auth, adminOnly, wrap(async (req, res) => { await q('UPDATE projects SET name=?,color=? WHERE id=?', [req.body.name, req.body.color, req.params.id]); res.json({ ok: true }); }));
app.delete('/api/projects/:id', auth, adminOnly, wrap(async (req, res) => { await q('UPDATE projects SET archived=1 WHERE id=?', [req.params.id]); res.json({ ok: true }); }));

// ---- Feiertage (Österreich) in der DB, bei Bedarf nachgetragen
async function ensureHolidays(from, to) {
  for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
    if ((await q('SELECT 1 FROM holidays WHERE date BETWEEN ? AND ? LIMIT 1', [`${y}-01-01`, `${y}-12-31`])).length) continue;
    for (const [d, n] of holidays(y)) await q('INSERT IGNORE INTO holidays (date,name) VALUES (?,?)', [d, n]);
  }
}
app.get('/api/holidays', auth, wrap(async (req, res) => { await ensureHolidays(req.query.from, req.query.to); res.json(await q('SELECT * FROM holidays WHERE date BETWEEN ? AND ? ORDER BY date', [req.query.from, req.query.to])); }));

// ---- Daten eines Mitarbeiters für einen Zeitraum (Berechnung von Soll/Ist passiert im Client)
app.get('/api/data', auth, wrap(async (req, res) => {
  const uid = target(req), { from, to } = req.query; await ensureHolidays(from, to);
  res.json({
    user: pub((await q('SELECT * FROM users WHERE id=?', [uid]))[0]),
    entries: await q('SELECT * FROM time_entries WHERE user_id=? AND start_at>=? AND start_at<DATE_ADD(?,INTERVAL 1 DAY) ORDER BY start_at', [uid, from, to]),
    absences: await q('SELECT * FROM absences WHERE user_id=? AND date_to>=? AND date_from<=? ORDER BY date_from', [uid, from, to]),
    holidays: await q('SELECT * FROM holidays WHERE date BETWEEN ? AND ?', [from, to]),
    locks: (await q('SELECT ym FROM month_locks WHERE user_id=?', [uid])).map(r => r.ym),
  });
}));

// ---- Zeiteinträge
const KINDS = ['arbeit', 'pause', 'arzt'];
async function assertEditable(req, uid, startAt) {
  if (req.user.role === 'admin') return;
  if ((await q('SELECT 1 FROM month_locks WHERE user_id=? AND ym=?', [uid, String(startAt).slice(0, 7)])).length) throw fail(423, 'Dieser Monat wurde vom Admin freigegeben und ist gesperrt');
}
function entryBody(b) {
  if (!KINDS.includes(b.kind)) throw fail(400, 'Ungültige Art');
  if (!/^\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d)?$/.test(b.start_at)) throw fail(400, 'Ungültiger Start');
  if (b.end_at && b.end_at <= b.start_at) throw fail(400, 'Das Ende muss nach dem Start liegen');
  return [b.kind, b.kind === 'arbeit' ? (b.project_id || null) : null, String(b.description || '').slice(0, 255), b.location || 'Büro', b.start_at, b.end_at || null];
}
async function ownEntry(req) {
  const e = (await q('SELECT * FROM time_entries WHERE id=?', [req.params.id]))[0];
  if (!e || (e.user_id !== req.user.id && req.user.role !== 'admin')) throw fail(404, 'Eintrag nicht gefunden');
  return e;
}
app.post('/api/entries', auth, wrap(async (req, res) => {
  const uid = target(req), v = entryBody(req.body); await assertEditable(req, uid, v[4]);
  res.json({ id: (await q('INSERT INTO time_entries (user_id,kind,project_id,description,location,start_at,end_at) VALUES (?,?,?,?,?,?,?)', [uid, ...v])).insertId });
}));
app.put('/api/entries/:id', auth, wrap(async (req, res) => {
  const e = await ownEntry(req), v = entryBody(req.body); await assertEditable(req, e.user_id, e.start_at); await assertEditable(req, e.user_id, v[4]);
  await q('UPDATE time_entries SET kind=?,project_id=?,description=?,location=?,start_at=?,end_at=? WHERE id=?', [...v, e.id]); res.json({ ok: true });
}));
app.delete('/api/entries/:id', auth, wrap(async (req, res) => { const e = await ownEntry(req); await assertEditable(req, e.user_id, e.start_at); await q('DELETE FROM time_entries WHERE id=?', [e.id]); res.json({ ok: true }); }));

// ---- Timer (Stempeln) für den angemeldeten Benutzer
app.get('/api/timer', auth, wrap(async (req, res) => res.json((await q('SELECT * FROM time_entries WHERE user_id=? AND end_at IS NULL LIMIT 1', [req.user.id]))[0] || null)));
app.post('/api/timer/start', auth, wrap(async (req, res) => {
  await assertEditable(req, req.user.id, nowLocal());
  await q('UPDATE time_entries SET end_at=? WHERE user_id=? AND end_at IS NULL', [nowLocal(), req.user.id]);
  res.json({ id: (await q('INSERT INTO time_entries (user_id,kind,project_id,description,location,start_at) VALUES (?,"arbeit",?,?,?,?)', [req.user.id, req.body.project_id || null, req.body.description || '', req.body.location || 'Büro', nowLocal()])).insertId });
}));
app.post('/api/timer/stop', auth, wrap(async (req, res) => { await q('UPDATE time_entries SET end_at=? WHERE user_id=? AND end_at IS NULL', [nowLocal(), req.user.id]); res.json({ ok: true }); }));

// ---- Abwesenheiten & Anträge
const ABS = ['urlaub', 'krank', 'sonderurlaub', 'zeitausgleich'];
app.post('/api/absences', auth, wrap(async (req, res) => {
  const uid = target(req), b = req.body;
  if (!ABS.includes(b.type) || !/^\d{4}-\d\d-\d\d$/.test(b.date_from) || !/^\d{4}-\d\d-\d\d$/.test(b.date_to) || b.date_to < b.date_from) throw fail(400, 'Bitte gültigen Zeitraum angeben');
  await assertEditable(req, uid, b.date_from);
  // Krankenstand wird sofort eingetragen, Urlaub/Sonderurlaub/Zeitausgleich müssen vom Admin genehmigt werden
  const status = req.user.role === 'admin' || b.type === 'krank' ? 'genehmigt' : 'beantragt';
  res.json({ id: (await q('INSERT INTO absences (user_id,type,date_from,date_to,note,status) VALUES (?,?,?,?,?,?)', [uid, b.type, b.date_from, b.date_to, String(b.note || '').slice(0, 255), status])).insertId, status });
}));
app.delete('/api/absences/:id', auth, wrap(async (req, res) => {
  const a = (await q('SELECT * FROM absences WHERE id=?', [req.params.id]))[0];
  if (!a || (a.user_id !== req.user.id && req.user.role !== 'admin')) throw fail(404, 'Antrag nicht gefunden');
  if (req.user.role !== 'admin' && a.status !== 'beantragt') throw fail(403, 'Nur offene Anträge können zurückgezogen werden');
  await q('DELETE FROM absences WHERE id=?', [a.id]); res.json({ ok: true });
}));
app.put('/api/absences/:id/status', auth, adminOnly, wrap(async (req, res) => {
  if (!['genehmigt', 'abgelehnt'].includes(req.body.status)) throw fail(400, 'Ungültiger Status');
  await q('UPDATE absences SET status=? WHERE id=?', [req.body.status, req.params.id]); res.json({ ok: true });
}));

// ---- Monatsfreigabe (Sperre)
app.put('/api/locks', auth, adminOnly, wrap(async (req, res) => {
  const { user_id, ym, locked } = req.body;
  if (locked) await q('INSERT IGNORE INTO month_locks (user_id,ym) VALUES (?,?)', [user_id, ym]); else await q('DELETE FROM month_locks WHERE user_id=? AND ym=?', [user_id, ym]);
  res.json({ ok: true });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Nicht gefunden' }));
const fs = require('fs');
async function initDb() {   // legt fehlende Tabellen automatisch an (Daten bleiben erhalten)
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'tables.sql'), 'utf8').replace(/^--.*$/gm, '');
  for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) await pool.query(stmt);
  // Ersten Admin anlegen, falls noch keiner existiert (ADMIN_EMAIL + ADMIN_PASSWORD, optional ADMIN_NAME)
  const [{ c }] = await q('SELECT COUNT(*) c FROM users WHERE role="admin"');
  if (!c) {
    const { ADMIN_EMAIL: e, ADMIN_PASSWORD: pw, ADMIN_NAME: n } = process.env;
    if (e && pw && pw.length >= 8) { await q('INSERT INTO users (email,name,pass_hash,role,status,start_date) VALUES (?,?,?,"admin","active",CURDATE())', [e.toLowerCase(), n || 'Admin', hash(pw)]); console.log('Admin-Konto angelegt:', e); }
    else console.warn('Es gibt noch keinen Admin. ADMIN_EMAIL und ADMIN_PASSWORD (mind. 8 Zeichen) setzen und neu starten.');
  }
}
const port = process.env.PORT || 3100;
initDb().then(() => app.listen(port, () => console.log(`Zeitfluss läuft auf Port ${port}`))).catch(e => { console.error('Datenbank nicht erreichbar:', e.message); process.exit(1); });
