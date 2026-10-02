'use strict';

const { displayValue } = require('./display');

const toText = (v) => (v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * Écrit une ligne d'audit par champ suivi qui a changé.
 * `tracked` : { champ: { kind, labels? } }.
 */
function recordChanges(db, { entity, entityId, before, after, tracked, userId, at }) {
  const insert = db.prepare(
    `INSERT INTO audit_entries (entity, entity_id, field, old_value, new_value, old_display, new_display, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const changed = [];
  for (const [field, spec] of Object.entries(tracked)) {
    const oldValue = toText(before?.[field]);
    const newValue = toText(after[field]);
    if (oldValue === newValue) continue;
    insert.run(
      entity,
      entityId,
      field,
      oldValue,
      newValue,
      displayValue(db, spec.kind, before?.[field], spec.labels),
      displayValue(db, spec.kind, after[field], spec.labels),
      userId ?? null,
      at
    );
    changed.push(field);
  }
  return changed;
}

/** Événement sans champ : création, approbation, lien… (field préfixé par « _ »). */
function recordEvent(db, { entity, entityId, event, display = null, userId, at }) {
  db.prepare(
    `INSERT INTO audit_entries (entity, entity_id, field, new_display, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(entity, entityId, `_${event}`, display, userId ?? null, at);
}

function listAudit(db, entity, entityId) {
  return db
    .prepare(
      `SELECT a.*, u.full_name AS user_name FROM audit_entries a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.entity = ? AND a.entity_id = ? ORDER BY a.created_at, a.id`
    )
    .all(entity, entityId);
}

module.exports = { recordChanges, recordEvent, listAudit };
