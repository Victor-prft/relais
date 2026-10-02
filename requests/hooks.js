'use strict';

const hooks = require('../tickets/hooks');
const approvals = require('../approvals/service');
const { taskWorkflow } = require('./workflow');

/** Enchaînements automatiques des demandes et de leurs tâches. */

hooks.on('updated', (ctx, before, after) => {
  const fulfillment = require('./fulfillment');
  if (after.type === 'request_task' && after.parent_id && !taskWorkflow.isTerminal(before.state) && taskWorkflow.isTerminal(after.state)) {
    fulfillment.progress(ctx, after.parent_id);
  }
  if (after.type === 'request' && before.state !== after.state && ['canceled', 'rejected'].includes(after.state)) {
    fulfillment.cancelTasks(ctx, after.id);
    approvals.cancelPending(ctx, after.id);
  }
});

// Conclusion de l'approbation d'une demande : on démarre l'exécution, ou on la rejette.
approvals.onConcluded('request', (ctx, ticket, outcome) => {
  const { updateTicket } = require('../tickets/service');
  const system = { ...ctx, user: null };
  if (outcome === 'approved') {
    const updated = updateTicket(system, ticket.id, { state: 'in_progress', approval_state: 'approved' });
    // Sans modèle de tâche, la demande reste « En cours » : le support la traite et la clôt à la main.
    require('./fulfillment').createTasks(ctx, updated);
  } else {
    updateTicket(system, ticket.id, { state: 'rejected', approval_state: 'rejected' });
  }
});
