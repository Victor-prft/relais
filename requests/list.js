'use strict';

/** Vues liste des demandes (REQ) et des tâches (TASK). */

const common = {
  number: { sql: 't.number', sortable: true, filter: 'text' },
  title: { sql: 't.title', sortable: true, filter: 'text' },
  state: { sql: 't.state', sortable: true, filter: 'enum' },
  priority: { sql: 't.priority', sortable: true, filter: 'number' },
  requester: { sql: 'r.full_name', sortable: true },
  requester_id: { sql: 't.requester_id', filter: 'id' },
  assigned_to: { sql: 'a.full_name', sortable: true },
  assigned_to_id: { sql: 't.assigned_to_id', filter: 'id' },
  assignment_group: { sql: 'g.name', sortable: true },
  assignment_group_id: { sql: 't.assignment_group_id', filter: 'id' },
  opened_at: { sql: 't.opened_at', sortable: true, filter: 'date' },
  updated_at: { sql: 't.updated_at', sortable: true, filter: 'date' },
  closed_at: { sql: 't.closed_at', sortable: true, filter: 'date' }
};

const joins = `LEFT JOIN users r ON r.id = t.requester_id
    LEFT JOIN users a ON a.id = t.assigned_to_id
    LEFT JOIN support_groups g ON g.id = t.assignment_group_id`;

const requestList = {
  from: `FROM tickets t JOIN requests q ON q.ticket_id = t.id
    LEFT JOIN catalog_items ci ON ci.id = q.catalog_item_id
    LEFT JOIN users f ON f.id = q.requested_for_id
    ${joins}`,
  where: "t.type = 'request'",
  search: ['t.number', 't.title', 'r.full_name', 'f.full_name', 'ci.name'],
  defaultSort: { key: 'opened_at', dir: 'desc' },
  extraSelect: ['t.id AS id'],
  columns: {
    ...common,
    item: { sql: 'ci.name', sortable: true },
    catalog_item_id: { sql: 'q.catalog_item_id', filter: 'id' },
    requested_for: { sql: 'f.full_name', sortable: true },
    approval_state: { sql: 'q.approval_state', sortable: true, filter: 'enum' },
    tasks_done: {
      sql: "(SELECT COUNT(*) FROM tickets k WHERE k.parent_id = t.id AND k.state IN ('closed_complete', 'closed_incomplete', 'canceled'))"
    },
    tasks_total: { sql: '(SELECT COUNT(*) FROM tickets k WHERE k.parent_id = t.id)' },
    sla: {
      sql: "(SELECT MAX(s.percent) FROM ticket_slas s WHERE s.ticket_id = t.id AND s.stage IN ('running', 'paused'))",
      sortable: true,
      filter: 'number'
    },
    sla_paused: { sql: "(SELECT COUNT(*) FROM ticket_slas s WHERE s.ticket_id = t.id AND s.stage = 'paused')" },
    active: { sql: "CASE WHEN t.state IN ('pending_approval', 'in_progress') THEN 1 ELSE 0 END", filter: 'bool' }
  }
};

const taskList = {
  from: `FROM tickets t JOIN request_tasks k ON k.ticket_id = t.id
    JOIN tickets p ON p.id = t.parent_id
    ${joins}`,
  where: "t.type = 'request_task'",
  search: ['t.number', 't.title', 'p.number', 'p.title'],
  defaultSort: { key: 'opened_at', dir: 'desc' },
  extraSelect: ['t.id AS id', 'p.id AS parent_id'],
  columns: {
    ...common,
    parent_number: { sql: 'p.number', sortable: true, filter: 'text' },
    parent_title: { sql: 'p.title', sortable: true },
    sequence: { sql: 'k.sequence', sortable: true, filter: 'number' },
    active: { sql: "CASE WHEN t.state IN ('open', 'in_progress') THEN 1 ELSE 0 END", filter: 'bool' }
  }
};

module.exports = { requestList, taskList };
