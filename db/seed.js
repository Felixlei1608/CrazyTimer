// Demo-Daten:  node db/seed.js   (leert alle Tabellen!)
// Logins:  felix@crazyaquarium.at / Aquarium2026 (Admin) · anna@crazyaquarium.at / demo1234 · max@crazyaquarium.at / demo1234
const mysql = require('mysql2/promise'), crypto = require('crypto');
const { holidays } = require('../server/holidays');
const hash = pw => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dt = (d, h) => { const m = Math.round(h * 60 / 5) * 5; return `${ymd(d)} ${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`; };
(async () => {
  const c = await mysql.createConnection({ host: '127.0.0.1', user: 'zeit', password: 'zeit', database: 'zeiterfassung' });
  await c.query('SET FOREIGN_KEY_CHECKS=0'); for (const t of ['month_locks', 'absences', 'time_entries', 'sessions', 'projects', 'users', 'holidays']) await c.query(`TRUNCATE ${t}`); await c.query('SET FOREIGN_KEY_CHECKS=1');
  const yr = new Date().getFullYear(), start = `${yr}-01-01`;
  for (let y = yr - 1; y <= yr + 2; y++) for (const [d, n] of holidays(y)) await c.query('INSERT INTO holidays VALUES (?,?)', [d, n]);
  const U = [['Felix Leimhofer', 'felix@crazyaquarium.at', 'Aquarium2026', 'admin', 'active', 'Entwicklung', 38.5, 25], ['Anna Berger', 'anna@crazyaquarium.at', 'demo1234', 'user', 'active', 'Entwicklung', 38.5, 25],
    ['Max Huber', 'max@crazyaquarium.at', 'demo1234', 'user', 'active', 'Support', 30, 25], ['Lisa Gruber', 'lisa@crazyaquarium.at', 'demo1234', 'user', 'pending', '', 38.5, 25]];
  const ids = []; for (const [n, e, p, r, s, dep, wh, vd] of U) ids.push((await c.query('INSERT INTO users (name,email,pass_hash,role,status,department,weekly_hours,vacation_days,work_days,start_date) VALUES (?,?,?,?,?,?,?,?,?,?)', [n, e, hash(p), r, s, dep, wh, vd, wh < 38 ? '1,2,3,4' : '1,2,3,4,5', start]))[0].insertId);
  const P = [['LogApp', '#0a84ff'], ['Interne Tätigkeit', '#30d158'], ['Kundenprojekt Alpenbank', '#bf5af2'], ['Support', '#ff9f0a']];
  const pid = []; for (const [n, col] of P) pid.push((await c.query('INSERT INTO projects (name,color) VALUES (?,?)', [n, col]))[0].insertId);
  const D = [['Fixed Issue: 0003571', 'Testen', 'Code Review'], ['Teamsitzung', 'Planung', 'Dokumentation'], ['Design-Review', 'API Anbindung', 'Release'], ['Tickets bearbeiten', 'Kundengespräch']];
  let s = 11; const r = () => (s = s * 16807 % 2147483647) / 2147483647;
  const hol = new Set(holidays(yr).concat(holidays(yr - 1)).map(h => h[0])), today = new Date(); today.setHours(0, 0, 0, 0);
  const firstDay = new Date(yr, 0, 1); const days = Math.round((today - firstDay) / 864e5);
  for (let ui = 0; ui <= 2; ui++) for (let i = days; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i); const w = d.getDay(); if (w === 0 || w === 6 || hol.has(ymd(d))) continue;
    if (ui === 2 && w === 5) continue;
    if (ui === 1 && i >= 14 && i <= 18) continue; // Urlaub von Anna
    const p1 = Math.floor(r() * 4), p2 = Math.floor(r() * 4), a = 7 + Math.round(r() * 4) / 4, en = a + 4.3 + r() * .5, e2 = en + .5 + 2.9 + (r() - .5) * 1.0;
    const ins = (kind, p, desc, s1, e1, loc = 'Büro') => c.query('INSERT INTO time_entries (user_id,kind,project_id,description,location,start_at,end_at) VALUES (?,?,?,?,?,?,?)', [ids[ui], kind, p, desc, loc, dt(d, s1), dt(d, e1)]);
    const loc = w === 3 ? 'Homeoffice' : 'Büro';
    if (i === 0 && new Date().getHours() < 9) continue;
    const now = new Date().getHours() + new Date().getMinutes() / 60;
    await ins('arbeit', pid[p1], D[p1][Math.floor(r() * D[p1].length)], a, Math.min(en, i === 0 ? Math.max(a + .5, now - .2) : en), loc);
    if (i === 0 && now < en + .5) continue;
    await ins('pause', null, '', en, en + .5, loc);
    if (i === 0 && now < en + 1) continue;
    await ins('arbeit', pid[p2], D[p2][Math.floor(r() * D[p2].length)], en + .5, i === 0 ? Math.max(en + .75, Math.min(e2, now - .1)) : e2, loc);
    if (w === 2 && i % 14 === 3) await ins('arzt', null, 'Arzt / Behördenweg', e2, e2 + .5, 'Außer Haus');
  }
  const dd = n => { const d = new Date(today); d.setDate(d.getDate() - n); return ymd(d); };
  const fd = n => { const d = new Date(today); d.setDate(d.getDate() + n); return ymd(d); };
  await c.query('INSERT INTO absences (user_id,type,date_from,date_to,note,status) VALUES (?,?,?,?,?,?),(?,?,?,?,?,?),(?,?,?,?,?,?),(?,?,?,?,?,?)', [
    ids[1], 'urlaub', dd(18), dd(14), 'Herbsturlaub', 'genehmigt', ids[1], 'urlaub', fd(20), fd(26), 'Winterurlaub', 'beantragt',
    ids[2], 'krank', dd(30), dd(29), 'Grippaler Infekt', 'genehmigt', ids[2], 'sonderurlaub', fd(8), fd(8), 'Umzug', 'beantragt']);
  await c.end(); console.log('Demo-Daten angelegt (Admin: felix@crazyaquarium.at / Aquarium2026)');
})();
