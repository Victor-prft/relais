'use strict';

/**
 * Abonnés synchrones aux événements des tickets (SLA, notifications…).
 * Ils tournent dans la transaction de l'écriture : si l'un échoue, rien
 * n'est enregistré — un SLA ne peut pas diverger de son ticket.
 *
 * Événements : created(ctx, ticket), updated(ctx, before, after),
 *              journal(ctx, ticket, entry).
 */
const listeners = { created: [], updated: [], journal: [] };

function on(event, fn) {
  listeners[event].push(fn);
}

function emit(event, ...args) {
  for (const fn of listeners[event]) fn(...args);
}

module.exports = { on, emit };
