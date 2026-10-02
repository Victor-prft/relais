'use strict';

const express = require('express');
const { z, body, params, query, idParam, text, optionalText, optionalId } = require('../lib/validate');
const { requireRole } = require('../auth/middleware');
const { runListQuery, listQuerySchema } = require('../lib/list-query');
const { listAudit } = require('../tickets/audit');
const cmdb = require('../cmdb/service');
const { neighborhood, impactOf } = require('../cmdb/graph');
const { ciList } = require('../cmdb/list');

const ciFields = {
  name: text(80),
  class_id: z.number().int().positive(),
  status: z.enum(Object.keys(cmdb.STATUSES)),
  environment: z.enum(Object.keys(cmdb.ENVIRONMENTS)),
  criticality: z.number().int().min(1).max(3),
  owner_id: optionalId,
  support_group_id: optionalId,
  location: optionalText(120),
  description: optionalText(4000),
  attributes: z.record(z.string(), z.any()).optional()
};

/** CMDB : réservée au support (agent et plus). */
module.exports = function cmdbRoutes({ db }) {
  const router = express.Router();
  router.use(requireRole('agent'));

  router.get('/meta', (_req, res) => {
    res.json({
      classes: cmdb.listClasses(db),
      relation_types: db.prepare('SELECT * FROM ci_relation_types ORDER BY label').all(),
      statuses: cmdb.STATUSES,
      environments: cmdb.ENVIRONMENTS,
      criticality: cmdb.CRITICALITY
    });
  });

  router.get('/', query(listQuerySchema), (req, res) => {
    res.json(runListQuery(db, ciList, req.validQuery, req.ctx));
  });

  router.post('/', body(z.object({ ...ciFields, status: ciFields.status.optional(), environment: ciFields.environment.optional(), criticality: ciFields.criticality.optional() })), (req, res) => {
    res.status(201).json(cmdb.createCi(req.ctx, req.body));
  });

  router.get('/:id', params(idParam), (req, res) => {
    const ci = cmdb.requireCi(db, req.validParams.id);
    res.json({ ...ci, relations: cmdb.listRelations(db, ci.id) });
  });

  router.patch('/:id', params(idParam), body(z.object(ciFields).partial().strict()), (req, res) => {
    res.json(cmdb.updateCi(req.ctx, req.validParams.id, req.body));
  });

  router.get('/:id/graph', params(idParam), query(z.object({ depth: z.coerce.number().int().min(1).max(4).default(2) })), (req, res) => {
    cmdb.requireCi(db, req.validParams.id);
    res.json(neighborhood(db, req.validParams.id, req.validQuery.depth));
  });

  router.get('/:id/impact', params(idParam), (req, res) => {
    cmdb.requireCi(db, req.validParams.id);
    res.json({ items: impactOf(db, req.validParams.id) });
  });

  // Tickets liés : CI principal, ou CI impacté (ticket_cis).
  router.get(
    '/:id/tickets',
    params(idParam),
    query(z.object({ type: z.enum(['incident', 'change', 'request']).default('incident') })),
    (req, res) => {
      const items = db
        .prepare(
          `SELECT t.id, t.number, t.type, t.title, t.state, t.priority, t.opened_at, t.resolved_at,
                  a.full_name AS assigned_to
             FROM tickets t LEFT JOIN users a ON a.id = t.assigned_to_id
            WHERE t.type = @type AND (t.ci_id = @id OR t.id IN (SELECT ticket_id FROM ticket_cis WHERE ci_id = @id))
            ORDER BY t.opened_at DESC LIMIT 200`
        )
        .all({ id: req.validParams.id, type: req.validQuery.type });
      res.json({ items });
    }
  );

  router.get('/:id/history', params(idParam), (req, res) => {
    res.json({ items: listAudit(db, 'ci', req.validParams.id).reverse() });
  });

  router.post(
    '/:id/relations',
    params(idParam),
    body(z.object({ target_id: z.number().int().positive(), type: z.string().max(30), direction: z.enum(['out', 'in']).default('out') })),
    (req, res) => {
      const { id } = req.validParams;
      const { target_id: other, type, direction } = req.body;
      const relId = direction === 'out' ? cmdb.addRelation(req.ctx, id, other, type) : cmdb.addRelation(req.ctx, other, id, type);
      res.status(201).json({ id: relId });
    }
  );

  router.delete('/relations/:id', params(idParam), (req, res) => {
    cmdb.removeRelation(req.ctx, req.validParams.id);
    res.json({ ok: true });
  });

  return router;
};
