'use strict';

const { unprocessable } = require('./http-errors');

/**
 * Machine à états déclarative, partagée par les types de tickets.
 *
 *   defineWorkflow({
 *     states: { new: 'Nouveau', ... },
 *     transitions: { new: ['assigned', ...], ... },
 *     requesterTransitions: { resolved: ['closed', 'in_progress'] },
 *     terminal: ['closed', 'canceled']
 *   })
 *
 * Les rôles de support (agent et plus) ont toutes les transitions ; le
 * demandeur n'a que celles de `requesterTransitions`.
 */
function defineWorkflow({ states, transitions, requesterTransitions = {}, terminal = [], steps = null, stepAlias = {} }) {
  for (const [from, targets] of Object.entries(transitions)) {
    if (!states[from]) throw new Error(`État inconnu dans le workflow : ${from}`);
    for (const to of targets) if (!states[to]) throw new Error(`Transition vers un état inconnu : ${from} → ${to}`);
  }

  const can = (from, to, { staff = true } = {}) => {
    if (from === to) return true;
    const table = staff ? transitions : requesterTransitions;
    return (table[from] || []).includes(to);
  };

  const allowed = (from, { staff = true } = {}) => [...((staff ? transitions : requesterTransitions)[from] || [])];

  const assert = (from, to, opts) => {
    if (!states[to]) throw unprocessable(`État inconnu : ${to}`);
    if (!can(from, to, opts)) {
      throw unprocessable(`Transition interdite : ${states[from]} → ${states[to]}`, { from, to });
    }
  };

  return {
    states,
    transitions,
    terminal,
    // Étapes affichées dans la frise d'avancement (hors états de sortie).
    steps: steps || Object.keys(states).filter((s) => !terminal.includes(s) || s === terminal[0]),
    can,
    allowed,
    assert,
    // Étape de la frise qui représente un état hors frise (En attente → En cours).
    stepOf: (state) => stepAlias[state] || state,
    isTerminal: (state) => terminal.includes(state),
    label: (state) => states[state] || state
  };
}

module.exports = { defineWorkflow };
