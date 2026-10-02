'use strict';

const { getSetting } = require('../lib/settings');
const { updateTicket } = require('../tickets/service');
const { addEntry } = require('../tickets/journal');

/**
 * Clôture automatique : un incident résolu depuis plus de N jours
 * (réglage `incident.auto_close_days`) sans réouverture passe « Clos ».
 * Le demandeur a eu le temps de contester ; au-delà, la résolution vaut accord.
 */
function autoCloseResolved(db, now = new Date()) {
  const days = Number(getSetting(db, 'incident.auto_close_days', 3));
  const limit = new Date(now.getTime() - days * 86400000).toISOString();
  const ids = db
    .prepare("SELECT id FROM tickets WHERE type = 'incident' AND state = 'resolved' AND resolved_at <= ? ORDER BY resolved_at")
    .all(limit)
    .map((r) => r.id);

  const ctx = { db, user: null, now };
  for (const id of ids) {
    db.transaction(() => {
      addEntry(ctx, id, { kind: 'comment', body: `Clôture automatique : résolu depuis plus de ${days} jour(s) sans réouverture.` });
      updateTicket(ctx, id, { state: 'closed' });
    })();
  }
  return { closed: ids.length };
}

/** Même règle pour les demandes « Traitées » (réglage `request.auto_close_days`). */
function autoCloseFulfilled(db, now = new Date()) {
  const days = Number(getSetting(db, 'request.auto_close_days', 3));
  const limit = new Date(now.getTime() - days * 86400000).toISOString();
  const ids = db.prepare("SELECT id FROM tickets WHERE type = 'request' AND state = 'fulfilled' AND resolved_at <= ?").all(limit).map((r) => r.id);
  const ctx = { db, user: null, now };
  for (const id of ids) updateTicket(ctx, id, { state: 'closed' });
  return { closed: ids.length };
}

module.exports = { autoCloseResolved, autoCloseFulfilled };
