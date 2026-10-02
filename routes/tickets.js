'use strict';

const express = require('express');
const { z, body, params, query, idParam, text } = require('../lib/validate');
const { requireAuth, requireRole } = require('../auth/middleware');
const { notFound, badRequest } = require('../lib/http-errors');
const { requireTicket, isStaffActor } = require('../tickets/service');
const { assertCanView, scopeClause, canView } = require('../tickets/access');
const { addEntry, listActivity } = require('../tickets/journal');
const { recordEvent } = require('../tickets/audit');
const { NUMBER_PATTERN } = require('../tickets/numbering');
const { escapeLike } = require('../lib/list-query');
const { ticketView } = require('../tickets/view');

/** Routes communes à tous les types de tickets : journal, activité, liens, recherche. */
module.exports = function ticketRoutes({ db }) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/by-number/:number', (req, res) => {
    const number = String(req.params.number).toUpperCase();
    if (!NUMBER_PATTERN.test(number)) throw badRequest('Numéro invalide');
    if (number.startsWith('KB')) {
      const article = db.prepare('SELECT id FROM kb_articles WHERE number = ?').get(number);
      if (!article) throw notFound('Article introuvable');
      return res.json({ id: article.id, type: 'kb_article', number });
    }
    const row = db.prepare('SELECT id FROM tickets WHERE number = ?').get(number);
    const ticket = row && requireTicket(db, row.id);
    assertCanView(db, req.user, ticket);
    res.json({ id: ticket.id, type: ticket.type, number });
  });

  router.get('/search', query(z.object({ q: z.string().trim().min(1).max(100) })), (req, res) => {
    const scope = scopeClause(req.user);
    const like = `%${escapeLike(req.validQuery.q)}%`;
    const rows = db
      .prepare(
        `SELECT t.id, t.number, t.type, t.title, t.state, t.priority, t.opened_at FROM tickets t
          WHERE ${scope.sql} AND (t.number LIKE @like ESCAPE '\\' OR t.title LIKE @like ESCAPE '\\' OR t.description LIKE @like ESCAPE '\\')
          ORDER BY t.opened_at DESC LIMIT 30`
      )
      .all({ ...scope.params, like });
    res.json({ items: rows });
  });

  // Vue générique d'un ticket, quel que soit son type (portail, recherche).
  router.get('/:id', params(idParam), (req, res) => {
    const ticket = requireTicket(db, req.validParams.id);
    assertCanView(db, req.user, ticket);
    res.json(ticketView(req.ctx, ticket));
  });

  router.get('/:id/activity', params(idParam), (req, res) => {
    const ticket = requireTicket(db, req.validParams.id);
    assertCanView(db, req.user, ticket);
    res.json({ items: listActivity(db, ticket.id, { internal: isStaffActor(req.ctx) }) });
  });

  router.post(
    '/:id/journal',
    params(idParam),
    body(z.object({ kind: z.enum(['comment', 'work_note']).default('comment'), body: text(10000) })),
    (req, res) => {
      const ticket = requireTicket(db, req.validParams.id);
      assertCanView(db, req.user, ticket);
      res.status(201).json(addEntry(req.ctx, ticket.id, req.body));
    }
  );

  // --- Liens entre tickets -------------------------------------------------
  const RELATION_LABELS = { related: 'Lié à', duplicate_of: 'Doublon de', caused_by: 'Causé par' };

  router.get('/:id/relations', params(idParam), (req, res) => {
    const ticket = requireTicket(db, req.validParams.id);
    assertCanView(db, req.user, ticket);
    const rows = db
      .prepare(
        `SELECT r.kind, 'out' AS direction, t.id, t.number, t.type, t.title, t.state, t.priority
           FROM ticket_relations r JOIN tickets t ON t.id = r.to_id WHERE r.from_id = @id
         UNION ALL
         SELECT r.kind, 'in' AS direction, t.id, t.number, t.type, t.title, t.state, t.priority
           FROM ticket_relations r JOIN tickets t ON t.id = r.from_id WHERE r.to_id = @id
         UNION ALL
         SELECT 'child' AS kind, 'out' AS direction, t.id, t.number, t.type, t.title, t.state, t.priority
           FROM tickets t WHERE t.parent_id = @id`
      )
      .all({ id: ticket.id })
      .filter((row) => canView(db, req.user, row));
    res.json({ items: rows, labels: RELATION_LABELS });
  });

  router.post(
    '/:id/relations',
    requireRole('agent'),
    params(idParam),
    body(z.object({ number: z.string().trim().toUpperCase().regex(NUMBER_PATTERN), kind: z.enum(Object.keys(RELATION_LABELS)) })),
    (req, res) => {
      const ticket = requireTicket(db, req.validParams.id);
      const target = db.prepare('SELECT id, number FROM tickets WHERE number = ?').get(req.body.number);
      if (!target) throw notFound(`Aucun ticket ${req.body.number}`);
      if (target.id === ticket.id) throw badRequest('Un ticket ne peut pas être lié à lui-même');
      const now = req.ctx.now.toISOString();
      db.transaction(() => {
        db.prepare(
          'INSERT OR IGNORE INTO ticket_relations (from_id, to_id, kind, created_by, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(ticket.id, target.id, req.body.kind, req.user.id, now);
        recordEvent(db, {
          entity: 'ticket',
          entityId: ticket.id,
          event: 'link',
          display: `${RELATION_LABELS[req.body.kind]} ${target.number}`,
          userId: req.user.id,
          at: now
        });
      })();
      res.status(201).json({ ok: true });
    }
  );

  router.delete(
    '/:id/relations/:toId/:kind',
    requireRole('agent'),
    params(z.object({ id: z.coerce.number().int().positive(), toId: z.coerce.number().int().positive(), kind: z.enum(Object.keys(RELATION_LABELS)) })),
    (req, res) => {
      const { id, toId, kind } = req.validParams;
      const info = db.prepare('DELETE FROM ticket_relations WHERE from_id = ? AND to_id = ? AND kind = ?').run(id, toId, kind);
      if (!info.changes) throw notFound('Lien introuvable');
      res.json({ ok: true });
    }
  );

  return router;
};
