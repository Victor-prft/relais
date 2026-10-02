'use strict';

const { notFound, forbidden, unprocessable } = require('../lib/http-errors');
const { recordEvent } = require('../tickets/audit');
const { notify } = require('../notifications/service');
const { loadTicket } = require('../tickets/service');

/**
 * Approbations (demandes de service, CAB des changements).
 * Le service enregistre les décisions ; la règle qui conclut (un seul avis
 * suffit, ou tous) appartient au type de ticket : `rules[type](approvals)`
 * renvoie 'approved', 'rejected' ou null (pas encore conclu).
 */

const RULES = {
  // Demande : un seul approbateur (le manager du bénéficiaire).
  request: (approvals) => (approvals.some((a) => a.state === 'rejected') ? 'rejected' : approvals.every((a) => a.state === 'approved') ? 'approved' : null)
};

/** Les modules qui consomment une conclusion s'enregistrent ici (évite les dépendances circulaires). */
const conclusionHandlers = {};
const onConcluded = (type, fn) => {
  conclusionHandlers[type] = fn;
};
const setRule = (type, fn) => {
  RULES[type] = fn;
};

function listForTicket(db, ticketId) {
  return db
    .prepare(
      `SELECT a.*, u.full_name AS approver_name FROM approvals a JOIN users u ON u.id = a.approver_id
        WHERE a.ticket_id = ? ORDER BY a.requested_at, a.id`
    )
    .all(ticketId);
}

function requestApprovals(ctx, ticket, approverIds, { message = null } = {}) {
  const { db } = ctx;
  const at = ctx.now.toISOString();
  const unique = [...new Set(approverIds)];
  const insert = db.prepare(
    `INSERT INTO approvals (ticket_id, approver_id, state, requested_at) VALUES (?, ?, 'requested', ?)
     ON CONFLICT(ticket_id, approver_id) DO UPDATE SET state = 'requested', comment = NULL, decided_at = NULL, requested_at = excluded.requested_at`
  );
  for (const id of unique) insert.run(ticket.id, id, at);
  const names = unique.map((id) => db.prepare('SELECT full_name FROM users WHERE id = ?').get(id)?.full_name).filter(Boolean);
  recordEvent(db, { entity: 'ticket', entityId: ticket.id, event: 'approval', display: `Approbation demandée à ${names.join(', ')}`, userId: ctx.user?.id, at });
  notify({ ...ctx, user: null }, {
    userIds: unique,
    type: 'approval_requested',
    title: `Approbation demandée : ${ticket.number}`,
    body: message || ticket.title,
    ticket
  });
}

/** Annule les approbations encore ouvertes (ticket annulé, changement repassé en brouillon…). */
function cancelPending(ctx, ticketId) {
  ctx.db.prepare("UPDATE approvals SET state = 'canceled', decided_at = ? WHERE ticket_id = ? AND state = 'requested'").run(ctx.now.toISOString(), ticketId);
}

function decide(ctx, approvalId, decision, comment = null) {
  const { db } = ctx;
  return db.transaction(() => {
    const approval = db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId);
    if (!approval) throw notFound('Approbation introuvable');
    if (approval.approver_id !== ctx.user?.id) throw forbidden('Cette approbation ne vous est pas adressée');
    if (approval.state !== 'requested') throw unprocessable('Cette approbation a déjà été traitée');
    if (decision === 'rejected' && !comment) throw unprocessable('Un refus doit être motivé', [{ path: 'comment', message: 'Obligatoire' }]);

    const at = ctx.now.toISOString();
    db.prepare('UPDATE approvals SET state = ?, comment = ?, decided_at = ? WHERE id = ?').run(decision, comment, at, approvalId);
    const ticket = loadTicket(db, approval.ticket_id);
    recordEvent(db, {
      entity: 'ticket',
      entityId: ticket.id,
      event: 'approval',
      display: `${decision === 'approved' ? 'Approuvé' : 'Refusé'} par ${ctx.user.full_name}${comment ? ` : « ${comment} »` : ''}`,
      userId: ctx.user.id,
      at
    });

    const approvals = listForTicket(db, ticket.id).filter((a) => a.state !== 'canceled');
    const outcome = RULES[ticket.type]?.(approvals) ?? null;
    if (outcome) {
      cancelPending(ctx, ticket.id);
      conclusionHandlers[ticket.type]?.(ctx, ticket, outcome);
      notify(ctx, {
        userIds: [ticket.requester_id, ticket.opened_by_id],
        type: 'approval_decided',
        title: `${ticket.number} ${outcome === 'approved' ? 'approuvé' : 'refusé'}`,
        body: comment || ticket.title,
        ticket
      });
    }
    return { approval: db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId), outcome };
  })();
}

module.exports = { requestApprovals, decide, cancelPending, listForTicket, onConcluded, setRule, RULES };
