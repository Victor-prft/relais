-- CMDB : classes de CI, éléments de configuration, relations, liens tickets ↔ CI.

-- attributes_schema : champs propres à la classe, au format des formulaires
-- dynamiques (lib/form-schema.js) — le même moteur sert au catalogue de services.
CREATE TABLE ci_classes (
  id                INTEGER PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  label             TEXT NOT NULL,
  icon              TEXT NOT NULL,
  attributes_schema TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE cis (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  class_id         INTEGER NOT NULL REFERENCES ci_classes(id),
  status           TEXT NOT NULL DEFAULT 'in_service' CHECK (status IN ('planned', 'in_service', 'maintenance', 'retired')),
  environment      TEXT NOT NULL DEFAULT 'prod' CHECK (environment IN ('prod', 'preprod', 'test', 'dev')),
  criticality      INTEGER NOT NULL DEFAULT 2 CHECK (criticality BETWEEN 1 AND 3),
  owner_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  support_group_id INTEGER REFERENCES support_groups(id) ON DELETE SET NULL,
  location         TEXT,
  description      TEXT,
  attributes       TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_cis_class ON cis(class_id);

CREATE TABLE ci_relation_types (
  code          TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  reverse_label TEXT NOT NULL,
  -- Sens de propagation d'une panne : 'to_source' = si la cible tombe, la source
  -- est touchée (A dépend de B) ; 'to_target' = si la source tombe, la cible l'est
  -- (A héberge B).
  impact        TEXT NOT NULL CHECK (impact IN ('to_source', 'to_target'))
);
INSERT INTO ci_relation_types (code, label, reverse_label, impact) VALUES
  ('depends_on', 'dépend de', 'est requis par', 'to_source'),
  ('hosts', 'héberge', 'est hébergé par', 'to_target'),
  ('connects_to', 'est connecté à', 'relie', 'to_source');

CREATE TABLE ci_relations (
  id           INTEGER PRIMARY KEY,
  source_ci_id INTEGER NOT NULL REFERENCES cis(id) ON DELETE CASCADE,
  target_ci_id INTEGER NOT NULL REFERENCES cis(id) ON DELETE CASCADE,
  type         TEXT NOT NULL REFERENCES ci_relation_types(code),
  created_at   TEXT NOT NULL,
  UNIQUE (source_ci_id, target_ci_id, type),
  CHECK (source_ci_id <> target_ci_id)
);
CREATE INDEX idx_ci_relations_target ON ci_relations(target_ci_id);

-- CI principal d'un ticket.
ALTER TABLE tickets ADD COLUMN ci_id INTEGER REFERENCES cis(id) ON DELETE SET NULL;
CREATE INDEX idx_tickets_ci ON tickets(ci_id);

-- CI impactés supplémentaires (surtout pour les changements).
CREATE TABLE ticket_cis (
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  ci_id     INTEGER NOT NULL REFERENCES cis(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, ci_id)
);
CREATE INDEX idx_ticket_cis_ci ON ticket_cis(ci_id);

INSERT INTO ci_classes (code, label, icon, attributes_schema) VALUES
  ('server', 'Serveur', 'server', '[
    {"name":"os","label":"Système","type":"text","required":true},
    {"name":"ip_address","label":"Adresse IP","type":"text"},
    {"name":"cpu","label":"vCPU","type":"number","min":1,"max":256},
    {"name":"ram_gb","label":"Mémoire (Go)","type":"number","min":1,"max":4096},
    {"name":"virtual","label":"Machine virtuelle","type":"checkbox"}
  ]'),
  ('application', 'Application', 'app', '[
    {"name":"version","label":"Version","type":"text"},
    {"name":"vendor","label":"Éditeur","type":"text"},
    {"name":"url","label":"URL d’accès","type":"text"},
    {"name":"users","label":"Utilisateurs","type":"number","min":0}
  ]'),
  ('database', 'Base de données', 'database', '[
    {"name":"engine","label":"Moteur","type":"select","required":true,"options":["PostgreSQL","MySQL","SQL Server","Oracle","SQLite"]},
    {"name":"version","label":"Version","type":"text"},
    {"name":"size_gb","label":"Taille (Go)","type":"number","min":0}
  ]'),
  ('workstation', 'Poste de travail', 'laptop', '[
    {"name":"model","label":"Modèle","type":"text"},
    {"name":"os","label":"Système","type":"text"},
    {"name":"serial","label":"Numéro de série","type":"text"},
    {"name":"user","label":"Utilisateur principal","type":"text"}
  ]'),
  ('network', 'Équipement réseau', 'network', '[
    {"name":"model","label":"Modèle","type":"text"},
    {"name":"ip_address","label":"Adresse IP","type":"text"},
    {"name":"firmware","label":"Firmware","type":"text"}
  ]'),
  ('peripheral', 'Périphérique', 'package', '[
    {"name":"model","label":"Modèle","type":"text"},
    {"name":"ip_address","label":"Adresse IP","type":"text"}
  ]');
