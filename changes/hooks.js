'use strict';

const hooks = require('../tickets/hooks');
const approvals = require('../approvals/service');

/**
 * Règle du CAB :
 * - normal : tous les approbateurs doivent approuver ; un seul refus rejette ;
 * - urgent (ECAB) : le premier avis tranche — on ne réunit pas un comité au milieu d'une panne.
 */
approvals.setRule('change', (list, ticket) => {
  const decided = list.filter((a) => a.state === 'approved' || a.state === 'rejected');
  if (ticket.change_type === 'emergency') return decided.length ? decided[0].state : null;
  if (list.some((a) => a.state === 'rejected')) return 'rejected';
  return list.length && list.every((a) => a.state === 'approved') ? 'approved' : null;
});

approvals.onConcluded('change', (ctx, ticket, outcome) => {
  const { updateTicket } = require('../tickets/service');
  updateTicket({ ...ctx, user: null }, ticket.id, { state: outcome === 'approved' ? 'authorized' : 'rejected' });
});

// Retiré du CAB, rejeté ou annulé : les approbations encore ouvertes tombent.
hooks.on('updated', (ctx, before, after) => {
  if (after.type !== 'change' || before.state !== 'assess' || after.state === 'assess') return;
  if (['draft', 'canceled'].includes(after.state)) approvals.cancelPending(ctx, after.id);
});
