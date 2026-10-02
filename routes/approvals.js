'use strict';

const express = require('express');
const { z, body, params, query, idParam, optionalText } = require('../lib/validate');
const { requireAuth } = require('../auth/middleware');
const { decide } = require('../approvals/service');

/** Approbations : chacun ne voit et ne tranche que celles qui lui sont adressées. */
module.exports = function approvalRoutes({ db }) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', query(z.object({ state: z.enum(['requested', 'decided']).default('requested') })), (req, res) => {
    const decided = req.validQuery.state === 'decided';
    const items = db
      .prepare(
        `SELECT a.id, a.state, a.comment, a.requested_at, a.decided_at,
                t.id AS ticket_id, t.number, t.type, t.title, t.priority, t.state AS ticket_state,
                r.full_name AS requester, f.full_name AS requested_for, ci.name AS item, ci.form_schema AS item_schema, q.variables,
                c.change_type, c.risk, c.planned_start, c.planned_end
           FROM approvals a JOIN tickets t ON t.id = a.ticket_id
           LEFT JOIN users r ON r.id = t.requester_id
           LEFT JOIN requests q ON q.ticket_id = t.id
           LEFT JOIN users f ON f.id = q.requested_for_id
           LEFT JOIN catalog_items ci ON ci.id = q.catalog_item_id
           LEFT JOIN changes c ON c.ticket_id = t.id
          WHERE a.approver_id = ? AND ${decided ? "a.state IN ('approved', 'rejected')" : "a.state = 'requested'"}
          ORDER BY ${decided ? 'a.decided_at DESC' : 'a.requested_at'} LIMIT 100`
      )
      .all(req.user.id)
      .map(({ item_schema: schema, ...r }) => {
        // Réponses au formulaire avec leurs libellés, dans l'ordre de l'article.
        const values = r.variables ? JSON.parse(r.variables) : null;
        const fields = schema ? JSON.parse(schema) : [];
        const answers = values ? fields.filter((f) => values[f.name] !== undefined).map((f) => ({ label: f.label, value: values[f.name] })) : [];
        return { ...r, variables: values, answers };
      });
    res.json({ items });
  });

  router.post(
    '/:id/decision',
    params(idParam),
    body(z.object({ decision: z.enum(['approved', 'rejected']), comment: optionalText(1000) })),
    (req, res) => {
      res.json(decide(req.ctx, req.validParams.id, req.body.decision, req.body.comment || null));
    }
  );

  return router;
};
