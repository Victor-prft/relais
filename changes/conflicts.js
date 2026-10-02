'use strict';

const { impactOf } = require('../cmdb/graph');
const { ACTIVE_STATES } = require('./workflow');

/**
 * Conflits de planification.
 * - direct : un autre changement actif touche un même CI sur une fenêtre qui chevauche ;
 * - indirect : il touche un CI qui dépend de l'un des nôtres (ou dont l'un des nôtres
 *   dépend) — deux interventions « séparées » peuvent tomber sur le même service.
 * Deux fenêtres [a, b[ et [c, d[ se chevauchent si a < d et c < b.
 */

const placeholders = (list) => list.map(() => '?').join(', ');

function changeCis(db, changeId) {
  return db.prepare('SELECT ci_id FROM ticket_cis WHERE ticket_id = ?').all(changeId).map((r) => r.ci_id);
}

function findConflicts(db, { changeId = null, ciIds, start, end }) {
  if (!ciIds?.length || !start || !end) return [];
  const others = db
    .prepare(
      `SELECT t.id, t.number, t.title, t.state, c.change_type, c.risk, c.planned_start, c.planned_end
         FROM tickets t JOIN changes c ON c.ticket_id = t.id
        WHERE t.type = 'change' AND t.state IN (${placeholders(ACTIVE_STATES)})
          AND (? IS NULL OR t.id <> ?)
          AND c.planned_start < ? AND c.planned_end > ?`
    )
    .all(...ACTIVE_STATES, changeId, changeId, end, start);
  if (!others.length) return [];

  const mine = new Set(ciIds);
  // Voisinage d'impact de nos CI, dans les deux sens.
  const related = new Set();
  for (const id of ciIds) for (const hit of impactOf(db, id)) related.add(hit.id);

  const names = (ids) => (ids.length ? db.prepare(`SELECT id, name FROM cis WHERE id IN (${placeholders(ids)})`).all(...ids) : []);
  const result = [];
  for (const other of others) {
    const theirs = changeCis(db, other.id);
    const shared = theirs.filter((id) => mine.has(id));
    let indirect = theirs.filter((id) => !mine.has(id) && related.has(id));
    if (!shared.length && !indirect.length) {
      // L'autre sens : nos CI dans l'impact des leurs.
      const reverse = new Set();
      for (const id of theirs) for (const hit of impactOf(db, id)) reverse.add(hit.id);
      indirect = ciIds.filter((id) => reverse.has(id));
    }
    if (shared.length) result.push({ ...other, level: 'conflict', cis: names(shared) });
    else if (indirect.length) result.push({ ...other, level: 'warning', cis: names(indirect) });
  }
  return result.sort((a, b) => (a.level === b.level ? a.planned_start.localeCompare(b.planned_start) : a.level === 'conflict' ? -1 : 1));
}

module.exports = { findConflicts, changeCis };
