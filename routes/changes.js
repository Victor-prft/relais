'use strict';

const express = require('express');
const { z, parse, body, params, query, idParam, text, optionalText, optionalId, isoDate, level } = require('../lib/validate');
const { requireRole } = require('../auth/middleware');
const { forbidden, badRequest } = require('../lib/http-errors');
const { runListQuery, listQuerySchema } = require('../lib/list-query');
const { updateTicket, requireTicket } = require('../tickets/service');
const { ticketView } = require('../tickets/view');
const { listForTicket } = require('../approvals/service');
const { changeList } = require('../changes/list');
const { findConflicts, changeCis } = require('../changes/conflicts');
const { createChange, setCis, submitToCab, suggestRisk } = require('../changes/service');
const { workflow, CHANGE_TYPES, RISKS, CLOSE_CODES } = require('../changes/workflow');

const nullableDate = z.union([isoDate, z.null()]).optional();
const content = {
  title: text(160),
  description: optionalText(8000),
  change_type: z.enum(['normal', 'emergency']),
  risk: z.enum(Object.keys(RISKS)),
  justification: optionalText(8000),
  implementation_plan: optionalText(8000),
  backout_plan: optionalText(8000),
  test_plan: optionalText(8000),
  planned_start: nullableDate,
  planned_end: nullableDate,
  impact: level,
  urgency: level,
  assignment_group_id: optionalId,
  assigned_to_id: optionalId
};

/** Changements : réservés au support. Soumettre, planifier et clore restent des actions d'agent. */
module.exports = function changeRoutes({ db }) {
  const router = express.Router();
  router.use(requireRole('agent'));

  router.get('/meta', (_req, res) => {
    res.json({
      states: workflow.states,
      types: CHANGE_TYPES,
      risks: RISKS,
      close_codes: CLOSE_CODES,
      templates: db.prepare('SELECT * FROM standard_changes WHERE is_active = 1 ORDER BY name').all(),
      cab: db.prepare("SELECT id, full_name, role FROM users WHERE is_active = 1 AND role IN ('manager', 'admin') ORDER BY role DESC, full_name").all()
    });
  });

  router.get('/', query(listQuerySchema), (req, res) => res.json(runListQuery(db, changeList, req.validQuery, req.ctx)));

  // Calendrier : les changements dont la fenêtre croise [from, to[, avec leurs conflits.
  router.get('/calendar', query(z.object({ from: isoDate, to: isoDate, drafts: z.enum(['0', '1']).default('0') })), (req, res) => {
    const { from, to, drafts } = req.validQuery;
    if (to <= from) throw badRequest('Période vide');
    const states = drafts === '1' ? "('draft', 'assess', 'authorized', 'scheduled', 'implement', 'review', 'closed')" : "('assess', 'authorized', 'scheduled', 'implement', 'review', 'closed')";
    const items = db
      .prepare(
        `SELECT t.id, t.number, t.title, t.state, c.change_type, c.risk, c.planned_start, c.planned_end, c.close_code,
                (SELECT GROUP_CONCAT(ci.name, ', ') FROM ticket_cis tc JOIN cis ci ON ci.id = tc.ci_id WHERE tc.ticket_id = t.id) AS cis
           FROM tickets t JOIN changes c ON c.ticket_id = t.id
          WHERE t.type = 'change' AND t.state IN ${states} AND c.planned_start < ? AND c.planned_end > ?
          ORDER BY c.planned_start`
      )
      .all(to, from)
      .map((c) => {
        const conflicts = ['closed'].includes(c.state) ? [] : findConflicts(db, { changeId: c.id, ciIds: changeCis(db, c.id), start: c.planned_start, end: c.planned_end });
        return { ...c, conflicts: conflicts.map((x) => ({ id: x.id, number: x.number, level: x.level, cis: x.cis.map((ci) => ci.name) })) };
      });
    res.json({ items });
  });

  // Vérification à la volée pendant la saisie d'une fenêtre.
  router.get(
    '/conflicts',
    query(z.object({ ci_ids: z.string().regex(/^\d+(,\d+)*$/), start: isoDate, end: isoDate, exclude: z.coerce.number().int().positive().optional() })),
    (req, res) => {
      const { ci_ids: ids, start, end, exclude } = req.validQuery;
      const ciIds = ids.split(',').map(Number);
      res.json({ items: findConflicts(db, { changeId: exclude ?? null, ciIds, start, end }), risk: suggestRisk(db, ciIds) });
    }
  );

  function detail(req, ticket) {
    const view = ticketView(req.ctx, ticket);
    const ciIds = view.cis.map((c) => c.id);
    return {
      ...view,
      approvals: listForTicket(db, ticket.id),
      conflicts: findConflicts(db, { changeId: ticket.id, ciIds, start: ticket.planned_start, end: ticket.planned_end }),
      risk_suggestion: suggestRisk(db, ciIds),
      template: ticket.standard_template_id ? db.prepare('SELECT id, name FROM standard_changes WHERE id = ?').get(ticket.standard_template_id) : null
    };
  }

  router.get('/:id', params(idParam), (req, res) => {
    const ticket = requireTicket(db, req.validParams.id);
    if (ticket.type !== 'change') throw forbidden('Ce ticket n’est pas un changement');
    res.json(detail(req, ticket));
  });

  router.post(
    '/',
    body(
      z.object({
        ...content,
        title: text(160).optional(),
        change_type: z.enum(Object.keys(CHANGE_TYPES)).default('normal'),
        risk: z.enum(Object.keys(RISKS)).default('moderate'),
        template_id: optionalId,
        ci_ids: z.array(z.number().int().positive()).max(50).default([])
      }).partial({ impact: true, urgency: true })
    ),
    (req, res) => {
      if (!req.body.template_id && !req.body.title) throw badRequest('Titre obligatoire', [{ path: 'title', message: 'Obligatoire' }]);
      const created = createChange(req.ctx, req.body);
      res.status(201).json(detail(req, created));
    }
  );

  router.patch('/:id', params(idParam), (req, res) => {
    const ticket = requireTicket(db, req.validParams.id);
    if (ticket.type !== 'change') throw forbidden('Ce ticket n’est pas un changement');
    const schema = z
      .object({
        ...content,
        state: z.enum(Object.keys(workflow.states)),
        close_code: z.union([z.enum(Object.keys(CLOSE_CODES)), z.null()]),
        close_notes: optionalText(4000),
        version: z.number().int().positive()
      })
      .partial()
      .strict();
    const { version, ...patch } = parse(schema, req.body);
    if (patch.state === 'assess') throw badRequest('Pour soumettre au CAB, utilisez /submit (choix des approbateurs)');
    // Un standard reste standard : son type ne se choisit pas à la main.
    if (ticket.change_type === 'standard' && patch.change_type) delete patch.change_type;
    res.json(detail(req, updateTicket(req.ctx, ticket.id, patch, { expectedVersion: version ?? null })));
  });

  router.put('/:id/cis', params(idParam), body(z.object({ ci_ids: z.array(z.number().int().positive()).max(50) })), (req, res) => {
    setCis(req.ctx, req.validParams.id, req.body.ci_ids);
    res.json(detail(req, requireTicket(db, req.validParams.id)));
  });

  router.post('/:id/submit', params(idParam), body(z.object({ approver_ids: z.array(z.number().int().positive()).min(1).max(20) })), (req, res) => {
    const updated = submitToCab(req.ctx, req.validParams.id, req.body.approver_ids);
    res.json(detail(req, updated));
  });

  return router;
};
