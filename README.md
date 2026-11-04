# CrazyTimer – Arbeitszeiterfassung (Zeitfluss)

Zeiterfassung im Apple-Design mit Mehrbenutzer-Anmeldung, Urlaubsanträgen, österreichischen Feiertagen und Admin-Verwaltung.
Backend: Node.js + Express, eigene **MySQL/MariaDB**-Datenbank `zeiterfassung`.

## Funktionen
- **Zeiterfassung (Monatsliste)** mit KW-Gruppierung, Soll/Ist pro Tag und Woche, Timer (Stempeln), Wochenenden und Feiertage markiert
- **Einträge:** Arbeit (Projekt, Ort, Beschreibung), Pause, Arzt/Behördenweg (zählt als Arbeitszeit), Urlaub, Krankenstand, Sonderurlaub, Zeitausgleich
- **Stundenübersicht:** Soll Monat, Soll bis heute, Geleistet, Differenz, Übertrag Vormonat, Saldo
- **Feiertage Österreich** (13 gesetzliche inkl. Ostermontag, Christi Himmelfahrt, Pfingstmontag, Fronleichnam) werden automatisch in der DB geführt und in der Liste markiert
- **Anmeldung & Registrierung**, mehrere Benutzer. Der **erste registrierte Benutzer ist der einzige Admin**, weitere Registrierungen sind „wartend“ bis der Admin sie freischaltet
- **Nur der Admin** legt Mitarbeiter an, ändert Wochenstunden, Urlaubstage, Arbeitstage und Zeitsaldo, genehmigt/lehnt Urlaubs-, Sonderurlaubs- und Zeitausgleichsanträge ab, verwaltet Projekte und gibt Monate frei (sperrt sie)
- Krankenstand wird sofort eingetragen, Urlaub/Sonderurlaub/Zeitausgleich sind Anträge (Status beantragt / genehmigt / abgelehnt)
- Berichte (Diagramme), Urlaub & Feiertage, CSV-Export, Hell/Dunkel automatisch

## Start
```bash
mysql -uroot < db/schema.sql            # legt Datenbank und Tabellen an (löscht bestehende Zeitfluss-Tabellen!)
mysql -uroot -e "CREATE USER 'zeit'@'localhost' IDENTIFIED BY 'zeit'; GRANT ALL ON zeiterfassung.* TO 'zeit'@'localhost';"
npm install
node db/seed.js                         # optional: Demo-Daten (leert die Tabellen)
npm start                               # http://localhost:3100
```
Ohne Demo-Daten registriert sich der erste Benutzer selbst und wird dadurch Admin.
Umgebungsvariablen: `DB_HOST DB_USER DB_PASS DB_NAME PORT`.

Demo-Logins (nach `db/seed.js`): `felix@crazyaquarium.at` / `Aquarium2026` (Admin), `anna@crazyaquarium.at` und `max@crazyaquarium.at` / `demo1234`.

## Demo ohne Server (GitHub Pages)
Auf `https://<name>.github.io/CrazyTimer/` läuft automatisch die Browser-Demo (Beispieldaten, nichts wird gespeichert), weil Pages weder Node noch MySQL ausführt. Lokal testen: `http://localhost:3100/?demo`.

Einzelne HTML-Datei bauen:
`node demo/build.js` baut eine einzelne HTML-Datei, in der ein Browser-Mock die API ersetzt.

## Screenshots
Siehe `screenshots/`.
