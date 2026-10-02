'use strict';

const { listAudit } = require('./audit');
const hooks = require('./hooks');
const { requireTicket } = require('./service');
const { forbidden } = require('../lib/http-errors');

/**
 * Journal d'un ticket : commentaires publics et notes de travail internes.
 * Ajouter une entrée ne change pas la version du ticket : un agent qui édite
 * le formulaire n'est pas bloqué parce qu'un collègue a commenté.
 */
function addEntry(ctx, ticketId, { kind, body }) {
  const { db } = ctx;
  return db.transaction(() => {
    const ticket = requireTicket(db, ticketId);
    if (kind === 'work_note' && (!ctx.user || ctx.user.role === 'user')) {
      throw forbidden('Les notes de travail sont réservées au support');
    }
    const now = ctx.now.toISOString();
    const info = db
      .prepare('INSERT INTO journal_entries (ticket_id, author_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(ticketId, ctx.user?.id ?? null, kind, body, now);
    db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now, ticketId);
    const entry = { id: Number(info.lastInsertRowid), ticket_id: ticketId, author_id: ctx.user?.id ?? null, kind, body, created_at: now };
    hooks.emit('journal', ctx, ticket, entry);
    return entry;
  })();
}

/** Champs d'audit visibles du demandeur dans son fil (le reste est interne). */
const PUBLIC_FIELDS = new Set(['_created', 'state', 'priority', 'assigned_to_id', 'approval_state']);

/**
 * Fil d'activité fusionné, du plus récent au plus ancien. Les changements de
 * champs faits au même instant par la même personne sont regroupés.
 */
function listActivity(db, ticketId, { internal = true } = {}) {
  const journal = db
    .prepare(
      `SELECT j.id, j.kind, j.body, j.created_at, j.author_id, u.full_name AS author_name
         FROM journal_entries j LEFT JOIN users u ON u.id = j.author_id
        WHERE j.ticket_id = ? ${internal ? '' : "AND j.kind = 'comment'"}`
    )
    .all(ticketId)
    .map((j) => ({ type: j.kind, id: `j${j.id}`, at: j.created_at, author_id: j.author_id, author_name: j.author_name, body: j.body }));

  const groups = new Map();
  for (const a of listAudit(db, 'ticket', ticketId)) {
    if (!internal && !PUBLIC_FIELDS.has(a.field)) continue;
    const key = `${a.created_at}|${a.user_id ?? ''}`;
    if (!groups.has(key)) {
      groups.set(key, { type: 'audit', id: `a${a.id}`, at: a.created_at, author_id: a.user_id, author_name: a.user_name, changes: [] });
    }
    groups.get(key).changes.push({ field: a.field, from: a.old_display, to: a.new_display });
  }

  return [...journal, ...groups.values()].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : x.type === 'audit' ? 1 : -1));
}

module.exports = { addEntry, listActivity, PUBLIC_FIELDS };
