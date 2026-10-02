-- SLA en heures ouvrées et notifications in-app.

CREATE TABLE business_calendars (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'Europe/Paris'
);

-- Plages ouvrées en minutes depuis minuit, heure locale (480 = 8 h). Plusieurs plages par jour possibles.
CREATE TABLE business_hours (
  calendar_id  INTEGER NOT NULL REFERENCES business_calendars(id) ON DELETE CASCADE,
  weekday      INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute   INTEGER NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  CHECK (end_minute > start_minute)
);
CREATE INDEX idx_business_hours_cal ON business_hours(calendar_id, weekday);

CREATE TABLE holidays (
  calendar_id INTEGER NOT NULL REFERENCES business_calendars(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  label       TEXT NOT NULL,
  PRIMARY KEY (calendar_id, date)
);

CREATE TABLE sla_definitions (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  ticket_type      TEXT NOT NULL CHECK (ticket_type IN ('incident', 'request')),
  priority         INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 5),
  target           TEXT NOT NULL CHECK (target IN ('response', 'resolution')),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  calendar_id      INTEGER NOT NULL REFERENCES business_calendars(id),
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  UNIQUE (ticket_type, priority, target)
);

-- Une ligne par SLA attaché à un ticket. Le temps écoulé se compte par
-- points d'arrêt : elapsed_minutes = minutes ouvrées cumulées jusqu'au dernier
-- arrêt ; s'y ajoute, s'il tourne, le temps ouvré depuis last_resumed_at.
CREATE TABLE ticket_slas (
  id                   INTEGER PRIMARY KEY,
  ticket_id            INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sla_definition_id    INTEGER NOT NULL REFERENCES sla_definitions(id),
  stage                TEXT NOT NULL CHECK (stage IN ('running', 'paused', 'completed', 'canceled')),
  started_at           TEXT NOT NULL,
  last_resumed_at      TEXT,
  elapsed_minutes      REAL NOT NULL DEFAULT 0,
  due_at               TEXT,
  stopped_at           TEXT,
  has_breached         INTEGER NOT NULL DEFAULT 0,
  -- Avancement mis en cache (job + chaque changement d'étape) : tri et filtres des listes.
  percent              REAL NOT NULL DEFAULT 0,
  at_risk_notified_at  TEXT,
  breached_notified_at TEXT,
  updated_at           TEXT NOT NULL
);
CREATE INDEX idx_ticket_slas_ticket ON ticket_slas(ticket_id);
CREATE INDEX idx_ticket_slas_stage ON ticket_slas(stage);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('assigned', 'queue', 'comment', 'state_changed', 'sla_at_risk', 'sla_breached', 'approval_requested', 'approval_decided')),
  title      TEXT NOT NULL,
  body       TEXT,
  ticket_id  INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  read_at    TEXT,
  emailed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at, created_at);

-- Référentiel : deux calendriers, jours fériés français 2026-2027, SLA par priorité.
INSERT INTO business_calendars (id, name, timezone) VALUES
  (1, 'Heures ouvrées (lun–ven, 8 h–18 h)', 'Europe/Paris'),
  (2, '24 h/24, 7 j/7', 'Europe/Paris');

INSERT INTO business_hours (calendar_id, weekday, start_minute, end_minute) VALUES
  (1, 1, 480, 1080), (1, 2, 480, 1080), (1, 3, 480, 1080), (1, 4, 480, 1080), (1, 5, 480, 1080),
  (2, 0, 0, 1440), (2, 1, 0, 1440), (2, 2, 0, 1440), (2, 3, 0, 1440), (2, 4, 0, 1440), (2, 5, 0, 1440), (2, 6, 0, 1440);

INSERT INTO holidays (calendar_id, date, label) VALUES
  (1, '2026-01-01', 'Jour de l''an'), (1, '2026-04-06', 'Lundi de Pâques'), (1, '2026-05-01', 'Fête du travail'),
  (1, '2026-05-08', 'Victoire 1945'), (1, '2026-05-14', 'Ascension'), (1, '2026-05-25', 'Lundi de Pentecôte'),
  (1, '2026-07-14', 'Fête nationale'), (1, '2026-08-15', 'Assomption'), (1, '2026-11-01', 'Toussaint'),
  (1, '2026-11-11', 'Armistice 1918'), (1, '2026-12-25', 'Noël'),
  (1, '2027-01-01', 'Jour de l''an'), (1, '2027-03-29', 'Lundi de Pâques'), (1, '2027-05-01', 'Fête du travail'),
  (1, '2027-05-06', 'Ascension'), (1, '2027-05-08', 'Victoire 1945'), (1, '2027-05-17', 'Lundi de Pentecôte'),
  (1, '2027-07-14', 'Fête nationale'), (1, '2027-08-15', 'Assomption'), (1, '2027-11-01', 'Toussaint'),
  (1, '2027-11-11', 'Armistice 1918'), (1, '2027-12-25', 'Noël');

-- P1 : 24/7. Au-delà : heures ouvrées (une journée = 600 minutes).
INSERT INTO sla_definitions (name, ticket_type, priority, target, duration_minutes, calendar_id) VALUES
  ('Prise en charge P1', 'incident', 1, 'response', 15, 2),
  ('Résolution P1', 'incident', 1, 'resolution', 240, 2),
  ('Prise en charge P2', 'incident', 2, 'response', 30, 1),
  ('Résolution P2', 'incident', 2, 'resolution', 480, 1),
  ('Prise en charge P3', 'incident', 3, 'response', 120, 1),
  ('Résolution P3', 'incident', 3, 'resolution', 1200, 1),
  ('Prise en charge P4', 'incident', 4, 'response', 480, 1),
  ('Résolution P4', 'incident', 4, 'resolution', 3000, 1),
  ('Prise en charge P5', 'incident', 5, 'response', 960, 1),
  ('Résolution P5', 'incident', 5, 'resolution', 6000, 1),
  ('Traitement de demande P1', 'request', 1, 'resolution', 600, 1),
  ('Traitement de demande P2', 'request', 2, 'resolution', 1200, 1),
  ('Traitement de demande P3', 'request', 3, 'resolution', 2400, 1),
  ('Traitement de demande P4', 'request', 4, 'resolution', 3000, 1),
  ('Traitement de demande P5', 'request', 5, 'resolution', 6000, 1);
