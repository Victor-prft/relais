'use strict';

/** Vue liste des CI (cf. lib/list-query.js). */
const ciList = {
  from: `FROM cis ci
    JOIN ci_classes cl ON cl.id = ci.class_id
    LEFT JOIN users u ON u.id = ci.owner_id
    LEFT JOIN support_groups g ON g.id = ci.support_group_id`,
  search: ['ci.name', 'ci.description', 'ci.location', 'ci.attributes'],
  defaultSort: { key: 'name', dir: 'asc' },
  tieBreaker: 'ci.id',
  extraSelect: ['ci.id AS id', 'cl.icon AS class_icon'],
  columns: {
    name: { sql: 'ci.name', sortable: true, filter: 'text' },
    class_label: { sql: 'cl.label', sortable: true },
    class_code: { sql: 'cl.code', filter: 'enum' },
    status: { sql: 'ci.status', sortable: true, filter: 'enum' },
    environment: { sql: 'ci.environment', sortable: true, filter: 'enum' },
    criticality: { sql: 'ci.criticality', sortable: true, filter: 'number' },
    support_group: { sql: 'g.name', sortable: true },
    support_group_id: { sql: 'ci.support_group_id', filter: 'id' },
    owner: { sql: 'u.full_name', sortable: true },
    owner_id: { sql: 'ci.owner_id', filter: 'id' },
    location: { sql: 'ci.location', sortable: true, filter: 'text' },
    open_incidents: {
      sql: "(SELECT COUNT(*) FROM tickets t WHERE t.ci_id = ci.id AND t.type = 'incident' AND t.state IN ('new', 'assigned', 'in_progress', 'on_hold'))",
      sortable: true,
      filter: 'number'
    },
    relation_count: { sql: '(SELECT COUNT(*) FROM ci_relations r WHERE r.source_ci_id = ci.id OR r.target_ci_id = ci.id)', sortable: true },
    updated_at: { sql: 'ci.updated_at', sortable: true, filter: 'date' }
  }
};

module.exports = { ciList };
