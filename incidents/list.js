'use strict';

/** Définition de la vue liste des incidents (cf. lib/list-query.js). */

const STATE_ORDER = "CASE t.state WHEN 'new' THEN 1 WHEN 'assigned' THEN 2 WHEN 'in_progress' THEN 3 WHEN 'on_hold' THEN 4 WHEN 'resolved' THEN 5 WHEN 'closed' THEN 6 ELSE 7 END";

const incidentList = {
  from: `FROM tickets t
    JOIN incidents i ON i.ticket_id = t.id
    LEFT JOIN users r ON r.id = t.requester_id
    LEFT JOIN users a ON a.id = t.assigned_to_id
    LEFT JOIN support_groups g ON g.id = t.assignment_group_id
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN categories pc ON pc.id = c.parent_id
    LEFT JOIN cis ci ON ci.id = t.ci_id`,
  where: "t.type = 'incident'",
  search: ['t.number', 't.title', 't.description', 'r.full_name', 'ci.name'],
  defaultSort: { key: 'opened_at', dir: 'desc' },
  extraSelect: ['t.id AS id', 't.version AS version'],
  columns: {
    number: { sql: 't.number', sortable: true, filter: 'text' },
    title: { sql: 't.title', sortable: true, filter: 'text' },
    state: { sql: 't.state', sortable: true, sortSql: STATE_ORDER, filter: 'enum' },
    priority: { sql: 't.priority', sortable: true, filter: 'number' },
    impact: { sql: 't.impact', sortable: true, filter: 'number' },
    urgency: { sql: 't.urgency', sortable: true, filter: 'number' },
    requester: { sql: 'r.full_name', sortable: true },
    requester_id: { sql: 't.requester_id', filter: 'id' },
    assigned_to: { sql: 'a.full_name', sortable: true },
    assigned_to_id: { sql: 't.assigned_to_id', filter: 'id' },
    assignment_group: { sql: 'g.name', sortable: true },
    assignment_group_id: { sql: 't.assignment_group_id', filter: 'id' },
    category: { sql: "CASE WHEN pc.id IS NULL THEN c.name ELSE pc.name || ' › ' || c.name END", sortable: true },
    category_id: { sql: 't.category_id', filter: 'id' },
    category_root_id: { sql: 'COALESCE(c.parent_id, c.id)', filter: 'id' },
    ci: { sql: 'ci.name', sortable: true },
    ci_id: { sql: 't.ci_id', filter: 'id' },
    contact_type: { sql: 'i.contact_type', sortable: true, filter: 'enum' },
    on_hold_reason: { sql: 'i.on_hold_reason', filter: 'enum' },
    opened_at: { sql: 't.opened_at', sortable: true, filter: 'date' },
    updated_at: { sql: 't.updated_at', sortable: true, filter: 'date' },
    resolved_at: { sql: 't.resolved_at', sortable: true, filter: 'date' },
    active: { sql: "CASE WHEN t.state IN ('new', 'assigned', 'in_progress', 'on_hold') THEN 1 ELSE 0 END", filter: 'bool' }
  }
};

module.exports = { incidentList, STATE_ORDER };
