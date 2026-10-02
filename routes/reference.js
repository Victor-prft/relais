'use strict';

const express = require('express');
const { z, query } = require('../lib/validate');
const { requireAuth, requireRole } = require('../auth/middleware');
const { listUsers } = require('../auth/users');

/** Données de référence en lecture : utilisateurs, groupes, catégories. */
module.exports = function referenceRoutes({ db }) {
  const router = express.Router();

  // Champs « référence » des formulaires (demandeur, bénéficiaire, assigné).
  router.get(
    '/users',
    requireAuth,
    query(
      z.object({
        q: z.string().trim().max(100).optional(),
        role: z.enum(['user', 'agent', 'manager', 'admin']).optional(),
        group_id: z.coerce.number().int().positive().optional(),
        staff: z.enum(['1']).optional()
      })
    ),
    (req, res) => {
      const { q, role, group_id: groupId, staff } = req.validQuery;
      let users = listUsers(db, { q, role, activeOnly: true });
      if (staff) users = users.filter((u) => u.role !== 'user');
      if (groupId) {
        const members = new Set(
          db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(groupId).map((r) => r.user_id)
        );
        users = users.filter((u) => members.has(u.id));
      }
      // Un simple utilisateur ne voit que le nom et le service des autres.
      const isStaff = req.user.role !== 'user';
      res.json({
        items: users.slice(0, 50).map((u) =>
          isStaff
            ? u
            : { id: u.id, full_name: u.full_name, department: u.department }
        )
      });
    }
  );

  router.get('/groups', requireRole('agent'), (_req, res) => {
    const groups = db
      .prepare(
        `SELECT g.id, g.name, g.description, g.manager_id, m.full_name AS manager_name, g.is_active,
                (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count
           FROM support_groups g LEFT JOIN users m ON m.id = g.manager_id
          ORDER BY g.name`
      )
      .all();
    const members = db
      .prepare(
        `SELECT gm.group_id, u.id, u.full_name, u.role FROM group_members gm
           JOIN users u ON u.id = gm.user_id ORDER BY u.full_name`
      )
      .all();
    for (const g of groups) g.members = members.filter((m) => m.group_id === g.id).map(({ group_id: _g, ...m }) => m);
    res.json({ items: groups });
  });

  router.get(
    '/categories',
    requireAuth,
    query(z.object({ scope: z.enum(['incident', 'catalog', 'kb']).optional() })),
    (req, res) => {
      const { scope } = req.validQuery;
      const rows = db
        .prepare(
          `SELECT c.id, c.parent_id, c.name, c.scope, c.default_group_id, c.sort_order, c.is_active
             FROM categories c
            WHERE (? IS NULL OR c.scope = ?)
            ORDER BY c.sort_order, c.name`
        )
        .all(scope ?? null, scope ?? null);
      res.json({ items: rows });
    }
  );

  return router;
};
