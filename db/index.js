'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { migrate } = require('./migrate');

/**
 * Ouvre une base, règle les pragmas et joue les migrations en attente.
 * `:memory:` est accepté (tests).
 */
function openDatabase(filename, { runMigrations = true, log = null } = {}) {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }

  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  if (runMigrations) migrate(db, { log });
  return db;
}

module.exports = { openDatabase };
