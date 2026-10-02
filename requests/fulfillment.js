'use strict';

const { createTicket, updateTicket, loadTicket } = require('../tickets/service');
const { notify, groupMembers } = require('../notifications/service');
const { taskWorkflow } = require('./workflow');

/**
 * Exécution d'une demande : génération des tâches depuis les modèles de
 * l'article, enchaînement des séquences, passage « Traitée » quand tout est fini.
 */

const system = (ctx) => ({ ...ctx, user: null });

function createTasks(ctx, request) {
  const { db } = ctx;
  const templates = db
    .prepare('SELECT * FROM catalog_item_tasks WHERE catalog_item_id = ? ORDER BY sequence, id')
    .all(request.catalog_item_id);
  if (!templates.length) return [];
  const first = templates[0].sequence;
  return templates.map((tpl) =>
    createTicket(system(ctx), 'request_task', {
      title: tpl.title,
      description: tpl.description,
      parent_id: request.id,
      requester_id: request.requester_id,
      opened_by_id: request.opened_by_id,
      impact: request.impact,
      urgency: request.urgency,
      assignment_group_id: tpl.assignment_group_id,
      catalog_item_task_id: tpl.id,
      sequence: tpl.sequence,
      state: tpl.sequence === first ? 'open' : 'pending'
    })
  );
}

const tasksOf = (db, requestId) => db.prepare("SELECT id FROM tickets WHERE parent_id = ? AND type = 'request_task'").all(requestId).map((r) => loadTicket(db, r.id));

/** Appelé quand une tâche se ferme : ouvre l'étape suivante, ou clôt la demande. */
function progress(ctx, requestId) {
  const { db } = ctx;
  const request = loadTicket(db, requestId);
  if (!request || request.state !== 'in_progress') return;
  const tasks = tasksOf(db, requestId);
  const remaining = tasks.filter((t) => !taskWorkflow.isTerminal(t.state));
  if (remaining.some((t) => t.state === 'open' || t.state === 'in_progress')) return;

  const pending = remaining.filter((t) => t.state === 'pending');
  if (pending.length) {
    const next = Math.min(...pending.map((t) => t.sequence));
    for (const t of pending.filter((p) => p.sequence === next)) {
      const opened = updateTicket(system(ctx), t.id, { state: 'open' });
      if (!opened.assigned_to_id) {
        notify(system(ctx), { userIds: groupMembers(db, opened.assignment_group_id), type: 'queue', title: `Nouvelle tâche dans votre file : ${opened.number}`, body: opened.title, ticket: opened });
      }
    }
    return;
  }
  updateTicket(system(ctx), requestId, { state: 'fulfilled' });
}

/** Demande annulée ou rejetée : ses tâches non finies sont annulées. */
function cancelTasks(ctx, requestId) {
  for (const t of tasksOf(ctx.db, requestId)) {
    if (!taskWorkflow.isTerminal(t.state)) updateTicket(system(ctx), t.id, { state: 'canceled' });
  }
}

module.exports = { createTasks, progress, cancelTasks, tasksOf };
