'use strict';

/**
 * Registre des types de tickets. Chaque définition décrit sa table
 * d'extension, son workflow et ses règles ; le service commun fait le reste.
 */
const TYPES = {
  incident: require('../incidents/definition')
};

function getType(type) {
  const def = TYPES[type];
  if (!def) throw new Error(`Type de ticket inconnu : ${type}`);
  return def;
}

function registerType(def) {
  TYPES[def.type] = def;
}

const typeByPrefix = (prefix) => Object.values(TYPES).find((d) => d.prefix === prefix) || null;

module.exports = { getType, registerType, typeByPrefix, TYPES };
