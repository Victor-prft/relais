'use strict';

const bcrypt = require('bcryptjs');

const COST = 10;
// Hash d'un mot de passe jetable : comparé quand l'email n'existe pas, pour
// que la réponse prenne le même temps qu'un vrai compte (pas d'énumération).
const DUMMY_HASH = bcrypt.hashSync('relais-dummy-password', COST);

const hashPassword = (password) => bcrypt.hash(password, COST);
const hashPasswordSync = (password) => bcrypt.hashSync(password, COST);

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash || DUMMY_HASH);
}

module.exports = { hashPassword, hashPasswordSync, verifyPassword };
