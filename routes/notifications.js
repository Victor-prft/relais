'use strict';

const express = require('express');
const { params, idParam } = require('../lib/validate');
const { requireAuth } = require('../auth/middleware');
const { notFound } = require('../lib/http-errors');
const { listFor, unreadCount } = require('../notifications/service');

/** Cloche : notifications du compte connecté uniquement. */
module.exports = function notificationRoutes({ db }) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => res.json(listFor(db, req.user.id)));

  router.get('/unread-count', (req, res) => res.json({ unread: unreadCount(db, req.user.id) }));

  router.post('/read-all', (req, res) => {
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(req.ctx.now.toISOString(), req.user.id);
    res.json({ unread: 0 });
  });

  router.post('/:id/read', params(idParam), (req, res) => {
    const info = db
      .prepare('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?')
      .run(req.ctx.now.toISOString(), req.validParams.id, req.user.id);
    if (!info.changes) throw notFound('Notification introuvable');
    res.json({ unread: unreadCount(db, req.user.id) });
  });

  return router;
};
