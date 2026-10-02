'use strict';

const { priorityLabel, LEVELS } = require('../incidents/priority');

/**
 * Libellé lisible d'une valeur de champ, figé dans l'audit trail.
 * `kind` : 'user' | 'group' | 'category' | 'ci' | 'priority' | 'level' | 'enum' | 'date' | 'text'.
 */
function displayValue(db, kind, value, labels = null) {
  if (value === null || value === undefined || value === '') return null;
  switch (kind) {
    case 'user':
      return db.prepare('SELECT full_name FROM users WHERE id = ?').get(value)?.full_name ?? `#${value}`;
    case 'group':
      return db.prepare('SELECT name FROM support_groups WHERE id = ?').get(value)?.name ?? `#${value}`;
    case 'category': {
      const row = db
        .prepare('SELECT c.name, p.name AS parent FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.id = ?')
        .get(value);
      if (!row) return `#${value}`;
      return row.parent ? `${row.parent} › ${row.name}` : row.name;
    }
    case 'ci':
      return db.prepare('SELECT name FROM cis WHERE id = ?').get(value)?.name ?? `#${value}`;
    case 'priority':
      return priorityLabel(value);
    case 'level':
      return `${value} — ${LEVELS[value] || ''}`;
    case 'enum':
      return labels?.[value] ?? String(value);
    case 'date':
      return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(value));
    case 'text': {
      const s = String(value);
      return s.length > 140 ? `${s.slice(0, 140)}…` : s;
    }
    default:
      return String(value);
  }
}

module.exports = { displayValue };
