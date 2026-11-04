/* Zeitfluss – Client. Rechnet Soll/Ist im Browser aus den Rohdaten der API. */
const $ = (s, r = document) => r.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const P = s => new Date(String(s).replace(' ', 'T'));
const hm = h => { const m = Math.round(Math.abs(h) * 60); return `${h < -0.008 ? '−' : ''}${Math.floor(m / 60)}:${pad(m % 60)}`; };
const de = h => (Math.round(h * 10) / 10).toString().replace('.', ',');
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'], WDL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MON = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MS = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isoWeek = d => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); };
const dur = e => Math.max(((e.end || new Date()) - e.start) / 36e5, 0);

const KIND = { arbeit: { l: 'Arbeit', c: 'var(--blue)' }, pause: { l: 'Pause', c: 'var(--sub)' }, arzt: { l: 'Arzt / Behördenweg', c: 'var(--teal)' } };
const ABS = { urlaub: { l: 'Urlaub', c: 'var(--green)', ask: true }, krank: { l: 'Krankenstand', c: 'var(--red)' }, sonderurlaub: { l: 'Sonderurlaub', c: 'var(--purple)', ask: true }, zeitausgleich: { l: 'Zeitausgleich', c: 'var(--orange)', ask: true } };
const ALL = { ...KIND, ...ABS };
const LOCS = ['Büro', 'Homeoffice', 'Außer Haus'];

/* ---------- API ---------- */
async function api(m, u, b) {
  if (window.API_OVERRIDE) return window.API_OVERRIDE(m, u, b);
  const r = await fetch('api' + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Fehler'), { status: r.status });
  return j;
}

/* ---------- Logo ---------- */
function logo(size = 38) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="CrazyAquarium"><defs><linearGradient id="lg${size}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2ec4f1"/><stop offset="1" stop-color="#1f4fd8"/></linearGradient><linearGradient id="lf${size}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#ffb81c"/></linearGradient></defs>
  <rect width="64" height="64" rx="15" fill="url(#lg${size})"/><path d="M0 44c8-5 14 5 22 0s14 5 22 0 14 5 20 0V64H0z" fill="#fff" opacity=".16"/>
  <path d="M43 32c5-2 9-7 13-10-1 5-1 15 0 20-4-3-8-8-13-10z" fill="url(#lf${size})"/><path d="M24 20c3-4 8-6 11-4-2 2-3 4-3 6z" fill="#ffb81c"/>
  <ellipse cx="29" cy="32" rx="17" ry="13" fill="url(#lf${size})"/><circle cx="27" cy="31" r="8.6" fill="#fff"/><circle cx="27" cy="31" r="8.6" fill="none" stroke="#1f4fd8" stroke-width="1.8"/>
  <path d="M27 25.5V31l3.6 2.4" fill="none" stroke="#1f4fd8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="14" cy="28.5" r="1.7" fill="#1c1c1e"/><circle cx="53" cy="12" r="2.2" fill="#fff" opacity=".8"/><circle cx="48" cy="7" r="1.4" fill="#fff" opacity=".7"/></svg>`;
}

/* ---------- Zustand ---------- */
const now0 = new Date();
const ST = { me: null, view: 'zeit', y: now0.getFullYear(), m: now0.getMonth(), uid: null, users: [], projects: [], pend: { users: 0, absences: 0 }, tab: 'users', abY: now0.getFullYear() };
const app = $('#app');
let tick = null;
const toast = t => { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2000); };
const openModal = h => { $('#sheet').innerHTML = h; $('#modal').hidden = false; const f = $('#sheet input,#sheet select'); };
const closeModal = () => $('#modal').hidden = true;
$('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
const isAdmin = () => ST.me.role === 'admin';
const curUser = () => (isAdmin() && ST.uid && ST.users.find(u => u.id == ST.uid)) || ST.me;
const num = u => ({ ...u, weekly_hours: +u.weekly_hours, vacation_days: +u.vacation_days, opening_balance: +u.opening_balance });

/* ---------- Berechnung ---------- */
async function loadData(u, from, to) {
  const j = await api('GET', `/data?user=${u.id}&from=${from}&to=${to}`);
  const hol = {}; j.holidays.forEach(h => hol[h.date.slice(0, 10)] = h.name);
  j.entries.forEach(e => { e.start = P(e.start_at); e.end = e.end_at ? P(e.end_at) : null; });
  return { entries: j.entries, absences: j.absences, hol, locks: j.locks, user: num(j.user) };
}
function buildDays(u, from, to, D) {
  const wd = String(u.work_days).split(',').map(Number), daily = u.weekly_hours / wd.length, by = {}, out = [];
  D.entries.forEach(e => (by[ymd(e.start)] ||= []).push(e));
  for (let d = new Date(from + 'T12:00'); ymd(d) <= to; d.setDate(d.getDate() + 1)) {
    const k = ymd(d), w = d.getDay() || 7, hol = D.hol[k] || null, isWork = wd.includes(w);
    const es = (by[k] || []).sort((a, b) => a.start - b.start), abs = D.absences.filter(a => a.date_from.slice(0, 10) <= k && a.date_to.slice(0, 10) >= k);
    const target = isWork && !hol ? daily : 0, worked = es.filter(e => e.kind !== 'pause').reduce((t, e) => t + dur(e), 0);
    const ok = abs.find(a => a.status === 'genehmigt'), credit = ok && target && ok.type !== 'zeitausgleich' ? target : 0;
    out.push({ k, date: new Date(d), isWork, hol, es, abs, target, worked, credit, ist: worked + credit });
  }
  return out;
}
const absDays = (a, u, hol) => buildDays(u, a.date_from.slice(0, 10), a.date_to.slice(0, 10), { entries: [], absences: [], hol }).filter(d => d.target > 0).length;
const sumDiff = (days, upto) => days.filter(d => d.k <= upto).reduce((t, d) => t + d.ist - d.target, 0);

/* ---------- Diagramme ---------- */
function barChart(days, W = 760, H = 240) {
  const max = Math.max(10, Math.ceil(Math.max(...days.map(d => Math.max(d.ist, d.target))) / 2) * 2), top = 14, base = H - 28, sc = (base - top) / max, left = 30, slot = (W - left) / days.length, bw = Math.min(30, slot * .62);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Stunden pro Tag"><defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ac8fa"/><stop offset="1" stop-color="#0a84ff"/></linearGradient></defs>`;
  for (let g = 0; g <= max; g += 2) { const y = base - g * sc; s += `<line x1="${left}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--grid)" stroke-dasharray="3 4"/><text x="0" y="${y + 4}">${g}</text>`; }
  days.forEach((d, i) => {
    const x = left + i * slot + (slot - bw) / 2, h = d.ist * sc;
    if (h > 0) s += `<rect x="${x}" y="${base - h}" width="${bw}" height="${h}" rx="${Math.min(8, bw / 2)}" fill="${d.credit ? 'var(--purple)' : 'url(#bg)'}"><title>${WD[d.date.getDay()]} ${d.date.getDate()}.${d.date.getMonth() + 1}.: ${hm(d.ist)} h</title></rect>`;
    if (d.target) s += `<line x1="${x - 3}" x2="${x + bw + 3}" y1="${base - d.target * sc}" y2="${base - d.target * sc}" stroke="var(--orange)" stroke-width="2.5" stroke-linecap="round"/>`;
    if (days.length <= 12 || i % 2 === 0) s += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${d.date.getDate()}</text>`;
  });
  return s + '</svg>';
}
function donut(items, total) {
  const R = 70, C = 2 * Math.PI * R; let off = 0, s = `<svg viewBox="0 0 180 180" width="180" height="180" style="max-width:100%" role="img" aria-label="Stunden nach Projekt"><circle cx="90" cy="90" r="${R}" fill="none" stroke="var(--fill)" stroke-width="20"/>`;
  items.forEach(i => { const l = i.hours / (total || 1) * C; s += `<circle cx="90" cy="90" r="${R}" fill="none" stroke="${i.color}" stroke-width="20" stroke-dasharray="${Math.max(l - 3, 0)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 90 90)" stroke-linecap="round"/>`; off += l; });
  return s + `<text x="90" y="90" text-anchor="middle" style="font-size:26px;font-weight:700;fill:var(--text)">${de(total)}</text><text x="90" y="110" text-anchor="middle">Stunden</text></svg>`;
}

