'use strict';

const express = require('express');
const { notFound } = require('../lib/http-errors');

/** Monte toutes les routes de l'API. Chaque module reçoit les dépendances partagées. */
module.exports = function apiRoutes(deps) {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    // Une lecture réelle : un healthcheck qui ne touche pas la base ne dit rien.
    const ok = deps.db.prepare('SELECT 1 AS ok').get().ok === 1;
    res.json({ status: ok ? 'ok' : 'degraded', version: deps.version, time: new Date().toISOString() });
  });

  router.use('/auth', require('./auth')(deps));
  router.use('/admin', require('./admin')(deps));
  router.use('/', require('./reference')(deps));

  router.use((_req, _res, next) => next(notFound('Route API inconnue')));
  return router;
};
