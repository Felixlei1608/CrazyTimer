// Gesetzliche Feiertage Österreich (inkl. bewegliche Feiertage nach Ostern)
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, mo - 1, da);
}
function holidays(y) {
  const E = easter(y), off = n => { const d = new Date(E); d.setDate(d.getDate() + n); return ymd(d); };
  return [[`${y}-01-01`, 'Neujahr'], [`${y}-01-06`, 'Heilige Drei Könige'], [off(1), 'Ostermontag'], [`${y}-05-01`, 'Staatsfeiertag'],
    [off(39), 'Christi Himmelfahrt'], [off(50), 'Pfingstmontag'], [off(60), 'Fronleichnam'], [`${y}-08-15`, 'Mariä Himmelfahrt'],
    [`${y}-10-26`, 'Nationalfeiertag'], [`${y}-11-01`, 'Allerheiligen'], [`${y}-12-08`, 'Mariä Empfängnis'],
    [`${y}-12-25`, 'Christtag'], [`${y}-12-26`, 'Stefanitag']];
}
module.exports = { holidays, ymd };
