'use strict';

const { getType } = require('./types');
const { isStaffActor } = require('./service');

/**
 * Représentation d'un ticket pour le front : valeurs brutes + libellés des
 * références + transitions permises à l'utilisateur courant.
 */
function ticketView(ctx, ticket) {
  const { db } = ctx;
  const def = getType(ticket.type);
  const names = db
    .prepare(
      `SELECT
         (SELECT full_name FROM users WHERE id = @requester) AS requester_name,
         (SELECT email FROM users WHERE id = @requester) AS requester_email,
         (SELECT department FROM users WHERE id = @requester) AS requester_department,
         (SELECT full_name FROM users WHERE id = @opened_by) AS opened_by_name,
         (SELECT full_name FROM users WHERE id = @assigned) AS assigned_to_name,
         (SELECT name FROM support_groups WHERE id = @grp) AS assignment_group_name,
         (SELECT CASE WHEN p.id IS NULL THEN c.name ELSE p.name || ' › ' || c.name END
            FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.id = @cat) AS category_label,
         (SELECT number FROM tickets WHERE id = @parent) AS parent_number,
         (SELECT type FROM tickets WHERE id = @parent) AS parent_type`
    )
    .get({
      requester: ticket.requester_id,
      opened_by: ticket.opened_by_id,
      assigned: ticket.assigned_to_id,
      grp: ticket.assignment_group_id,
      cat: ticket.category_id,
      parent: ticket.parent_id
    });

  if (ticket.ci_id) {
    const ci = db.prepare('SELECT name FROM cis WHERE id = ?').get(ticket.ci_id);
    names.ci_name = ci?.name ?? null;
  }

  const staff = isStaffActor(ctx);
  const isRequester = ctx.user && (ticket.requester_id === ctx.user.id || ticket.opened_by_id === ctx.user.id);
  const transitions = staff || isRequester ? def.workflow.allowed(ticket.state, { staff }) : [];

  const view = {
    ...ticket,
    ...names,
    state_label: def.workflow.label(ticket.state),
    allowed_transitions: transitions.map((state) => ({ state, label: def.workflow.label(state) })),
    workflow_steps: def.workflow.steps.map((state) => ({ state, label: def.workflow.label(state) })),
    workflow_step: def.workflow.stepOf(ticket.state),
    permissions: {
      edit: staff && !def.workflow.isTerminal(ticket.state),
      work_notes: staff,
      comment: true
    }
  };
  def.decorate?.(ctx, view);
  return view;
}

module.exports = { ticketView };
