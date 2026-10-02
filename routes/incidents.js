'use strict';

const express = require('express');
const { z, parse, params, query, idParam, text, optionalText, optionalId, level } = require('../lib/validate');
const { requireAuth } = require('../auth/middleware');
const { forbidden } = require('../lib/http-errors');
const { runListQuery, listQuerySchema } = require('../lib/list-query');
const { createTicket, updateTicket, requireTicket, isStaffActor } = require('../tickets/service');
const { assertCanView, scopeClause } = require('../tickets/access');
const { ticketView } = require('../tickets/view');
const { incidentList } = require('../incidents/list');
const { ON_HOLD_REASONS, RESOLUTION_CODES, CONTACT_TYPES, workflow } = require('../incidents/workflow');
const { getSetting } = require('../lib/settings');

const state = z.enum(Object.keys(workflow.states));
const onHoldReason = z.union([z.enum(Object.keys(ON_HOLD_REASONS)), z.null()]);
const resolutionCode = z.union([z.enum(Object.keys(RESOLUTION_CODES)), z.null()]);
const contactType = z.enum(Object.keys(CONTACT_TYPES));

const staffFields = {
  title: text(160),
  description: optionalText(8000),
  impact: level,
  urgency: level,
  category_id: optionalId,
  ci_id: optionalId,
  requester_id: optionalId,
  assignment_group_id: optionalId,
  assigned_to_id: optionalId,
  contact_type: contactType,
  on_hold_reason: onHoldReason.optional(),
  resolution_code: resolutionCode.optional(),
  resolution_notes: optionalText(8000)
};

const createStaffSchema = z.object({
  ...staffFields,
  impact: level.default(3),
  urgency: level.default(3),
  contact_type: contactType.default('phone')
});

// Un utilisateur décrit son problème ; le reste (groupe, agent) est l'affaire du support.
const createUserSchema = z.object({
  title: text(160),
  description: optionalText(8000),
  impact: level.default(3),
  urgency: level.default(3),
  category_id: optionalId,
  ci_id: optionalId,
  contact_type: z.enum(['portal', 'ai']).default('portal')
});

const patchStaffSchema = z
  .object({ ...staffFields, state: state, version: z.number().int().positive() })
  .partial()
  .strict();
const patchUserSchema = z.object({ state, version: z.number().int().positive().optional() }).strict();

/** Groupe d'assignation par défaut : celui de la catégorie, sinon le réglage global. */
function routeGroup(db, categoryId) {
  if (categoryId) {
    const row = db
      .prepare('SELECT c.default_group_id AS g, p.default_group_id AS pg FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.id = ?')
      .get(categoryId);
    if (row?.g || row?.pg) return row.g || row.pg;
  }
  return getSetting(db, 'incident.default_group_id', null);
}

const incidentView = ticketView;

module.exports = function incidentRoutes({ db }) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/meta', (_req, res) => {
    res.json({
      states: workflow.states,
      on_hold_reasons: ON_HOLD_REASONS,
      resolution_codes: RESOLUTION_CODES,
      contact_types: CONTACT_TYPES
    });
  });

  router.get('/', query(listQuerySchema), (req, res) => {
    res.json(runListQuery(db, incidentList, req.validQuery, req.ctx, scopeClause(req.user)));
  });

  router.post('/', (req, res) => {
    const staff = isStaffActor(req.ctx);
    const input = parse(staff ? createStaffSchema : createUserSchema, req.body);
    if (!staff) input.requester_id = req.user.id;
    if (!input.assignment_group_id) input.assignment_group_id = routeGroup(db, input.category_id);
    const ticket = createTicket(req.ctx, 'incident', input);
    res.status(201).json(incidentView(req.ctx, ticket));
  });

  router.get('/:id', params(idParam), (req, res) => {
    const ticket = requireTicket(db, req.validParams.id);
    if (ticket.type !== 'incident') throw forbidden('Ce ticket n’est pas un incident');
    assertCanView(db, req.user, ticket);
    res.json(incidentView(req.ctx, ticket));
  });

  router.patch('/:id', params(idParam), (req, res) => {
    const ticket = requireTicket(db, req.validParams.id);
    assertCanView(db, req.user, ticket);
    if (ticket.type !== 'incident') throw forbidden('Ce ticket n’est pas un incident');

    const staff = isStaffActor(req.ctx);
    const { version, ...patch } = parse(staff ? patchStaffSchema : patchUserSchema, req.body);
    if (!staff && ticket.requester_id !== req.user.id && ticket.opened_by_id !== req.user.id) {
      throw forbidden('Seul le demandeur peut agir sur ce ticket');
    }
    const updated = updateTicket(req.ctx, ticket.id, patch, { expectedVersion: version ?? null });
    res.json(incidentView(req.ctx, updated));
  });

  return router;
};
