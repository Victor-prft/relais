'use strict';

const hooks = require('../tickets/hooks');
const { notify, groupMembers, groupManager } = require('./service');

/**
 * Qui est prévenu de quoi :
 * - assignation à un agent → l'agent ; ticket qui arrive dans une file sans agent → le groupe ;
 * - commentaire du support → le demandeur ; du demandeur → l'agent (ou le groupe) ;
 *   note interne → l'agent assigné ;
 * - résolution, attente d'une réponse → le demandeur.
 * L'auteur de l'action n'est jamais notifié de sa propre action.
 */

hooks.on('created', (ctx, ticket) => {
  if (!['incident', 'request_task'].includes(ticket.type)) return;
  // Une tâche d'une étape ultérieure n'arrive dans la file qu'à l'ouverture de son étape.
  if (ticket.state === 'pending') return;
  if (ticket.assigned_to_id) {
    notify(ctx, { userIds: [ticket.assigned_to_id], type: 'assigned', title: `${ticket.number} vous est assigné`, body: ticket.title, ticket });
  } else if (ticket.assignment_group_id && ticket.type !== 'request') {
    const urgent = ticket.priority <= 2;
    notify(ctx, {
      userIds: [...groupMembers(ctx.db, ticket.assignment_group_id), urgent ? groupManager(ctx.db, ticket.assignment_group_id) : null],
      type: 'queue',
      title: `${urgent ? `P${ticket.priority} — ` : ''}nouveau ticket dans votre file : ${ticket.number}`,
      body: ticket.title,
      ticket
    });
  }
});

hooks.on('updated', (ctx, before, after) => {
  const { db } = ctx;
  if (after.assigned_to_id && after.assigned_to_id !== before.assigned_to_id) {
    notify(ctx, { userIds: [after.assigned_to_id], type: 'assigned', title: `${after.number} vous est assigné`, body: after.title, ticket: after });
  } else if (!after.assigned_to_id && after.assignment_group_id && after.assignment_group_id !== before.assignment_group_id) {
    notify(ctx, { userIds: groupMembers(db, after.assignment_group_id), type: 'queue', title: `${after.number} transféré dans votre file`, body: after.title, ticket: after });
  }

  if (before.state === after.state) return;
  const requester = [after.requester_id, after.requested_for_id];
  if (after.type === 'incident' && after.state === 'resolved') {
    notify(ctx, { userIds: requester, type: 'state_changed', title: `Votre incident ${after.number} est résolu`, body: after.resolution_notes || after.title, ticket: after });
  }
  if (after.type === 'incident' && after.state === 'on_hold' && after.on_hold_reason === 'awaiting_user') {
    notify(ctx, { userIds: requester, type: 'state_changed', title: `Le support attend votre réponse sur ${after.number}`, body: after.title, ticket: after });
  }
  if (after.type === 'incident' && before.state === 'resolved' && after.state === 'in_progress' && after.assigned_to_id) {
    notify(ctx, { userIds: [after.assigned_to_id], type: 'state_changed', title: `${after.number} a été rouvert par le demandeur`, body: after.title, ticket: after });
  }
  if (after.type === 'request' && ['fulfilled', 'rejected'].includes(after.state)) {
    notify(ctx, {
      userIds: requester,
      type: 'state_changed',
      title: after.state === 'fulfilled' ? `Votre demande ${after.number} est traitée` : `Votre demande ${after.number} a été refusée`,
      body: after.title,
      ticket: after
    });
  }
});

hooks.on('journal', (ctx, ticket, entry) => {
  const { db } = ctx;
  const author = entry.author_id;
  const fromRequester = author !== null && (author === ticket.requester_id || author === ticket.requested_for_id);
  const excerpt = entry.body.length > 140 ? `${entry.body.slice(0, 140)}…` : entry.body;

  if (entry.kind === 'work_note') {
    notify(ctx, { userIds: [ticket.assigned_to_id], type: 'comment', title: `Note interne sur ${ticket.number}`, body: excerpt, ticket });
    return;
  }
  if (fromRequester) {
    const target = ticket.assigned_to_id ? [ticket.assigned_to_id] : groupMembers(db, ticket.assignment_group_id);
    notify(ctx, { userIds: target, type: 'comment', title: `Réponse du demandeur sur ${ticket.number}`, body: excerpt, ticket });
  } else {
    notify(ctx, { userIds: [ticket.requester_id, ticket.requested_for_id], type: 'comment', title: `Nouveau message du support sur ${ticket.number}`, body: excerpt, ticket });
  }
});
