'use strict';

/** Vue liste des changements. */
const changeList = {
  from: `FROM tickets t JOIN changes c ON c.ticket_id = t.id
    LEFT JOIN users r ON r.id = t.requester_id
    LEFT JOIN users a ON a.id = t.assigned_to_id
    LEFT JOIN support_groups g ON g.id = t.assignment_group_id`,
  where: "t.type = 'change'",
  search: ['t.number', 't.title', 't.description', 'c.justification'],
  defaultSort: { key: 'planned_start', dir: 'desc' },
  extraSelect: ['t.id AS id'],
  columns: {
    number: { sql: 't.number', sortable: true, filter: 'text' },
    title: { sql: 't.title', sortable: true, filter: 'text' },
    state: { sql: 't.state', sortable: true, filter: 'enum' },
    change_type: { sql: 'c.change_type', sortable: true, filter: 'enum' },
    risk: { sql: 'c.risk', sortable: true, sortSql: "CASE c.risk WHEN 'high' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END", filter: 'enum' },
    priority: { sql: 't.priority', sortable: true, filter: 'number' },
    planned_start: { sql: 'c.planned_start', sortable: true, filter: 'date' },
    planned_end: { sql: 'c.planned_end', sortable: true, filter: 'date' },
    requester: { sql: 'r.full_name', sortable: true },
    assigned_to: { sql: 'a.full_name', sortable: true },
    assigned_to_id: { sql: 't.assigned_to_id', filter: 'id' },
    assignment_group: { sql: 'g.name', sortable: true },
    assignment_group_id: { sql: 't.assignment_group_id', filter: 'id' },
    cis: { sql: "(SELECT GROUP_CONCAT(ci.name, ', ') FROM ticket_cis tc JOIN cis ci ON ci.id = tc.ci_id WHERE tc.ticket_id = t.id)" },
    close_code: { sql: 'c.close_code', sortable: true, filter: 'enum' },
    opened_at: { sql: 't.opened_at', sortable: true, filter: 'date' },
    active: { sql: "CASE WHEN t.state IN ('draft', 'assess', 'authorized', 'scheduled', 'implement', 'review') THEN 1 ELSE 0 END", filter: 'bool' }
  }
};

module.exports = { changeList };
