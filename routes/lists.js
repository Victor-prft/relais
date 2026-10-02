'use strict';

const express = require('express');
const { z, body, params, text } = require('../lib/validate');
const { requireAuth } = require('../auth/middleware');
const { notFound, conflict } = require('../lib/http-errors');

const listKey = z.string().regex(/^[a-z_]{1,40}$/);

/** Préférences des vues liste (colonnes, taille de page) et filtres enregistrés. */
module.exports = function listRoutes({ db }) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/:key', params(z.object({ key: listKey })), (req, res) => {
    const { key } = req.validParams;
    const pref = db.prepare('SELECT columns, page_size FROM list_preferences WHERE user_id = ? AND list_key = ?').get(req.user.id, key);
    const filters = db
      .prepare('SELECT id, name, query FROM saved_filters WHERE user_id = ? AND list_key = ? ORDER BY name')
      .all(req.user.id, key)
      .map((f) => ({ ...f, query: JSON.parse(f.query) }));
    res.json({
      columns: pref ? JSON.parse(pref.columns) : null,
      page_size: pref?.page_size ?? 25,
      filters
    });
  });

  router.put(
    '/:key/preferences',
    params(z.object({ key: listKey })),
    body(z.object({ columns: z.array(z.string().max(50)).max(40), page_size: z.number().int().min(5).max(200) })),
    (req, res) => {
      db.prepare(
        `INSERT INTO list_preferences (user_id, list_key, columns, page_size) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, list_key) DO UPDATE SET columns = excluded.columns, page_size = excluded.page_size`
      ).run(req.user.id, req.validParams.key, JSON.stringify(req.body.columns), req.body.page_size);
      res.json({ ok: true });
    }
  );

  const filterQuery = z.object({
    q: z.string().max(200).optional(),
    sort: z.string().max(50).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
    filters: z.array(z.object({ field: z.string().max(50), op: z.string().max(20), value: z.any() })).max(20)
  });

  router.post(
    '/:key/filters',
    params(z.object({ key: listKey })),
    body(z.object({ name: text(60), query: filterQuery })),
    (req, res) => {
      try {
        const info = db
          .prepare('INSERT INTO saved_filters (user_id, list_key, name, query, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(req.user.id, req.validParams.key, req.body.name, JSON.stringify(req.body.query), req.ctx.now.toISOString());
        res.status(201).json({ id: Number(info.lastInsertRowid) });
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) throw conflict('Une vue porte déjà ce nom');
        throw err;
      }
    }
  );

  router.delete('/filters/:id', params(z.object({ id: z.coerce.number().int().positive() })), (req, res) => {
    const info = db.prepare('DELETE FROM saved_filters WHERE id = ? AND user_id = ?').run(req.validParams.id, req.user.id);
    if (!info.changes) throw notFound('Vue introuvable');
    res.json({ ok: true });
  });

  return router;
};
