-- Catalogue de services, demandes (REQ), tâches (TASK), approbations.

CREATE TABLE catalog_items (
  id                   INTEGER PRIMARY KEY,
  name                 TEXT NOT NULL UNIQUE,
  short_description    TEXT NOT NULL,
  description          TEXT,
  category_id          INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  icon                 TEXT NOT NULL DEFAULT 'package',
  -- Formulaire dynamique (lib/form-schema.js).
  form_schema          TEXT NOT NULL DEFAULT '[]',
  requires_approval    INTEGER NOT NULL DEFAULT 0 CHECK (requires_approval IN (0, 1)),
  -- Groupe qui suit la demande dans son ensemble (les tâches ont chacune le leur).
  fulfillment_group_id INTEGER REFERENCES support_groups(id) ON DELETE SET NULL,
  delivery_days        INTEGER,
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

-- Modèles de tâches : celles d'une même séquence démarrent ensemble, la suivante
-- quand toutes les précédentes sont closes.
CREATE TABLE catalog_item_tasks (
  id                  INTEGER PRIMARY KEY,
  catalog_item_id     INTEGER NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  sequence            INTEGER NOT NULL DEFAULT 1 CHECK (sequence BETWEEN 1 AND 20),
  title               TEXT NOT NULL,
  description         TEXT,
  assignment_group_id INTEGER REFERENCES support_groups(id) ON DELETE SET NULL
);
CREATE INDEX idx_catalog_item_tasks_item ON catalog_item_tasks(catalog_item_id, sequence);

CREATE TABLE requests (
  ticket_id        INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  catalog_item_id  INTEGER REFERENCES catalog_items(id) ON DELETE SET NULL,
  requested_for_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Réponses au formulaire, validées contre form_schema au moment de la commande.
  variables        TEXT NOT NULL DEFAULT '{}',
  approval_state   TEXT NOT NULL DEFAULT 'not_required' CHECK (approval_state IN ('not_required', 'requested', 'approved', 'rejected'))
);
CREATE INDEX idx_requests_for ON requests(requested_for_id);

CREATE TABLE request_tasks (
  ticket_id            INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  catalog_item_task_id INTEGER REFERENCES catalog_item_tasks(id) ON DELETE SET NULL,
  sequence             INTEGER NOT NULL DEFAULT 1
);

-- Approbations, communes aux demandes et aux changements (CAB).
CREATE TABLE approvals (
  id           INTEGER PRIMARY KEY,
  ticket_id    INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  approver_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state        TEXT NOT NULL DEFAULT 'requested' CHECK (state IN ('requested', 'approved', 'rejected', 'canceled')),
  comment      TEXT,
  requested_at TEXT NOT NULL,
  decided_at   TEXT,
  UNIQUE (ticket_id, approver_id)
);
CREATE INDEX idx_approvals_approver ON approvals(approver_id, state);
