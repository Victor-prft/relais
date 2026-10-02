'use strict';

/**
 * Lecture unique des variables d'environnement.
 *
 * Tout le reste du code lit `config`, jamais `process.env` directement : on
 * sait ainsi en un coup d'œil de quoi l'application dépend, et les valeurs
 * manquantes sont signalées au démarrage plutôt qu'au premier appel.
 */

const path = require('path');
require('dotenv').config({ quiet: true });

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';
const isTest = env === 'test';

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const config = {
  env,
  isProd,
  isTest,
  port: Number(process.env.PORT) || 3100,
  appUrl: process.env.APP_URL || `http://localhost:${Number(process.env.PORT) || 3100}`,
  databasePath: process.env.DATABASE_PATH || path.join(__dirname, 'db', 'relais.db'),
  sessionSecret: process.env.SESSION_SECRET || (isProd ? null : 'dev-only-secret-change-me'),
  // Comptes de démo affichés sur la page de connexion (portfolio).
  demoMode: bool(process.env.DEMO_MODE, !isProd),
  // Base vide au démarrage : on y joue le seed de démo.
  seedOnEmpty: bool(process.env.SEED_ON_EMPTY, false),
  // Premier administrateur, créé s'il n'existe aucun admin.
  adminEmail: process.env.ADMIN_EMAIL || null,
  adminPassword: process.env.ADMIN_PASSWORD || null,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  cronEnabled: bool(process.env.CRON_ENABLED, !isTest),
  emailEnabled: bool(process.env.EMAIL_ENABLED, false)
};

function assertConfig() {
  const problems = [];
  if (!config.sessionSecret) problems.push('SESSION_SECRET est obligatoire en production');
  if (isProd && config.sessionSecret && config.sessionSecret.length < 32) {
    problems.push('SESSION_SECRET doit faire au moins 32 caractères');
  }
  if (problems.length) {
    throw new Error(`Configuration invalide :\n  - ${problems.join('\n  - ')}`);
  }
}

module.exports = { config, assertConfig };
