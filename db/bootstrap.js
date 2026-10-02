'use strict';

const { createUser } = require('../auth/users');

/**
 * Démarrage sur une base neuve :
 * - SEED_ON_EMPTY=true et aucun compte : on joue le jeu de démo complet ;
 * - sinon, ADMIN_EMAIL + ADMIN_PASSWORD créent le premier administrateur.
 */
async function bootstrap(db, config, log = console) {
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

  if (users === 0 && config.seedOnEmpty) {
    log.log('Base vide : chargement du jeu de démo (SEED_ON_EMPTY).');
    await require('./seed').seed(db, { log });
    return;
  }

  const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
  if (admins === 0 && config.adminEmail && config.adminPassword) {
    await createUser(db, {
      email: config.adminEmail,
      password: config.adminPassword,
      full_name: 'Administrateur',
      role: 'admin'
    });
    log.log(`Administrateur initial créé : ${config.adminEmail}`);
  } else if (admins === 0) {
    log.warn('Aucun administrateur : définir ADMIN_EMAIL et ADMIN_PASSWORD, ou SEED_ON_EMPTY=true.');
  }
}

module.exports = { bootstrap };
