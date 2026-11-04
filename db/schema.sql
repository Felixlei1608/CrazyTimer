-- Zeitfluss / Zeiterfassung: eigene MySQL/MariaDB Datenbank
CREATE DATABASE IF NOT EXISTS zeiterfassung CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE zeiterfassung;

DROP TABLE IF EXISTS month_locks, absences, time_entries, sessions, holidays, projects, users, customers, settings;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(160) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  pass_hash VARCHAR(200) NOT NULL,
  role ENUM('admin','user') NOT NULL DEFAULT 'user',          -- genau ein Admin (der erste registrierte Benutzer)
  status ENUM('active','pending','disabled') NOT NULL DEFAULT 'pending',
  department VARCHAR(80) NOT NULL DEFAULT '',
  weekly_hours DECIMAL(4,1) NOT NULL DEFAULT 38.5,            -- nur vom Admin änderbar
  vacation_days DECIMAL(4,1) NOT NULL DEFAULT 25,             -- nur vom Admin änderbar
  work_days VARCHAR(20) NOT NULL DEFAULT '1,2,3,4,5',
  start_date DATE NOT NULL,
  opening_balance DECIMAL(7,2) NOT NULL DEFAULT 0,            -- Zeitsaldo bei Eintritt
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  token CHAR(64) PRIMARY KEY,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE projects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  color VARCHAR(9) NOT NULL DEFAULT '#0A84FF',
  archived TINYINT(1) NOT NULL DEFAULT 0
);

-- Arbeit, Pause und Arzt/Behördenweg (zeitgenau). Arbeit und Arzt zählen als Ist, Pause nicht.
CREATE TABLE time_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  kind ENUM('arbeit','pause','arzt') NOT NULL DEFAULT 'arbeit',
  project_id INT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  location VARCHAR(40) NOT NULL DEFAULT 'Büro',
  start_at DATETIME NOT NULL,
  end_at DATETIME NULL,                                       -- NULL = Timer läuft
  INDEX idx_user_start (user_id, start_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- Ganztägige Abwesenheiten mit Genehmigung durch den Admin
CREATE TABLE absences (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type ENUM('urlaub','krank','sonderurlaub','zeitausgleich') NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  note VARCHAR(255) NOT NULL DEFAULT '',
  status ENUM('beantragt','genehmigt','abgelehnt') NOT NULL DEFAULT 'beantragt',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_date (user_id, date_from),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE holidays (date DATE PRIMARY KEY, name VARCHAR(80) NOT NULL);

-- Vom Admin freigegebene (gesperrte) Monate
CREATE TABLE month_locks (
  user_id INT NOT NULL, ym CHAR(7) NOT NULL,
  PRIMARY KEY (user_id, ym),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