/* ---------- Start / Anmeldung ---------- */
async function boot() {
  try { ST.me = num(await api('GET', '/me')); } catch (e) { return authScreen(); }
  await loadBase(); const h = location.hash.slice(1); if (['zeit', 'berichte', 'urlaub', 'verwaltung'].includes(h) && (h !== 'verwaltung' || isAdmin())) ST.view = h; render();
}
async function loadBase() {
  ST.projects = await api('GET', '/projects');
  if (isAdmin()) { ST.users = (await api('GET', '/users')).map(num); ST.pend = await api('GET', '/admin/pending'); }
}
function authScreen(msg = '') {
  clearInterval(tick);
  app.innerHTML = `<div class="auth"><div class="card box"><div class="logo">${logo(64)}<div><b>Zeitfluss</b><br><span>Arbeitszeiten einfach erfassen · by CrazyAquarium</span></div></div>
  <form id="af"><input id="a_e" type="email" placeholder="E-Mail" autocomplete="email" required><input id="a_p" type="password" placeholder="Passwort" autocomplete="current-password" required>
  ${msg ? `<div class="err">${esc(msg)}</div>` : ''}<button class="btn" type="submit">Anmelden</button></form>
  <p class="hint">Konten legt der Admin an. Eine Selbstregistrierung gibt es nicht.</p>
  ${window.LOCAL_MODE ? '<p class="hint">Vorschau ohne Server: Zugang <b>admin@demo.at</b> / <b>demo1234</b>. Daten werden nur in diesem Browser gespeichert.</p>' : ''}</div></div>`;
  $('#af').onsubmit = async ev => { ev.preventDefault(); try { await api('POST', '/login', { email: $('#a_e').value, password: $('#a_p').value }); boot(); } catch (e) { authScreen(e.message); } };
}
async function logout() { await api('POST', '/logout'); ST.me = null; ST.uid = null; authScreen(); }

/* ---------- Rahmen ---------- */
function shell(inner) {
  const badge = isAdmin() && ST.pend.users + ST.pend.absences ? `<span class="badge">${ST.pend.users + ST.pend.absences}</span>` : '';
  const tabs = [['zeit', 'Zeiterfassung'], ['berichte', 'Berichte'], ['urlaub', 'Urlaub & Feiertage'], ...(isAdmin() ? [['verwaltung', 'Verwaltung']] : [])];
  app.innerHTML = `<header class="top"><span class="app-name">Zeitfluss</span><nav class="tabs">${tabs.map(([k, l]) => `<button data-v="${k}" class="${ST.view === k ? 'on' : ''}">${l}${k === 'verwaltung' ? badge : ''}</button>`).join('')}</nav><span class="sp"></span>
  <button class="who" id="who" title="Passwort ändern"><span class="avatar">${esc(ST.me.name[0])}</span><div><b>${esc(ST.me.name)}</b><small>${isAdmin() ? 'Admin' : 'Mitarbeiter'}</small></div></button><button class="btn ghost sm" id="out">Abmelden</button>
  <div class="cabrand">${logo(38)}<div>CrazyAquarium<small>Zeiterfassung</small></div></div></header><main class="page">${inner}</main>`;
  document.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { ST.view = b.dataset.v; try { history.replaceState(null, '', '#' + ST.view); } catch (e) { } render(); });
  $('#out').onclick = logout; $('#who').onclick = pwModal;
}
function pwModal() {
  openModal(`<h2>Passwort ändern</h2><label for="pw_o">Altes Passwort</label><input id="pw_o" type="password"><label for="pw_n">Neues Passwort</label><input id="pw_n" type="password" placeholder="mind. 8 Zeichen"><div id="pw_e"></div><div class="acts"><button class="btn ghost" id="m_x">Abbrechen</button><button class="btn" id="m_ok">Ändern</button></div>`);
  $('#m_x').onclick = closeModal;
  $('#m_ok').onclick = async () => { try { await api('POST', '/me/password', { old: $('#pw_o').value, new: $('#pw_n').value }); closeModal(); toast('Passwort geändert'); } catch (e) { $('#pw_e').innerHTML = `<div class="err">${esc(e.message)}</div>`; } };
}
function render() { clearInterval(tick); ({ zeit, berichte, urlaub, verwaltung }[ST.view] || zeit)().catch(e => { if (e.status === 401) authScreen(); else toast(e.message); }); }
const userPicker = () => isAdmin() ? `<div class="card"><h3>Mitarbeiter</h3><select id="up" aria-label="Mitarbeiter">${ST.users.filter(u => u.status === 'active').map(u => `<option value="${u.id}" ${u.id === curUser().id ? 'selected' : ''}>${esc(u.name)}${u.role === 'admin' ? ' (Admin)' : ''}</option>`).join('')}</select></div>` : '';
const bindPicker = () => { const s = $('#up'); if (s) s.onchange = () => { ST.uid = s.value; render(); }; };
const monthPicker = () => `<div class="card"><h3>Zeitraum</h3><div class="yr"><button id="py" aria-label="Vorjahr">‹</button><span>${ST.y}</span><button id="ny" aria-label="Nächstes Jahr">›</button></div><div class="months">${MS.map((m, i) => `<button data-mo="${i}" class="${i === ST.m ? 'on' : ''}">${m}</button>`).join('')}</div><button class="btn ghost sm" id="td" style="margin-top:10px;width:100%">Heute</button></div>`;
function bindMonth() {
  $('#py').onclick = () => { ST.y--; render(); }; $('#ny').onclick = () => { ST.y++; render(); }; $('#td').onclick = () => { ST.y = now0.getFullYear(); ST.m = now0.getMonth(); render(); };
  document.querySelectorAll('[data-mo]').forEach(b => b.onclick = () => { ST.m = +b.dataset.mo; render(); });
}

