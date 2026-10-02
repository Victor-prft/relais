'use strict';

const hooks = require('../tickets/hooks');

/**
 * Un incident « En attente du demandeur » repart « En cours » dès que le
 * demandeur répond par un commentaire : l'agent n'a pas à guetter la réponse,
 * et le SLA de résolution reprend aussitôt.
 */
hooks.on('journal', (ctx, ticket, entry) => {
  if (ticket.type !== 'incident' || entry.kind !== 'comment') return;
  if (ticket.state !== 'on_hold' || ticket.on_hold_reason !== 'awaiting_user') return;
  if (!ctx.user || ctx.user.id !== ticket.requester_id) return;
  const { updateTicket } = require('../tickets/service');
  updateTicket({ ...ctx, user: null }, ticket.id, { state: 'in_progress' });
});
