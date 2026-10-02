-- Base de connaissances (Markdown + recherche plein texte FTS5) et fonctions IA.

CREATE TABLE kb_articles (
  id               INTEGER PRIMARY KEY,
  number           TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  -- « body » : même nom que la colonne de l'index FTS (contenu externe).
  body             TEXT NOT NULL DEFAULT '',
  category_id      INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  author_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source_ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  view_count       INTEGER NOT NULL DEFAULT 0,
  published_at     TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_kb_status ON kb_articles(status, updated_at);

-- Index plein texte à contenu externe : le texte vit dans kb_articles, les
-- triggers tiennent l'index à jour. remove_diacritics : « sécurité » trouve « securite ».
CREATE VIRTUAL TABLE kb_fts USING fts5(
  title, body,
  content = 'kb_articles', content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER kb_fts_insert AFTER INSERT ON kb_articles BEGIN
  INSERT INTO kb_fts (rowid, title, body) VALUES (new.id, new.title, new.body);
END;
CREATE TRIGGER kb_fts_delete AFTER DELETE ON kb_articles BEGIN
  INSERT INTO kb_fts (kb_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
END;
CREATE TRIGGER kb_fts_update AFTER UPDATE OF title, body ON kb_articles BEGIN
  INSERT INTO kb_fts (kb_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
  INSERT INTO kb_fts (rowid, title, body) VALUES (new.id, new.title, new.body);
END;

-- Journal des appels au LLM : coût, latence, échecs (rien du contenu des prompts).
CREATE TABLE ai_requests (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  feature       TEXT NOT NULL CHECK (feature IN ('triage', 'kb_suggest', 'summary')),
  model         TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('ok', 'invalid', 'refused', 'error', 'disabled')),
  input_tokens  INTEGER,
  output_tokens INTEGER,
  duration_ms   INTEGER,
  error         TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_ai_requests_created ON ai_requests(created_at);

-- Résumé d'un fil d'activité, valable tant que le fil n'a pas bougé (empreinte).
CREATE TABLE ai_summaries (
  ticket_id   INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  summary     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