/* ---------- Zeiterfassung ---------- */
async function monthData() {
  const u = curUser(), mFrom = `${ST.y}-${pad(ST.m + 1)}-01`, mTo = ymd(new Date(ST.y, ST.m + 1, 0));
  const from = u.start_date.slice(0, 10) < mFrom ? u.start_date.slice(0, 10) : mFrom;
  const D = await loadData(u, from, mTo), days = buildDays(D.user, from, mTo, D), today = ymd(new Date());
  const mDays = days.filter(d => d.k >= mFrom), before = days.filter(d => d.k < mFrom);
  const carry = D.user.opening_balance + sumDiff(before, today), upto = mDays.filter(d => d.k <= today);
  return { u: D.user, D, mDays, mFrom, mTo, today, carry, sollAll: mDays.reduce((t, d) => t + d.target, 0), sollNow: upto.reduce((t, d) => t + d.target, 0), istNow: upto.reduce((t, d) => t + d.ist, 0), locked: D.locks.includes(mFrom.slice(0, 7)) };
}
async function zeit() {
  const M = await monthData(), me = M.u.id === ST.me.id, canEdit = isAdmin() || !M.locked, run = me ? M.D.entries.find(e => !e.end) : null;
  const diff = M.istNow - M.sollNow, saldo = diff + M.carry, pr = id => ST.projects.find(p => p.id == id);
  const wdn = String(M.u.work_days).split(',').map(Number).sort(), WDS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  let list = '', lastW = null, wsum = {};
  M.mDays.forEach(d => { const w = isoWeek(d.date); (wsum[w] ||= { i: 0, t: 0 }); wsum[w].i += d.ist; wsum[w].t += d.target; });
  M.mDays.forEach(d => {
    const w = isoWeek(d.date);
    if (w !== lastW) { lastW = w; list += `<div class="wk"><span>KW ${w}</span><b>${hm(wsum[w].i)} / ${hm(wsum[w].t)} Std</b></div>`; }
    const cls = ['day']; if (!d.isWork) cls.push('off'); if (d.hol) cls.push('hol', 'off'); if (d.k === M.today) cls.push('today');
    let body = '';
    if (d.hol) body += `<div class="chip hol">Feiertag · ${esc(d.hol)}</div>`;
    if (d.isWork && !d.hol) d.abs.forEach(a => body += `<button class="abs" data-a="${a.id}" style="--c:${ABS[a.type].c}"><i></i>${ABS[a.type].l}${a.note ? ` <span>· ${esc(a.note)}</span>` : ''}<em class="st ${a.status}">${a.status}</em></button>`);
    d.es.forEach(e => { const p = pr(e.project_id), c = e.kind === 'arbeit' ? (p ? p.color : 'var(--blue)') : KIND[e.kind].c;
      body += `<button class="ln ${e.kind}" data-e="${e.id}"><span class="tm">${hhmm(e.start)} – ${e.end ? hhmm(e.end) : '<span class="pulse" style="margin:0"></span>'}</span><span class="tx"><i class="dot" style="background:${c}"></i><span>${esc(e.kind === 'arbeit' ? (p ? p.name : 'Arbeit') : KIND[e.kind].l)}</span>${e.description && e.kind === 'arbeit' ? `<small>${esc(e.description)}</small>` : ''}</span><span class="loc">${esc(e.location)}</span><span class="du">${e.kind === 'pause' ? '' : hm(dur(e))}</span></button>`; });
    if (!body && d.isWork) body = `<div class="nothing">${d.k <= M.today ? 'Keine Einträge' : ''}</div>`;
    const showT = d.isWork || d.ist > 0;
    list += `<div class="${cls.join(' ')}" data-k="${d.k}"><div class="dd"><span class="wd">${WD[d.date.getDay()]}</span><b>${d.date.getDate()}.</b></div><div class="dc">${body}</div><div class="dt">${showT ? `<b>${d.ist || d.k <= M.today ? hm(d.ist) : '–'}</b><small>/ ${hm(d.target)} Std</small>` : ''}</div>${canEdit ? `<button class="plus" data-add="${d.k}" aria-label="Eintrag am ${d.date.getDate()}. hinzufügen">＋</button>` : '<span></span>'}</div>`;
  });
  const timer = me && canEdit ? `<div class="card timer">${run ? `<div class="clock" id="clk">0:00:00</div><div class="f"><div><b>${esc(pr(run.project_id)?.name || 'Arbeit')}</b><div class="hint" style="margin:0">seit ${hhmm(run.start)} Uhr${run.description ? ' · ' + esc(run.description) : ''}</div></div></div><button class="btn stop" id="tbtn">■ Stoppen</button>`
    : `<div class="clock">0:00:00</div><div class="f"><select id="tp" aria-label="Projekt">${ST.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><input id="td2" placeholder="Beschreibung (optional)" aria-label="Beschreibung"></div><button class="btn" id="tbtn">▶ Starten</button>`}</div>` : '';
  const vac = await vacation(M.u, ST.y);
  shell(`<div class="cols"><div class="side">${userPicker()}${monthPicker()}</div>
  <div>${timer}<div class="card"><div class="mhead"><h2>${MON[ST.m]} ${ST.y}</h2><div class="tools">${M.locked ? '<span class="pill lock">Monat freigegeben · gesperrt</span>' : ''}<button class="btn ghost sm" id="csv">Export</button>${canEdit ? '<button class="btn sm" id="addb">＋ Eintrag</button>' : ''}</div></div>${list}</div></div>
  <div class="side"><div class="card"><div style="display:flex;gap:12px;align-items:center;margin-bottom:12px"><span class="avatar" style="width:44px;height:44px;font-size:18px">${esc(M.u.name[0])}</span><div><b>${esc(M.u.name)}</b><div class="hint" style="margin:0">${esc(M.u.department || 'Mitarbeiter')}</div></div></div>
  <div class="sum"><span>Arbeitszeit</span><b>${de(M.u.weekly_hours)} Std / Woche</b></div><div class="sum"><span>Arbeitstage</span><b>${wdn.map(n => WDS[n - 1]).join(' ')}</b></div>
  ${isAdmin() ? `<div class="sep"></div><button class="btn ${M.locked ? 'ghost' : 'green'} sm" id="lock" style="width:100%">${M.locked ? 'Monat wieder öffnen' : 'Monat freigeben (sperren)'}</button>` : ''}</div>
  <div class="card"><h3>Stunden · ${MS[ST.m]} ${ST.y}</h3><div class="sum"><span>Soll Monat</span><b>${hm(M.sollAll)} Std</b></div><div class="sum"><span>Soll bis heute</span><b>${hm(M.sollNow)} Std</b></div><div class="sum"><span>Geleistet</span><b>${hm(M.istNow)} Std</b></div><div class="sum"><span>Differenz Monat</span><b class="${diff >= 0 ? 'pos' : 'neg'}">${hm(diff)} Std</b></div>
  <div class="sum"><span>+ Übertrag Vormonat</span><b>${hm(M.carry)} Std</b></div><div class="sum tot"><span>Saldo</span><b class="${saldo >= 0 ? 'pos' : 'neg'}">${hm(saldo)} Std</b></div></div>
  <div class="card"><h3>Urlaub ${ST.y}</h3><div class="sum"><span>Anspruch</span><b>${vac.total} Tage</b></div><div class="sum"><span>Genommen</span><b>${vac.used} Tage</b></div><div class="sum"><span>Beantragt</span><b>${vac.asked} Tage</b></div><div class="sum tot"><span>Rest</span><b>${vac.left} Tage</b></div><div class="bar"><i style="width:${Math.min(100, (vac.used + vac.asked) / (vac.total || 1) * 100)}%"></i></div></div></div></div>`);
  bindPicker(); bindMonth();
  if (run) { const c = $('#clk'), up = () => { const s = Math.floor((Date.now() - run.start) / 1000); c.textContent = `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; }; up(); tick = setInterval(up, 1000); }
  const tb = $('#tbtn'); if (tb) tb.onclick = async () => { try { run ? await api('POST', '/timer/stop') : await api('POST', '/timer/start', { project_id: $('#tp').value, description: $('#td2').value }); toast(run ? 'Timer gestoppt' : 'Timer gestartet'); render(); } catch (e) { toast(e.message); } };
  document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => entryModal({ date: b.dataset.add, M }));
  $('#addb') && ($('#addb').onclick = () => entryModal({ date: M.mDays.some(d => d.k === M.today) ? M.today : M.mFrom, M }));
  document.querySelectorAll('[data-e]').forEach(b => b.onclick = () => entryModal({ entry: M.D.entries.find(e => e.id == b.dataset.e), M, canEdit }));
  document.querySelectorAll('[data-a]').forEach(b => b.onclick = () => absModal(M.D.absences.find(a => a.id == b.dataset.a), M));
  $('#lock') && ($('#lock').onclick = async () => { await api('PUT', '/locks', { user_id: M.u.id, ym: M.mFrom.slice(0, 7), locked: !M.locked }); toast(M.locked ? 'Monat geöffnet' : 'Monat freigegeben'); render(); });
  $('#csv').onclick = () => csvModal(M);
}
function csvModal(M) {
  const pr = id => ST.projects.find(p => p.id == id)?.name || '';
  const rows = ['Datum;Von;Bis;Art;Projekt;Ort;Beschreibung;Stunden', ...M.D.entries.filter(e => ymd(e.start) >= M.mFrom).map(e => [ymd(e.start), hhmm(e.start), e.end ? hhmm(e.end) : '', KIND[e.kind].l, pr(e.project_id), e.location, e.description, e.kind === 'pause' ? '' : dur(e).toFixed(2).replace('.', ',')].join(';'))].join('\n');
  openModal(`<h2>Export ${MON[ST.m]} ${ST.y}</h2><p class="hint" style="margin:0 0 10px">Alle Zeiteinträge des Monats als CSV (Excel, Trennzeichen Strichpunkt).</p><textarea id="csvt" readonly style="width:100%;height:220px;border-radius:12px;background:var(--fill);border:0;padding:12px;font:12px/1.5 ui-monospace,Menlo,monospace;color:var(--text)">${esc(rows)}</textarea><div class="acts"><button class="btn ghost" id="m_x">Schließen</button><button class="btn" id="cp">Kopieren</button></div>`);
  $('#m_x').onclick = closeModal; $('#cp').onclick = async () => { try { await navigator.clipboard.writeText(rows); toast('Kopiert'); } catch (e) { $('#csvt').select(); toast('Text markiert'); } };
}

/* ---------- Eintrag / Antrag erfassen ---------- */
function entryModal({ date, entry, M, canEdit = true, forceKind }) {
  const e = entry, isNew = !e, lockedMsg = !canEdit ? '<div class="err">Dieser Monat ist gesperrt. Änderungen nur durch den Admin.</div>' : '';
  let kind = e ? e.kind : (forceKind || 'arbeit');
  const dflt = () => { const last = M.mDays.find(d => d.k === date)?.es.filter(x => x.end).pop(); const s = last ? last.end : new Date(`${date}T08:00`); return [hhmm(s), hhmm(new Date(s.getTime() + 36e5 * (kind === 'pause' ? .5 : 4)))]; };
  const [ds, de2] = e ? [hhmm(e.start), e.end ? hhmm(e.end) : ''] : dflt();
  const draw = () => {
    const abs = !!ABS[kind];
    openModal(`<h2>${isNew ? 'Neuer Eintrag' : 'Eintrag bearbeiten'}</h2>${isNew ? `<div class="kinds">${Object.entries(ALL).map(([k, v]) => `<button data-k="${k}" class="${k === kind ? 'on' : ''}" style="--c:${v.c}"><i class="dot" style="background:${v.c}"></i>${v.l}</button>`).join('')}</div>` : `<div class="chip" style="background:var(--fill)"><i class="dot" style="background:${KIND[kind].c}"></i>${KIND[kind].l}</div>`}
    ${abs ? `<div class="two"><div><label for="f_d">Von</label><input type="date" id="f_d" value="${date}"></div><div><label for="f_d2">Bis</label><input type="date" id="f_d2" value="${date}"></div></div><label for="f_n">Notiz</label><input id="f_n" placeholder="optional">
      <p class="hint">${ABS[kind].ask && !isAdmin() ? 'Dieser Antrag muss vom Admin genehmigt werden. Bis dahin zählt er nicht als Arbeitszeit.' : 'Wird sofort eingetragen und zählt als Soll-Arbeitszeit. Wochenenden und Feiertage werden übersprungen.'}</p>`
    : `<div class="two"><div><label for="f_d">Datum</label><input type="date" id="f_d" value="${e ? ymd(e.start) : date}"></div><div><label for="f_l">Ort</label><select id="f_l">${LOCS.map(l => `<option ${l === (e ? e.location : (kind === 'arzt' ? 'Außer Haus' : 'Büro')) ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div><label for="f_s">Von</label><input type="time" id="f_s" value="${ds}"></div><div><label for="f_e">Bis</label><input type="time" id="f_e" value="${de2}"></div></div>
      ${kind === 'arbeit' ? `<label for="f_p">Projekt</label><select id="f_p">${ST.projects.map(p => `<option value="${p.id}" ${e && e.project_id == p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select><label for="f_n">Beschreibung</label><input id="f_n" value="${esc(e ? e.description : '')}" placeholder="z. B. Fixed Issue 0003571">` : kind === 'arzt' ? '<p class="hint">Arzt- und Behördenwege zählen als Arbeitszeit.</p>' : '<p class="hint">Pausen zählen nicht als Arbeitszeit.</p>'}`}
    <div id="f_err">${lockedMsg}</div><div class="acts">${e && canEdit ? '<button class="btn danger sm" id="f_del" style="margin-right:auto">Löschen</button>' : ''}<button class="btn ghost" id="m_x">Abbrechen</button>${canEdit ? '<button class="btn" id="m_ok">Sichern</button>' : ''}</div>`);
    $('#m_x').onclick = closeModal;
    document.querySelectorAll('.kinds [data-k]').forEach(b => b.onclick = () => { kind = b.dataset.k; draw(); });
    const err = t => $('#f_err').innerHTML = `<div class="err">${esc(t)}</div>`;
    if (e && canEdit) $('#f_del').onclick = async () => { try { await api('DELETE', '/entries/' + e.id); closeModal(); toast('Gelöscht'); render(); } catch (x) { err(x.message); } };
    if (canEdit) $('#m_ok').onclick = async () => {
      try {
        if (abs) { const r = await api('POST', '/absences', { user_id: M.u.id, type: kind, date_from: $('#f_d').value, date_to: $('#f_d2').value || $('#f_d').value, note: $('#f_n').value }); toast(r.status === 'beantragt' ? 'Antrag gestellt' : 'Eingetragen'); }
        else {
          const d = $('#f_d').value, b = { user_id: M.u.id, kind, project_id: kind === 'arbeit' ? $('#f_p').value : null, description: kind === 'arbeit' ? $('#f_n').value : '', location: $('#f_l').value, start_at: `${d} ${$('#f_s').value}:00`, end_at: $('#f_e').value ? `${d} ${$('#f_e').value}:00` : null };
          isNew ? await api('POST', '/entries', b) : await api('PUT', '/entries/' + e.id, b); toast('Gesichert');
        }
        closeModal(); ST.pendDirty = true; if (isAdmin()) ST.pend = await api('GET', '/admin/pending'); render();
      } catch (x) { err(x.message); }
    };
  };
  draw();
}
function absModal(a, M) {
  const can = isAdmin() || (a.status === 'beantragt' && a.user_id === ST.me.id), n = absDays(a, M.u, M.D.hol);
  openModal(`<h2>${ABS[a.type].l}</h2><div class="sum"><span>Zeitraum</span><b>${a.date_from.slice(8, 10)}.${a.date_from.slice(5, 7)}. – ${a.date_to.slice(8, 10)}.${a.date_to.slice(5, 7)}.${a.date_to.slice(0, 4)}</b></div><div class="sum"><span>Arbeitstage</span><b>${n}</b></div><div class="sum"><span>Status</span><em class="st ${a.status}">${a.status}</em></div>${a.note ? `<div class="sum"><span>Notiz</span><b>${esc(a.note)}</b></div>` : ''}
  <div class="acts">${can ? `<button class="btn danger sm" id="a_del" style="margin-right:auto">${a.status === 'beantragt' && !isAdmin() ? 'Antrag zurückziehen' : 'Löschen'}</button>` : ''}${isAdmin() && a.status !== 'genehmigt' ? '<button class="btn green sm" id="a_ok">Genehmigen</button>' : ''}${isAdmin() && a.status === 'beantragt' ? '<button class="btn ghost sm" id="a_no">Ablehnen</button>' : ''}<button class="btn ghost" id="m_x">Schließen</button></div>`);
  $('#m_x').onclick = closeModal;
  const done = async t => { closeModal(); toast(t); if (isAdmin()) ST.pend = await api('GET', '/admin/pending'); render(); };
  $('#a_del') && ($('#a_del').onclick = async () => { try { await api('DELETE', '/absences/' + a.id); done('Gelöscht'); } catch (e) { toast(e.message); } });
  $('#a_ok') && ($('#a_ok').onclick = async () => { await api('PUT', `/absences/${a.id}/status`, { status: 'genehmigt' }); done('Genehmigt'); });
  $('#a_no') && ($('#a_no').onclick = async () => { await api('PUT', `/absences/${a.id}/status`, { status: 'abgelehnt' }); done('Abgelehnt'); });
}

/* ---------- Urlaub ---------- */
async function vacation(u, y) {
  const D = await loadData(u, `${y}-01-01`, `${y}-12-31`), v = D.absences.filter(a => a.type === 'urlaub');
  const cnt = st => v.filter(a => a.status === st).reduce((t, a) => t + absDays({ ...a, date_from: a.date_from < `${y}-01-01` ? `${y}-01-01` : a.date_from, date_to: a.date_to > `${y}-12-31` ? `${y}-12-31` : a.date_to }, D.user, D.hol), 0);
  const used = cnt('genehmigt'), asked = cnt('beantragt');
  return { total: D.user.vacation_days, used, asked, left: D.user.vacation_days - used - asked, D };
}
async function urlaub() {
  const u = curUser(), y = ST.abY, vac = await vacation(u, y), D = vac.D;
  const list = D.absences.slice().sort((a, b) => a.date_from < b.date_from ? 1 : -1), hol = Object.entries(D.hol).sort();
  shell(`<div class="head"><div><h1>Urlaub & Feiertage</h1><p>${esc(u.name)} · ${y}</p></div><div class="tools">${isAdmin() ? `<select id="up" style="width:auto" aria-label="Mitarbeiter">${ST.users.filter(x => x.status === 'active').map(x => `<option value="${x.id}" ${x.id === u.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : ''}<div class="seg"><button id="py">‹</button><button class="on">${y}</button><button id="ny">›</button></div><button class="btn" id="req">＋ Urlaub beantragen</button></div></div>
  <div class="grid g4 mb"><div class="card stat"><h3>Anspruch</h3><b>${vac.total}</b><small>Tage pro Jahr (vom Admin festgelegt)</small></div><div class="card stat"><h3>Genommen</h3><b>${vac.used}</b><small>genehmigte Arbeitstage</small></div><div class="card stat"><h3>Beantragt</h3><b style="color:var(--orange)">${vac.asked}</b><small>warten auf Genehmigung</small></div><div class="card stat"><h3>Resturlaub</h3><b class="${vac.left >= 0 ? 'pos' : 'neg'}">${vac.left}</b><small>Tage verfügbar</small><div class="bar"><i style="width:${Math.min(100, (vac.used + vac.asked) / (vac.total || 1) * 100)}%"></i></div></div></div>
  <div class="grid g2"><div class="card"><h3>Abwesenheiten ${y}</h3><div class="list">${list.map(a => `<div class="row"><i class="dot" style="background:${ABS[a.type].c}"></i><div class="t"><b>${ABS[a.type].l} <em class="st ${a.status}" style="margin-left:6px">${a.status}</em></b><small>${a.date_from.slice(8, 10)}.${a.date_from.slice(5, 7)}. – ${a.date_to.slice(8, 10)}.${a.date_to.slice(5, 7)}. · ${absDays(a, D.user, D.hol)} Arbeitstage${a.note ? ' · ' + esc(a.note) : ''}</small></div>${a.status === 'beantragt' && !isAdmin() ? `<button class="btn ghost sm" data-del="${a.id}">Zurückziehen</button>` : ''}</div>`).join('') || '<p class="empty">Noch keine Einträge. Mit „Urlaub beantragen“ legst du einen Antrag an.</p>'}</div></div>
  <div class="card"><h3>Feiertage Österreich ${y}</h3><div class="list">${hol.map(([k, n]) => { const d = new Date(k + 'T12:00'), we = d.getDay() % 6 === 0; return `<div class="row"><i class="dot" style="background:var(--red)"></i><div class="t"><b>${esc(n)}</b><small>${WDL[d.getDay()]}, ${d.getDate()}. ${MON[d.getMonth()]}${we ? ' · fällt auf das Wochenende' : ''}</small></div></div>`; }).join('')}</div></div></div>`);
  bindPicker(); $('#py').onclick = () => { ST.abY--; render(); }; $('#ny').onclick = () => { ST.abY++; render(); };
  const M = { u: D.user, D, mDays: [], mFrom: `${y}-01-01` };
  $('#req').onclick = () => entryModal({ date: ymd(new Date()), M, forceKind: 'urlaub' });
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await api('DELETE', '/absences/' + b.dataset.del); toast('Antrag zurückgezogen'); render(); });
}

/* ---------- Berichte ---------- */
async function berichte() {
  const M = await monthData(), pm = {};
  M.D.entries.filter(e => ymd(e.start) >= M.mFrom && e.kind === 'arbeit').forEach(e => { const k = e.project_id || 0; pm[k] = (pm[k] || 0) + dur(e); });
  const items = Object.entries(pm).map(([k, h]) => { const p = ST.projects.find(x => x.id == k); return { name: p ? p.name : 'Ohne Projekt', color: p ? p.color : '#8e8e93', hours: h }; }).sort((a, b) => b.hours - a.hours), tot = items.reduce((t, i) => t + i.hours, 0);
  const diff = M.istNow - M.sollNow, abs = M.mDays.filter(d => d.credit || d.abs.some(a => a.status === 'genehmigt' && d.target)).length;
  const arzt = M.D.entries.filter(e => ymd(e.start) >= M.mFrom && e.kind === 'arzt').reduce((t, e) => t + dur(e), 0);
  shell(`<div class="head"><div><h1>Berichte</h1><p>${esc(M.u.name)} · ${MON[ST.m]} ${ST.y}</p></div><div class="tools">${isAdmin() ? `<select id="up" style="width:auto" aria-label="Mitarbeiter">${ST.users.filter(x => x.status === 'active').map(x => `<option value="${x.id}" ${x.id === M.u.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : ''}<div class="seg"><button id="pm">‹</button><button class="on">${MS[ST.m]} ${ST.y}</button><button id="nm">›</button></div></div></div>
  <div class="grid g4 mb"><div class="card stat"><h3>Geleistet</h3><b>${hm(M.istNow)}</b><small>Stunden bis heute</small></div><div class="card stat"><h3>Soll bis heute</h3><b>${hm(M.sollNow)}</b><small>von ${hm(M.sollAll)} im Monat</small></div><div class="card stat"><h3>Differenz</h3><b class="${diff >= 0 ? 'pos' : 'neg'}">${hm(diff)}</b><small>Saldo inkl. Übertrag ${hm(diff + M.carry)}</small></div><div class="card stat"><h3>Abwesenheit</h3><b>${abs}</b><small>Tage · Arzt/Behörde ${hm(arzt)} Std</small></div></div>
  <div class="grid g2"><div class="card"><h3>Stunden pro Tag</h3>${barChart(M.mDays, 800, 270)}<small style="color:var(--sub)">Orange Linie = Tages-Soll · Lila = Abwesenheit</small></div><div class="card"><h3>Nach Projekt</h3>${items.length ? `<div style="display:flex;justify-content:center">${donut(items, tot)}</div><div class="legend">${items.map(p => `<div><span class="dot" style="background:${p.color}"></span><span>${esc(p.name)}</span><span>${hm(p.hours)} h</span></div>`).join('')}</div>` : '<p class="empty">Keine Arbeitszeiten in diesem Monat.</p>'}</div></div>`);
  bindPicker(); const step = n => { ST.m += n; if (ST.m < 0) { ST.m = 11; ST.y--; } if (ST.m > 11) { ST.m = 0; ST.y++; } render(); };
  $('#pm').onclick = () => step(-1); $('#nm').onclick = () => step(1);
}

/* ---------- Verwaltung (Admin) ---------- */
async function verwaltung() {
  if (!isAdmin()) { ST.view = 'zeit'; return render(); }
  await loadBase(); const t = ST.tab;
  let body = '';
  if (t === 'users') {
    const sorted = ST.users.slice().sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || a.name.localeCompare(b.name));
    body = `<div class="card scroll"><table class="table"><thead><tr><th>Name</th><th>E-Mail</th><th>Status</th><th>Std / Woche</th><th>Urlaub</th><th></th></tr></thead><tbody>${sorted.map(u => `<tr class="click" data-u="${u.id}"><td><b>${esc(u.name)}</b><div class="hint" style="margin:0">${u.role === 'admin' ? 'Admin' : esc(u.department || 'Mitarbeiter')}</div></td><td>${esc(u.email)}</td><td><em class="st ${u.status === 'active' ? 'genehmigt' : u.status === 'pending' ? 'beantragt' : 'abgelehnt'}">${{ active: 'aktiv', pending: 'wartet', disabled: 'deaktiviert' }[u.status]}</em></td><td>${de(u.weekly_hours)}</td><td>${u.vacation_days} Tage</td><td style="text-align:right">${u.status === 'pending' ? `<button class="btn green sm" data-act="${u.id}">Freischalten</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  } else if (t === 'req') {
    const L = await api('GET', '/admin/absences?status=all');
    body = `<div class="card"><div class="list">${L.map(a => `<div class="row"><i class="dot" style="background:${ABS[a.type].c}"></i><div class="t"><b>${esc(a.user_name)} · ${ABS[a.type].l} <em class="st ${a.status}" style="margin-left:6px">${a.status}</em></b><small>${a.date_from.slice(8, 10)}.${a.date_from.slice(5, 7)}. – ${a.date_to.slice(8, 10)}.${a.date_to.slice(5, 7)}.${a.date_to.slice(0, 4)}${a.note ? ' · ' + esc(a.note) : ''}</small></div>${a.status === 'beantragt' ? `<button class="btn green sm" data-ok="${a.id}">Genehmigen</button><button class="btn ghost sm" data-no="${a.id}">Ablehnen</button>` : ''}</div>`).join('') || '<p class="empty">Keine Anträge.</p>'}</div></div>`;
  } else {
    body = `<div class="card"><div class="list">${ST.projects.map(p => `<div class="row"><i class="dot" style="background:${p.color};width:14px;height:14px"></i><div class="t"><b>${esc(p.name)}</b></div><button class="btn ghost sm" data-p="${p.id}">Bearbeiten</button></div>`).join('')}</div></div>`;
  }
  shell(`<div class="head"><div><h1>Verwaltung</h1><p>Nur der Admin legt Mitarbeiter an, setzt Wochenstunden und Urlaubstage fest und genehmigt Anträge.</p></div><div class="tools"><div class="seg">${[['users', 'Mitarbeiter' + (ST.pend.users ? ` (${ST.pend.users})` : '')], ['req', 'Anträge' + (ST.pend.absences ? ` (${ST.pend.absences})` : '')], ['proj', 'Projekte']].map(([k, l]) => `<button data-t="${k}" class="${t === k ? 'on' : ''}">${l}</button>`).join('')}</div>${t === 'users' ? '<button class="btn" id="nu">＋ Mitarbeiter</button>' : t === 'proj' ? '<button class="btn" id="np">＋ Projekt</button>' : ''}</div></div>${body}`);
  document.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { ST.tab = b.dataset.t; verwaltung(); });
  document.querySelectorAll('[data-u]').forEach(r => r.onclick = ev => { if (!ev.target.closest('[data-act]')) userModal(ST.users.find(u => u.id == r.dataset.u)); });
  document.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => { const u = ST.users.find(x => x.id == b.dataset.act); await api('PUT', '/users/' + u.id, { ...u, status: 'active' }); toast(u.name + ' freigeschaltet'); verwaltung(); });
  document.querySelectorAll('[data-ok],[data-no]').forEach(b => b.onclick = async () => { await api('PUT', `/absences/${b.dataset.ok || b.dataset.no}/status`, { status: b.dataset.ok ? 'genehmigt' : 'abgelehnt' }); toast(b.dataset.ok ? 'Genehmigt' : 'Abgelehnt'); verwaltung(); });
  $('#nu') && ($('#nu').onclick = () => userModal()); $('#np') && ($('#np').onclick = () => projModal());
  document.querySelectorAll('[data-p]').forEach(b => b.onclick = () => projModal(ST.projects.find(p => p.id == b.dataset.p)));
}
function userModal(u) {
  const isNew = !u, adminU = u && u.role === 'admin'; u = u || { name: '', email: '', department: '', weekly_hours: 38.5, vacation_days: 25, work_days: '1,2,3,4,5', start_date: ymd(new Date()), opening_balance: 0, status: 'active' };
  const wd = String(u.work_days).split(',').map(Number);
  openModal(`<h2>${isNew ? 'Neuer Mitarbeiter' : esc(u.name)}</h2><label for="u_n">Name</label><input id="u_n" value="${esc(u.name)}"><div class="two"><div><label for="u_e">E-Mail</label><input id="u_e" type="email" value="${esc(u.email)}"></div><div><label for="u_dep">Abteilung</label><input id="u_dep" value="${esc(u.department)}"></div>
  <div><label for="u_h">Wochenstunden (Soll)</label><input id="u_h" type="number" step="0.5" min="0" value="${u.weekly_hours}"></div><div><label for="u_v">Urlaubstage / Jahr</label><input id="u_v" type="number" step="0.5" min="0" value="${u.vacation_days}"></div>
  <div><label for="u_s">Eintritt</label><input id="u_s" type="date" value="${u.start_date.slice(0, 10)}"></div><div><label for="u_o">Zeitsaldo bei Eintritt (Std)</label><input id="u_o" type="number" step="0.25" value="${u.opening_balance}"></div></div>
  <label>Arbeitstage</label><div class="seg full" id="u_wd">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d, i) => `<button type="button" data-wd="${i + 1}" class="${wd.includes(i + 1) ? 'on' : ''}">${d}</button>`).join('')}</div>
  ${adminU ? '' : `<label for="u_st">Status</label><select id="u_st">${[['active', 'aktiv'], ['disabled', 'deaktiviert'], ...(u.status === 'pending' ? [['pending', 'wartet auf Freischaltung']] : [])].map(([k, l]) => `<option value="${k}" ${u.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`}
  <label for="u_p">${isNew ? 'Passwort (mind. 8 Zeichen)' : 'Neues Passwort setzen (optional)'}</label><input id="u_p" type="password" autocomplete="new-password"><div id="f_err"></div><div class="acts">${isNew || adminU ? '' : '<button class="btn danger sm" id="u_del" style="margin-right:auto">Mitarbeiter löschen</button>'}<button class="btn ghost" id="m_x">Abbrechen</button><button class="btn" id="m_ok">Sichern</button></div>`);
  $('#m_x').onclick = closeModal; document.querySelectorAll('[data-wd]').forEach(b => b.onclick = () => b.classList.toggle('on'));
  const del = $('#u_del');
  if (del) del.onclick = async () => {
    if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = 'Wirklich löschen? Alle Zeiten gehen verloren'; $('#f_err').innerHTML = '<div class="err">Das Löschen kann nicht rückgängig gemacht werden. Zum Behalten der Daten stattdessen oben den Status auf „deaktiviert“ stellen.</div>'; return; }
    try { await api('DELETE', '/users/' + u.id); closeModal(); toast('Mitarbeiter gelöscht'); ST.uid = null; verwaltung(); } catch (e) { $('#f_err').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  };
  $('#m_ok').onclick = async () => {
    const b = { name: $('#u_n').value.trim(), email: $('#u_e').value.trim(), department: $('#u_dep').value, weekly_hours: $('#u_h').value, vacation_days: $('#u_v').value, start_date: $('#u_s').value, opening_balance: $('#u_o').value, work_days: [...document.querySelectorAll('[data-wd].on')].map(x => x.dataset.wd).join(','), status: $('#u_st') ? $('#u_st').value : 'active', password: $('#u_p') ? $('#u_p').value : '' };
    if (!b.work_days) return $('#f_err').innerHTML = '<div class="err">Mindestens ein Arbeitstag</div>';
    try { isNew ? await api('POST', '/users', b) : await api('PUT', '/users/' + u.id, b); closeModal(); toast('Gesichert'); verwaltung(); } catch (e) { $('#f_err').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  };
}
function projModal(p) {
  const isNew = !p; p = p || { name: '', color: '#0a84ff' };
  openModal(`<h2>${isNew ? 'Neues Projekt' : 'Projekt bearbeiten'}</h2><label for="p_n">Name</label><input id="p_n" value="${esc(p.name)}"><label for="p_c">Farbe</label><input id="p_c" type="color" value="${p.color}" style="height:44px;padding:4px"><div class="acts">${isNew ? '' : '<button class="btn danger sm" id="p_d" style="margin-right:auto">Archivieren</button>'}<button class="btn ghost" id="m_x">Abbrechen</button><button class="btn" id="m_ok">Sichern</button></div>`);
  $('#m_x').onclick = closeModal;
  $('#m_ok').onclick = async () => { const b = { name: $('#p_n').value.trim() || 'Projekt', color: $('#p_c').value }; isNew ? await api('POST', '/projects', b) : await api('PUT', '/projects/' + p.id, b); closeModal(); toast('Gesichert'); verwaltung(); };
  $('#p_d') && ($('#p_d').onclick = async () => { await api('DELETE', '/projects/' + p.id); closeModal(); toast('Archiviert'); verwaltung(); });
}
boot();
