'use strict';

const express = require('express');
const { z, query } = require('../lib/validate');
const { requireAuth } = require('../auth/middleware');

const CLOSED_STATES = ['closed', 'canceled', 'rejected'];

/** Portail self-service : les tickets du compte (demandeur, auteur ou bénéficiaire). */
module.exports = function portalRoutes({ db }) {
  const router = express.Router();
  router.use(requireAuth);

  router.get(
    '/tickets',
    query(z.object({ open: z.enum(['0', '1']).optional(), pageSize: z.coerce.number().int().min(1).max(200).default(50) })),
    (req, res) => {
      const { open, pageSize } = req.validQuery;
      const closedList = CLOSED_STATES.map((s) => `'${s}'`).join(', ');
      const stateClause = open === '1' ? `AND t.state NOT IN (${closedList})` : open === '0' ? `AND t.state IN (${closedList})` : '';
      const hasRequests = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'requests'").get();
      const forClause = hasRequests ? 'OR t.id IN (SELECT ticket_id FROM requests WHERE requested_for_id = @me)' : '';
      const items = db
        .prepare(
          `SELECT t.id, t.number, t.type, t.title, t.state, t.priority, t.opened_at, t.updated_at
             FROM tickets t
            WHERE t.type IN ('incident', 'request')
              AND (t.requester_id = @me OR t.opened_by_id = @me ${forClause})
              ${stateClause}
            ORDER BY t.updated_at DESC LIMIT @limit`
        )
        .all({ me: req.user.id, limit: pageSize });
      res.json({ items });
    }
  );

  return router;
};
