-- Changements (CHG) et modèles de changements standard.

-- Changement standard : pré-autorisé, à risque faible, décrit une fois pour toutes.
CREATE TABLE standard_changes (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL UNIQUE,
  description         TEXT,
  implementation_plan TEXT NOT NULL,
  backout_plan        TEXT NOT NULL,
  test_plan           TEXT,
  risk                TEXT NOT NULL DEFAULT 'low' CHECK (risk IN ('low', 'moderate', 'high')),
  duration_minutes    INTEGER NOT NULL DEFAULT 60,
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE changes (
  ticket_id            INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  change_type          TEXT NOT NULL DEFAULT 'normal' CHECK (change_type IN ('standard', 'normal', 'emergency')),
  risk                 TEXT NOT NULL DEFAULT 'moderate' CHECK (risk IN ('low', 'moderate', 'high')),
  justification        TEXT,
  implementation_plan  TEXT,
  backout_plan         TEXT,
  test_plan            TEXT,
  planned_start        TEXT,
  planned_end          TEXT,
  actual_start         TEXT,
  actual_end           TEXT,
  close_code           TEXT CHECK (close_code IN ('successful', 'successful_with_issues', 'unsuccessful', 'backed_out')),
  close_notes          TEXT,
  standard_template_id INTEGER REFERENCES standard_changes(id) ON DELETE SET NULL,
  CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end > planned_start)
);
CREATE INDEX idx_changes_window ON changes(planned_start, planned_end);
