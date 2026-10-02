'use strict';

const express = require('express');
const { z, body, params, idParam } = require('../lib/validate');
const { requireAuth, requireRole } = require('../auth/middleware');
const { unprocessable } = require('../lib/http-errors');
const { rateLimit } = require('../lib/rate-limit');
const { requireTicket } = require('../tickets/service');
const { listActivity } = require('../tickets/journal');
const { AiUnavailable } = require('../ai/client');
const { triageIncident, suggestArticles, summarizeTicket, SUMMARY_MIN_ENTRIES } = require('../ai/features');

/**
 * Fonctions IA. Une indisponibilité (pas de clé, panne, refus, réponse
 * invalide) n'est jamais une erreur HTTP : la réponse dit `available: false`
 * et le front reste sur le parcours manuel.
 */
module.exports = function aiRoutes({ db, ai, config }) {
  const router = express.Router();
  router.use(requireAuth);

  // Plafond par compte : l'IA coûte, et un formulaire ne doit pas pouvoir boucler.
  const perUser = (max) => rateLimit({ windowMs: 10 * 60 * 1000, max: config.isTest ? 1000 : max, key: (req) => `ai|${req.user.id}|${req.path}`, message: 'Trop de demandes à l’assistant, réessayez dans quelques minutes' });

  const unavailable = (res, err) => res.json({ available: false, reason: err.message });

  router.get('/status', (_req, res) => res.json({ enabled: ai.enabled, model: ai.enabled ? ai.model : null }));

  router.post('/triage', perUser(20), body(z.object({ text: z.string().trim().min(10, 'Décrivez le problème en quelques mots de plus').max(4000) })), async (req, res, next) => {
    try {
      res.json({ available: true, suggestion: await triageIncident(req.ctx, ai, req.body.text) });
    } catch (err) {
      if (err instanceof AiUnavailable) return unavailable(res, err);
      next(err);
    }
  });

  router.post('/kb-suggest', perUser(60), body(z.object({ text: z.string().trim().min(3).max(4000) })), async (req, res, next) => {
    try {
      res.json(await suggestArticles(req.ctx, ai, req.body.text));
    } catch (err) {
      next(err);
    }
  });

  router.post('/tickets/:id/summary', requireRole('agent'), perUser(30), params(idParam), async (req, res, next) => {
    try {
      const ticket = requireTicket(db, req.validParams.id);
      const count = listActivity(db, ticket.id, { internal: true }).length;
      if (count < SUMMARY_MIN_ENTRIES) throw unprocessable(`Fil trop court pour un résumé (${count} entrées)`);
      res.json({ available: true, summary: await summarizeTicket(req.ctx, ai, ticket) });
    } catch (err) {
      if (err instanceof AiUnavailable) return unavailable(res, err);
      next(err);
    }
  });

  return router;
};
