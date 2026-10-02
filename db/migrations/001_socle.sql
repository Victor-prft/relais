-- Socle : comptes, groupes de support, catégories, numérotation, réglages, sessions.
-- Dates : TEXT ISO 8601 UTC, même format que Date.prototype.toISOString().

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'agent', 'manager', 'admin')),
  manager_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  department    TEXT,
  phone         TEXT,
  preferences   TEXT NOT NULL DEFAULT '{}',
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- « groups » est un mot réservé de SQLite (cadres de fenêtre) : on l'évite.
CREATE TABLE support_groups (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT,
  manager_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE group_members (
  group_id INTEGER NOT NULL REFERENCES support_groups(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX idx_group_members_user ON group_members(user_id);

-- Arbre à deux niveaux : catégorie (parent_id NULL) puis sous-catégorie.
CREATE TABLE categories (
  id               INTEGER PRIMARY KEY,
  parent_id        INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  scope            TEXT NOT NULL CHECK (scope IN ('incident', 'catalog', 'kb')),
  default_group_id INTEGER REFERENCES support_groups(id) ON DELETE SET NULL,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  UNIQUE (scope, parent_id, name)
);

CREATE TABLE number_sequences (
  prefix     TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL
);
INSERT INTO number_sequences (prefix, next_value) VALUES
  ('INC', 1001), ('REQ', 1001), ('TASK', 1001), ('CHG', 1001), ('KB', 1001);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO settings (key, value) VALUES
  ('incident.auto_close_days', '3'),
  ('request.auto_close_days', '3'),
  ('sla.at_risk_threshold', '0.75');

CREATE TABLE sessions (
  sid        TEXT PRIMARY KEY,
  sess       TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
