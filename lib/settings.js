'use strict';

/** Réglages applicatifs (table `settings`, valeurs JSON). */

function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

function setSetting(db, key, value, now = new Date()) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value), now.toISOString());
}

function allSettings(db) {
  return Object.fromEntries(
    db.prepare('SELECT key, value FROM settings ORDER BY key').all().map((r) => [r.key, JSON.parse(r.value)])
  );
}

module.exports = { getSetting, setSetting, allSettings };
