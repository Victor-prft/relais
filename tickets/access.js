'use strict';

const { notFound } = require('../lib/http-errors');

/**
 * Qui voit quoi :
 * - support (agent et plus) : tous les tickets ;
 * - utilisateur : les tickets dont il est demandeur, auteur ou bénéficiaire,
 *   et ceux qu'on lui demande d'approuver.
 * Un ticket invisible répond 404, pas 403 : on ne confirme pas qu'il existe.
 */

function canView(db, user, ticket) {
  if (!user) return false;
  if (user.role !== 'user') return true;
  if (ticket.requester_id === user.id || ticket.opened_by_id === user.id) return true;
  if (ticket.requested_for_id === user.id) return true;
  // Tâche de demande : visible si la demande parente l'est.
  return isApprover(db, user.id, ticket.id);
}

function isApprover(db, userId, ticketId) {
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'approvals'").get();
  if (!hasTable) return false;
  return Boolean(db.prepare('SELECT 1 FROM approvals WHERE ticket_id = ? AND approver_id = ?').get(ticketId, userId));
}

function assertCanView(db, user, ticket) {
  if (!ticket || !canView(db, user, ticket)) throw notFound('Ticket introuvable');
}

/**
 * Clause SQL qui restreint une liste aux tickets visibles (alias `t`).
 * Les paramètres sont nommés pour se combiner aux filtres de la liste.
 */
function scopeClause(user) {
  if (user.role !== 'user') return { sql: '1 = 1', params: {} };
  return {
    sql: '(t.requester_id = @scope_user OR t.opened_by_id = @scope_user)',
    params: { scope_user: user.id }
  };
}

module.exports = { canView, assertCanView, scopeClause, isApprover };
