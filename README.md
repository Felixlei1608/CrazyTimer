# CrazyTimer – Arbeitszeiterfassung (Zeitfluss)

Zeiterfassung im Apple-Design mit Mehrbenutzer-Anmeldung, Urlaubsanträgen, österreichischen Feiertagen und Admin-Verwaltung.
Datenbank: **Supabase (Postgres)** mit Anmeldung und Zugriffsregeln, die App läuft als statische Seite auf **GitHub Pages**. Alternativ gibt es einen eigenen Node.js-Server mit MySQL (siehe unten).

## Dauerhaft speichern mit Supabase (empfohlen, läuft auf GitHub Pages)
Die Daten liegen in einer Supabase-Datenbank (Projekt **CrazyTime**) und werden für alle Benutzer gemeinsam und dauerhaft gespeichert. Die Seite selbst bleibt auf GitHub Pages. **Es gibt keine Selbstregistrierung:** Anmelden können nur Konten, die der Admin angelegt hat.

1. Auf [supabase.com](https://supabase.com) ein Konto anlegen und **New project** erstellen, Name `CrazyTime`, Region z. B. Frankfurt. Das Datenbank-Passwort sicher aufbewahren.
2. **SQL Editor → New query**: Inhalt von `supabase/schema.sql` einfügen. **Vorher** in der Zeile `insert into public.app_settings … 'DEINE@EMAIL.AT'` deine Admin-E-Mail eintragen, dann **Run**. Das legt Tabellen, Zugriffsregeln (Row Level Security) und alle österreichischen Feiertage 2024–2045 an.
3. **Edge Functions → Deploy a new function → Via Editor**: Name `admin-users`, den Inhalt von `supabase/functions/admin-users/index.ts` einfügen, **Deploy**. Diese Funktion legt Mitarbeiter-Konten an und setzt Passwörter. Sie prüft bei jedem Aufruf, dass der Aufrufer der Admin ist. Der `service_role` key bleibt auf dem Supabase-Server und kommt nie in den Browser.
4. **Admin-Konto anlegen:** **Authentication → Users → Add user → Create new user** mit der Admin-E-Mail aus Schritt 2 und einem Passwort, „Auto Confirm User“ anhaken. Dieses Konto wird automatisch Admin.
5. **Authentication → Sign In / Providers**: **„Allow new users to sign up“ ausschalten**, damit sich niemand selbst registrieren kann.
6. **Project Settings → API**: *Project URL* und den *anon public* key kopieren und in `public/config.js` eintragen, dann committen und pushen. Der anon key ist öffentlich gedacht. **Den `service_role` key nie eintragen.**
7. Seite öffnen, als Admin anmelden, unter **Verwaltung → ＋ Mitarbeiter** Konten mit Passwort, Wochenstunden und Urlaubstagen anlegen und die Zugangsdaten weitergeben.

**Wie der Schutz funktioniert:** Die Regeln stehen in der Datenbank, nicht im Browser. Es gibt genau einen Admin. Mitarbeiter sehen nur ihre eigenen Daten und können weder Wochenstunden, Urlaubstage noch ihre Rolle ändern. Urlaub, Sonderurlaub und Zeitausgleich sind Anträge, die nur der Admin genehmigt. In einem vom Admin freigegebenen (gesperrten) Monat kann nur der Admin ändern. Ein Konto, das nicht über die Funktion angelegt wurde, bleibt ohne Zugriff.

**Grenze mit Supabase:** Die E-Mail-Adresse eines Kontos lässt sich nachträglich nicht ändern, dafür ein neues Konto anlegen und das alte deaktivieren.

## Funktionen
- **Zeiterfassung (Monatsliste)** mit KW-Gruppierung, Soll/Ist pro Tag und Woche, Timer (Stempeln), Wochenenden und Feiertage markiert
- **Einträge:** Arbeit (Projekt, Ort, Beschreibung), Pause, Arzt/Behördenweg (zählt als Arbeitszeit), Urlaub, Krankenstand, Sonderurlaub, Zeitausgleich
- **Stundenübersicht:** Soll Monat, Soll bis heute, Geleistet, Differenz, Übertrag Vormonat, Saldo
- **Feiertage Österreich** (13 gesetzliche inkl. Ostermontag, Christi Himmelfahrt, Pfingstmontag, Fronleichnam) werden automatisch in der DB geführt und in der Liste markiert
- **Anmeldung für mehrere Benutzer, keine Selbstregistrierung.** Es gibt genau einen Admin, alle anderen Konten legt der Admin an
- **Nur der Admin** legt Mitarbeiter an, ändert Wochenstunden, Urlaubstage, Arbeitstage und Zeitsaldo, genehmigt/lehnt Urlaubs-, Sonderurlaubs- und Zeitausgleichsanträge ab, verwaltet Projekte und gibt Monate frei (sperrt sie)
- Krankenstand wird sofort eingetragen, Urlaub/Sonderurlaub/Zeitausgleich sind Anträge (Status beantragt / genehmigt / abgelehnt)
- Berichte (Diagramme), Urlaub & Feiertage, CSV-Export, Hell/Dunkel automatisch

## Start mit eigenem Server (Node.js + MySQL)
```bash
mysql -uroot < db/schema.sql            # legt Datenbank und Tabellen an (löscht bestehende Zeitfluss-Tabellen!)
mysql -uroot -e "CREATE USER 'zeit'@'localhost' IDENTIFIED BY 'zeit'; GRANT ALL ON zeiterfassung.* TO 'zeit'@'localhost';"
npm install
node db/seed.js                         # optional: Demo-Daten (leert die Tabellen)
npm start                               # http://localhost:3100
```
Den Admin legt der Server beim ersten Start selbst an, wenn `ADMIN_EMAIL` und `ADMIN_PASSWORD` (mind. 8 Zeichen) gesetzt sind. Weitere Mitarbeiter legt der Admin unter Verwaltung an.
Umgebungsvariablen: `DB_HOST DB_USER DB_PASS DB_NAME PORT`.

Demo-Logins mit Server (nach `db/seed.js`): `felix@crazyaquarium.at` / `Aquarium2026` (Admin), `anna@crazyaquarium.at` und `max@crazyaquarium.at` / `demo1234`.

## Auf einem eigenen Server (z. B. mit Cloudflare Tunnel)
Auf dem Server (Linux mit Docker) genügt:
```bash
git clone https://github.com/Felixlei1608/crazytimer && cd crazytimer
cp .env.example .env        # DB_PASS, ADMIN_EMAIL und ADMIN_PASSWORD eintragen
docker compose up -d --build
```
Das startet die App (nur auf `127.0.0.1:3100`) und eine MariaDB mit dauerhaftem Volume `dbdata`. Die Tabellen legt der Server selbst an. Mit `ADMIN_EMAIL` und `ADMIN_PASSWORD` meldest du dich als Admin an. Ohne Docker: `npm install && npm start` mit einer vorhandenen MySQL/MariaDB (Variablen `DB_HOST DB_PORT DB_USER DB_PASS DB_NAME`).

**Öffentlich machen mit Cloudflare Tunnel**, zwei Möglichkeiten:
1. **Subdomain** (z. B. `zeit.crazy-aquarium.com`): im Tunnel einen Public Hostname `zeit.crazy-aquarium.com` → `http://localhost:3100` anlegen (Cloudflare Zero Trust → Networks → Tunnels → Public Hostname), oder bei einer lokalen `config.yml` unter `ingress:` eintragen:
   ```yaml
   - hostname: zeit.crazy-aquarium.com
     service: http://localhost:3100
   ```
2. **Unterpfad ohne Änderung an Cloudflare** (z. B. `crazy-aquarium.com/zeit/`): Im Webserver, der `crazy-aquarium.com` ausliefert, den Pfad `/zeit/` an `http://127.0.0.1:3100/` weiterleiten (Reverse Proxy, Präfix `/zeit` entfernen). Die App benutzt nur relative Adressen und funktioniert deshalb unter jedem Pfad. Aufruf mit abschließendem `/`.

## Alternative: Hoster und Cloud-MySQL
GitHub Pages kann nur Dateien ausliefern, keine Datenbank. Damit alles dauerhaft und für alle Benutzer gemeinsam gespeichert wird, läuft der Server (Node.js) bei einem Hoster und verbindet sich mit einer MySQL-Datenbank. Die Tabellen legt der Server beim Start selbst an, vorhandene Daten bleiben erhalten.

1. **MySQL-Datenbank** bei einem Anbieter mit Gratis-Tarif anlegen (z. B. TiDB Cloud Starter oder Aiven, Tarife vorher prüfen). Du brauchst Host, Port, Benutzer, Passwort und den Namen einer leeren Datenbank.
2. **Server** z. B. bei Render hosten: *New → Blueprint* mit diesem Repo (`render.yaml`, nutzt das `Dockerfile`). Beim Anlegen die Umgebungsvariablen eintragen:

| Variable | Bedeutung |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` | Zugangsdaten der MySQL-Datenbank |
| `DB_SSL` | `true` für verschlüsselte Verbindung (bei Online-Datenbanken meist nötig) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Daraus legt der Server beim ersten Start das Admin-Konto an |

3. Die Adresse des Servers öffnen und mit `ADMIN_EMAIL` und `ADMIN_PASSWORD` anmelden. Das ist der Admin, weitere Mitarbeiter legt er unter Verwaltung an.
4. Optional: die Server-Adresse in `public/config.js` (`APP_URL`) eintragen, dann leitet die GitHub-Pages-Adresse automatisch dorthin weiter.

Hinweis: Gratis-Webserver schlafen nach einiger Zeit ohne Aufrufe ein, der erste Aufruf danach dauert etwas länger. Die Daten liegen in der Datenbank und gehen dabei nicht verloren.

Vorschau ohne Server (Daten nur im Browser, nicht dauerhaft): `http://localhost:3100/?demo`, Anmeldung mit `admin@demo.at` / `demo1234`. `node demo/build.js` baut diese Vorschau als einzelne HTML-Datei.

## Screenshots
Siehe `screenshots/`.
