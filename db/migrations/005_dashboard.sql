-- Dashboard : disposition des widgets par utilisateur (Gridstack).
-- layout : [{ "id": "sla_risk", "x": 0, "y": 0, "w": 6, "h": 4 }, …] sur une grille de 12 colonnes.
CREATE TABLE dashboard_layouts (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  layout     TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
