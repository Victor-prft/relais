'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Migrations versionnées : `db/migrations/NNN_description.sql`.
 *
 * Appliquées dans l'ordre, une seule fois, chacune dans une transaction ;
 * l'historique vit dans `schema_migrations`. On ne modifie ni ne retire jamais
 * une migration jouée : on la défait par une migration de plus. Un numéro
 * reste pris pour toujours, d'où le refus d'une migration en attente dont le
 * numéro n'est pas au-dessus de la dernière version appliquée.
 */

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
}

function readMigrations(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) return [];

  const migrations = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => {
      const match = file.match(/^(\d+)_(.+)\.sql$/);
      if (!match) throw new Error(`Nom de migration invalide : "${file}" (attendu NNN_description.sql)`);
      return { version: Number(match[1]), name: match[2], file, path: path.join(dir, file) };
    })
    .sort((a, b) => a.version - b.version);

  for (let i = 1; i < migrations.length; i += 1) {
    if (migrations[i].version === migrations[i - 1].version) {
      throw new Error(`Deux migrations portent le numéro ${migrations[i].version}`);
    }
  }
  return migrations;
}

function currentVersion(db) {
  ensureMigrationsTable(db);
  return db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get().v;
}

function migrate(db, { dir = MIGRATIONS_DIR, log = null } = {}) {
  ensureMigrationsTable(db);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const latest = currentVersion(db);
  const pending = readMigrations(dir).filter((m) => !applied.has(m.version));

  for (const migration of pending) {
    if (migration.version <= latest) {
      throw new Error(
        `Migration ${migration.file} en attente sous la version ${latest} déjà appliquée : ` +
          'un numéro de migration ne se réutilise pas.'
      );
    }
  }

  const insert = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)');
  for (const migration of pending) {
    const sql = fs.readFileSync(migration.path, 'utf8');
    db.transaction(() => {
      db.exec(sql);
      insert.run(migration.version, migration.name);
    })();
    if (log) log.log(`migration ${migration.file} appliquée`);
  }
  return pending.length;
}

module.exports = { migrate, readMigrations, currentVersion };

if (require.main === module) {
  const { config } = require('../config');
  const { openDatabase } = require('./index');
  const db = openDatabase(config.databasePath, { runMigrations: false });
  const count = migrate(db, { log: console });
  console.log(count ? `${count} migration(s) appliquée(s).` : 'Base à jour.');
  db.close();
}
