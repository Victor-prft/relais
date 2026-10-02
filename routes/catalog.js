'use strict';

const express = require('express');
const { z, body, params, idParam, text, optionalText, optionalId } = require('../lib/validate');
const { requireAuth, requireRole } = require('../auth/middleware');
const catalog = require('../requests/catalog');
const { ticketView } = require('../tickets/view');

const itemSchema = z.object({
  name: text(100),
  short_description: text(200),
  description: optionalText(5000),
  category_id: optionalId,
  icon: z.string().regex(/^[a-zA-Z]{1,30}$/).optional(),
  form_schema: z.array(z.any()).max(40),
  requires_approval: z.boolean(),
  fulfillment_group_id: optionalId,
  delivery_days: z.union([z.number().int().min(0).max(365), z.null()]).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(10000).optional(),
  tasks: z
    .array(z.object({ sequence: z.number().int().min(1).max(20), title: text(160), description: optionalText(2000), assignment_group_id: optionalId }))
    .max(20)
    .optional()
});

/** Catalogue : lecture et commande pour tous ; édition pour l'admin. */
module.exports = function catalogRoutes({ db }) {
  const router = express.Router();

  router.get('/items', requireAuth, (_req, res) => res.json({ items: catalog.listItems(db) }));

  router.get('/items/:id', requireAuth, params(idParam), (req, res) => res.json(catalog.getItem(db, req.validParams.id)));

  router.post(
    '/items/:id/order',
    requireAuth,
    params(idParam),
    body(z.object({ requested_for_id: optionalId, variables: z.record(z.string(), z.any()).default({}) })),
    (req, res) => {
      const ticket = catalog.orderItem(req.ctx, req.validParams.id, req.body);
      res.status(201).json(ticketView(req.ctx, ticket));
    }
  );

  // --- Administration --------------------------------------------------
  router.get('/admin/items', requireRole('admin'), (_req, res) => res.json({ items: catalog.listItems(db, { includeInactive: true }) }));
  router.post('/admin/items', requireRole('admin'), body(itemSchema), (req, res) => res.status(201).json(catalog.saveItem(req.ctx, null, req.body)));
  router.put('/admin/items/:id', requireRole('admin'), params(idParam), body(itemSchema), (req, res) => res.json(catalog.saveItem(req.ctx, req.validParams.id, req.body)));

  return router;
};
