'use strict';

const express = require('express');
const { z, body } = require('../lib/validate');
const { requireRole } = require('../auth/middleware');
const { notFound, forbidden } = require('../lib/http-errors');
const { hasRole } = require('../auth/roles');
const { WIDGETS, defaultLayout, availableWidgets } = require('../dashboard/widgets');

const item = z.object({
  id: z.string().regex(/^[a-z_]{1,40}$/),
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(500),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(20)
});

/** Tableau de bord : disposition par utilisateur + données des widgets. */
module.exports = function dashboardRoutes({ db }) {
  const router = express.Router();
  router.use(requireRole('agent'));

  router.get('/layout', (req, res) => {
    const row = db.prepare('SELECT layout FROM dashboard_layouts WHERE user_id = ?').get(req.user.id);
    const allowed = new Set(availableWidgets(req.user).map((w) => w.id));
    const layout = (row ? JSON.parse(row.layout) : defaultLayout(req.user)).filter((w) => allowed.has(w.id));
    res.json({ layout, widgets: availableWidgets(req.user), custom: Boolean(row) });
  });

  router.put(
    '/layout',
    body(z.object({ layout: z.array(item).max(30).refine((l) => new Set(l.map((w) => w.id)).size === l.length, 'widget en double') })),
    (req, res) => {
      const allowed = new Set(availableWidgets(req.user).map((w) => w.id));
      const unknown = req.body.layout.find((w) => !allowed.has(w.id));
      if (unknown) throw forbidden(`Widget indisponible : ${unknown.id}`);
      db.prepare(
        `INSERT INTO dashboard_layouts (user_id, layout, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET layout = excluded.layout, updated_at = excluded.updated_at`
      ).run(req.user.id, JSON.stringify(req.body.layout), req.ctx.now.toISOString());
      res.json({ ok: true });
    }
  );

  router.delete('/layout', (req, res) => {
    db.prepare('DELETE FROM dashboard_layouts WHERE user_id = ?').run(req.user.id);
    res.json({ layout: defaultLayout(req.user) });
  });

  router.get('/widgets/:id', (req, res) => {
    const widget = WIDGETS[req.params.id];
    if (!widget) throw notFound('Widget inconnu');
    if (!hasRole(req.user, widget.role)) throw forbidden();
    res.json(widget.data(req.ctx));
  });

  return router;
};
