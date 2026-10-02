'use strict';

const { requestWorkflow, taskWorkflow, APPROVAL_STATES } = require('./workflow');

/** Types « request » (REQ) et « request_task » (TASK) pour le service commun des tickets. */

const now = (ctx) => ctx.now.toISOString();

const request = {
  type: 'request',
  prefix: 'REQ',
  label: 'Demande',
  extTable: 'requests',
  extFields: ['catalog_item_id', 'requested_for_id', 'variables', 'approval_state'],
  workflow: requestWorkflow,
  initialState: 'pending_approval',
  tracked: {
    approval_state: { kind: 'enum', labels: APPROVAL_STATES },
    requested_for_id: { kind: 'user' }
  },

  decorate(ctx, view) {
    view.variables = typeof view.variables === 'string' ? JSON.parse(view.variables || '{}') : view.variables;
    view.approval_state_label = APPROVAL_STATES[view.approval_state];
    const item = view.catalog_item_id
      ? ctx.db.prepare('SELECT id, name, icon, form_schema FROM catalog_items WHERE id = ?').get(view.catalog_item_id)
      : null;
    view.catalog_item = item ? { ...item, form_schema: JSON.parse(item.form_schema) } : null;
    view.requested_for_name = view.requested_for_id
      ? ctx.db.prepare('SELECT full_name FROM users WHERE id = ?').get(view.requested_for_id)?.full_name
      : null;
  },

  beforeUpdate(ctx, before, after) {
    if (after.state !== before.state && requestWorkflow.isTerminal(after.state)) after.closed_at = now(ctx);
    if (after.state === 'fulfilled' && before.state !== 'fulfilled') after.resolved_at = now(ctx);
  }
};

const task = {
  type: 'request_task',
  prefix: 'TASK',
  label: 'Tâche',
  extTable: 'request_tasks',
  extFields: ['catalog_item_task_id', 'sequence'],
  workflow: taskWorkflow,
  initialState: 'open',
  tracked: {},

  beforeUpdate(ctx, before, after) {
    // Prise en charge sans agent : l'agent qui agit se l'attribue (s'il est du groupe).
    if (['in_progress', 'closed_complete', 'closed_incomplete'].includes(after.state) && after.state !== before.state) {
      require('../tickets/service').autoAssignActor(ctx, after);
    }
    if (!after.first_response_at && after.state === 'in_progress') after.first_response_at = now(ctx);
    if (after.state !== before.state && taskWorkflow.isTerminal(after.state)) {
      after.closed_at = now(ctx);
      after.resolved_at = now(ctx);
    }
  }
};

module.exports = { request, task };
