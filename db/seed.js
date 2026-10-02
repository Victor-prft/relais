'use strict';

/**
 * Jeu de démo : `npm run db:seed` repart d'une base vide.
 *
 * Les tickets sont créés en passant par les services métier, avec une horloge
 * simulée qui avance sur les 60 derniers jours : l'audit trail, les SLA et les
 * dates de résolution sont donc ceux qu'aurait produits un vrai usage.
 */

const fs = require('fs');
const { hashPasswordSync } = require('../auth/passwords');
const { USERS, GROUPS, DEMO_PASSWORD } = require('./seed/people');
const { createRandom } = require('./seed/random');
const { seedIncidents } = require('./seed/incidents');
const { seedCmdb } = require('./seed/cmdb');

function seedPeople(db) {
  const hash = hashPasswordSync(DEMO_PASSWORD);
  const ids = {};
  const insertUser = db.prepare(
    'INSERT INTO users (email, password_hash, full_name, role, department) VALUES (?, ?, ?, ?, ?)'
  );
  for (const u of USERS) ids[u.key] = insertUser.run(u.email, hash, u.full_name, u.role, u.department).lastInsertRowid;

  const setManager = db.prepare('UPDATE users SET manager_id = ? WHERE id = ?');
  for (const u of USERS) if (u.manager) setManager.run(ids[u.manager], ids[u.key]);

  const groups = {};
  const insertGroup = db.prepare('INSERT INTO support_groups (name, description, manager_id) VALUES (?, ?, ?)');
  const insertMember = db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)');
  for (const g of GROUPS) {
    groups[g.key] = insertGroup.run(g.name, g.description, ids[g.manager]).lastInsertRowid;
    for (const m of g.members) insertMember.run(groups[g.key], ids[m]);
  }
  return { users: ids, groups };
}

async function seed(db, { log = console, now = new Date() } = {}) {
  const rnd = createRandom();
  const refs = db.transaction(() => seedPeople(db))();
  log.log(`seed : ${USERS.length} utilisateurs, ${GROUPS.length} groupes`);

  const steps = [
    ['cmdb', () => seedCmdb(db, refs, now)],
    ['incidents', () => seedIncidents(db, refs, now, rnd)]
  ];
  for (const [, run] of steps) {
    const summary = db.transaction(run)();
    if (summary) log.log(`seed : ${summary}`);
  }
  return refs;
}

module.exports = { seed };

if (require.main === module) {
  const { config } = require('../config');
  const { openDatabase } = require('./index');

  if (config.isProd && !process.argv.includes('--force')) {
    console.error('Refusé en production (ajouter --force pour écraser la base).');
    process.exit(1);
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const file = config.databasePath + suffix;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
  const db = openDatabase(config.databasePath, { log: console });
  seed(db)
    .then(() => {
      db.close();
      console.log(`Base de démo prête : ${config.databasePath} (mot de passe : ${DEMO_PASSWORD})`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
