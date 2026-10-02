'use strict';

const express = require('express');
const { z, body, params, idParam, text, optionalText, optionalId } = require('../lib/validate');
const { requireRole } = require('../auth/middleware');
const { notFound, conflict } = require('../lib/http-errors');
const { createUser, updateUser, listUsers } = require('../auth/users');
const { allSettings, setSetting } = require('../lib/settings');

const role = z.enum(['user', 'agent', 'manager', 'admin']);

/** Configuration réservée aux administrateurs. */
module.exports = function adminRoutes({ db, sessionStore }) {
  const router = express.Router();
  router.use(requireRole('admin'));

  // --- Utilisateurs -------------------------------------------------------
  router.get('/users', (_req, res) => res.json({ items: listUsers(db) }));

  router.post(
    '/users',
    body(
      z.object({
        email: z.string().trim().email().max(200),
        full_name: text(120),
        password: z.string().min(8).max(200),
        role: role.default('user'),
        manager_id: optionalId,
        department: optionalText(120),
        phone: optionalText(40)
      })
    ),
    async (req, res, next) => {
      try {
        res.status(201).json(await createUser(db, req.body, req.ctx.now));
      } catch (err) {
        next(err);
      }
    }
  );

  router.patch(
    '/users/:id',
    params(idParam),
    body(
      z
        .object({
          email: z.string().trim().email().max(200),
          full_name: text(120),
          password: z.string().min(8).max(200),
          role,
          manager_id: optionalId,
          department: optionalText(120),
          phone: optionalText(40),
          is_active: z.boolean()
        })
        .partial()
        .strict()
    ),
    async (req, res, next) => {
      try {
        const { id } = req.validParams;
        const user = await updateUser(db, id, req.body, req.ctx.now);
        // Rôle retiré ou compte désactivé : les sessions ouvertes tombent.
        if (req.body.role || req.body.is_active === false || req.body.password) {
          if (id !== req.user.id) sessionStore.destroyUserSessions(id);
        }
        res.json(user);
      } catch (err) {
        next(err);
      }
    }
  );

  // --- Groupes ------------------------------------------------------------
  const groupSchema = z.object({
    name: text(80),
    description: optionalText(500),
    manager_id: optionalId,
    is_active: z.boolean().optional(),
    member_ids: z.array(z.number().int().positive()).max(200).optional()
  });

  const setMembers = (groupId, memberIds) => {
    db.prepare('DELETE FROM group_members WHERE group_id = ?').run(groupId);
    const insert = db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)');
    for (const userId of memberIds) insert.run(groupId, userId);
  };

  const uniqueGuard = (fn) => (req, res, next) => {
    try {
      fn(req, res);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return next(conflict('Ce nom est déjà utilisé'));
      if (String(err.message).includes('FOREIGN KEY')) return next(conflict('Référence invalide'));
      next(err);
    }
  };

  router.post(
    '/groups',
    body(groupSchema),
    uniqueGuard((req, res) => {
      const { name, description, manager_id: managerId, member_ids: memberIds = [] } = req.body;
      const id = db.transaction(() => {
        const info = db
          .prepare('INSERT INTO support_groups (name, description, manager_id) VALUES (?, ?, ?)')
          .run(name, description ?? null, managerId ?? null);
        setMembers(info.lastInsertRowid, memberIds);
        return info.lastInsertRowid;
      })();
      res.status(201).json({ id });
    })
  );

  router.patch(
    '/groups/:id',
    params(idParam),
    body(groupSchema.partial().strict()),
    uniqueGuard((req, res) => {
      const { id } = req.validParams;
      const group = db.prepare('SELECT * FROM support_groups WHERE id = ?').get(id);
      if (!group) throw notFound('Groupe introuvable');
      const next = { ...group, ...req.body };
      db.transaction(() => {
        db.prepare('UPDATE support_groups SET name = ?, description = ?, manager_id = ?, is_active = ? WHERE id = ?').run(
          next.name,
          next.description ?? null,
          next.manager_id ?? null,
          Number(next.is_active),
          id
        );
        if (req.body.member_ids) setMembers(id, req.body.member_ids);
      })();
      res.json({ id });
    })
  );

  // --- Catégories ---------------------------------------------------------
  const categorySchema = z.object({
    name: text(80),
    scope: z.enum(['incident', 'catalog', 'kb']),
    parent_id: optionalId,
    default_group_id: optionalId,
    sort_order: z.number().int().min(0).max(10000).optional(),
    is_active: z.boolean().optional()
  });

  router.post(
    '/categories',
    body(categorySchema),
    uniqueGuard((req, res) => {
      const c = req.body;
      const info = db
        .prepare(
          'INSERT INTO categories (name, scope, parent_id, default_group_id, sort_order) VALUES (?, ?, ?, ?, ?)'
        )
        .run(c.name, c.scope, c.parent_id ?? null, c.default_group_id ?? null, c.sort_order ?? 0);
      res.status(201).json({ id: info.lastInsertRowid });
    })
  );

  router.patch(
    '/categories/:id',
    params(idParam),
    body(categorySchema.omit({ scope: true }).partial().strict()),
    uniqueGuard((req, res) => {
      const { id } = req.validParams;
      const current = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
      if (!current) throw notFound('Catégorie introuvable');
      const c = { ...current, ...req.body };
      db.prepare(
        'UPDATE categories SET name = ?, parent_id = ?, default_group_id = ?, sort_order = ?, is_active = ? WHERE id = ?'
      ).run(c.name, c.parent_id ?? null, c.default_group_id ?? null, c.sort_order, Number(c.is_active), id);
      res.json({ id });
    })
  );

  // --- Réglages -----------------------------------------------------------
  const SETTINGS = {
    'incident.auto_close_days': z.number().int().min(1).max(60),
    'request.auto_close_days': z.number().int().min(1).max(60),
    'sla.at_risk_threshold': z.number().min(0.5).max(0.95)
  };

  router.get('/settings', (_req, res) => res.json(allSettings(db)));

  router.put(
    '/settings',
    body(z.object(Object.fromEntries(Object.entries(SETTINGS).map(([k, s]) => [k, s.optional()]))).strict()),
    (req, res) => {
      for (const [key, value] of Object.entries(req.body)) {
        if (value !== undefined) setSetting(db, key, value, req.ctx.now);
      }
      res.json(allSettings(db));
    }
  );

  return router;
};
