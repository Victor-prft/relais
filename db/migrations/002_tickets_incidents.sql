-- Tickets (table commune INC / REQ / TASK / CHG), incidents, journal, audit trail, listes.

CREATE TABLE tickets (
  id                  INTEGER PRIMARY KEY,
  number              TEXT NOT NULL UNIQUE,
  type                TEXT NOT NULL CHECK (type IN ('incident', 'request', 'request_task', 'change')),
  title               TEXT NOT NULL,
  description         TEXT,
  state               TEXT NOT NULL,
  impact              INTEGER NOT NULL DEFAULT 3 CHECK (impact BETWEEN 1 AND 3),
  urgency             INTEGER NOT NULL DEFAULT 3 CHECK (urgency BETWEEN 1 AND 3),
  priority            INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 5),
  requester_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  opened_by_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assignment_group_id INTEGER REFERENCES support_groups(id) ON DELETE SET NULL,
  assigned_to_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  category_id         INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  parent_id           INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  opened_at           TEXT NOT NULL,
  first_response_at   TEXT,
  resolved_at         TEXT,
  closed_at           TEXT,
  updated_at          TEXT NOT NULL,
  -- Verrou optimiste : chaque écriture l'incrémente ; un PATCH qui porte une
  -- version périmée est refusé (409) au lieu d'écraser le travail d'un autre agent.
  version             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_tickets_type_state ON tickets(type, state);
CREATE INDEX idx_tickets_assigned ON tickets(assigned_to_id, state);
CREATE INDEX idx_tickets_group ON tickets(assignment_group_id, state);
CREATE INDEX idx_tickets_requester ON tickets(requester_id);
CREATE INDEX idx_tickets_opened ON tickets(type, opened_at);
CREATE INDEX idx_tickets_parent ON tickets(parent_id);

CREATE TABLE incidents (
  ticket_id        INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  contact_type     TEXT NOT NULL DEFAULT 'portal' CHECK (contact_type IN ('portal', 'phone', 'email', 'chat', 'ai')),
  on_hold_reason   TEXT CHECK (on_hold_reason IN ('awaiting_user', 'awaiting_vendor', 'awaiting_change')),
  resolution_code  TEXT CHECK (resolution_code IN ('permanent_fix', 'workaround', 'not_reproducible', 'duplicate', 'user_error')),
  resolution_notes TEXT,
  reopen_count     INTEGER NOT NULL DEFAULT 0
);

-- Commentaires publics (visibles du demandeur) et notes de travail internes.
CREATE TABLE journal_entries (
  id         INTEGER PRIMARY KEY,
  ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('comment', 'work_note')),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_journal_ticket ON journal_entries(ticket_id, created_at);

-- Historique champ par champ. *_display fige le libellé au moment du changement
-- (« Sarah Benali » plutôt que 4), même si le nom change plus tard.
CREATE TABLE audit_entries (
  id          INTEGER PRIMARY KEY,
  entity      TEXT NOT NULL CHECK (entity IN ('ticket', 'ci', 'kb_article')),
  entity_id   INTEGER NOT NULL,
  field       TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  old_display TEXT,
  new_display TEXT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_entries(entity, entity_id, created_at);

CREATE TABLE ticket_relations (
  from_id    INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  to_id      INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('related', 'duplicate_of', 'caused_by')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, kind),
  CHECK (from_id <> to_id)
);
CREATE INDEX idx_ticket_relations_to ON ticket_relations(to_id);

-- Vues de liste : colonnes choisies et filtres enregistrés, par utilisateur.
CREATE TABLE list_preferences (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_key  TEXT NOT NULL,
  columns   TEXT NOT NULL DEFAULT '[]',
  page_size INTEGER NOT NULL DEFAULT 25,
  PRIMARY KEY (user_id, list_key)
);

CREATE TABLE saved_filters (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_key   TEXT NOT NULL,
  name       TEXT NOT NULL,
  query      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, list_key, name)
);

-- Référentiel : catégories d'incident (groupe par défaut posé par le seed / l'admin).
INSERT INTO categories (id, parent_id, name, scope, sort_order) VALUES
  (1, NULL, 'Matériel', 'incident', 10),
  (2, 1, 'Poste de travail', 'incident', 11),
  (3, 1, 'Imprimante', 'incident', 12),
  (4, 1, 'Téléphonie', 'incident', 13),
  (5, NULL, 'Logiciel', 'incident', 20),
  (6, 5, 'Messagerie', 'incident', 21),
  (7, 5, 'ERP', 'incident', 22),
  (8, 5, 'CRM', 'incident', 23),
  (9, 5, 'Bureautique', 'incident', 24),
  (10, NULL, 'Réseau', 'incident', 30),
  (11, 10, 'VPN', 'incident', 31),
  (12, 10, 'Wi-Fi', 'incident', 32),
  (13, 10, 'Accès internet', 'incident', 33),
  (14, NULL, 'Accès et comptes', 'incident', 40),
  (15, 14, 'Mot de passe', 'incident', 41),
  (16, 14, 'Droits d''accès', 'incident', 42);
