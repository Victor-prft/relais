'use strict';

const { defineWorkflow } = require('../lib/workflow');

/**
 * Cycle de vie d'un incident (ITIL) :
 *
 *   Nouveau → Assigné → En cours ⇄ En attente → Résolu → Clos
 *                                              ↘ (réouverture) En cours
 *   Annulé : depuis tout état non résolu.
 *
 * Le demandeur peut confirmer la résolution (→ Clos), rouvrir (→ En cours)
 * ou annuler un incident encore Nouveau. La clôture automatique, X jours
 * après la résolution, est faite par le job `incidents/auto-close.js`.
 */
const workflow = defineWorkflow({
  states: {
    new: 'Nouveau',
    assigned: 'Assigné',
    in_progress: 'En cours',
    on_hold: 'En attente',
    resolved: 'Résolu',
    closed: 'Clos',
    canceled: 'Annulé'
  },
  transitions: {
    new: ['assigned', 'in_progress', 'resolved', 'canceled'],
    assigned: ['in_progress', 'on_hold', 'resolved', 'canceled'],
    in_progress: ['on_hold', 'resolved', 'canceled'],
    on_hold: ['in_progress', 'resolved', 'canceled'],
    resolved: ['in_progress', 'closed'],
    closed: [],
    canceled: []
  },
  requesterTransitions: {
    new: ['canceled'],
    resolved: ['closed', 'in_progress']
  },
  terminal: ['closed', 'canceled'],
  steps: ['new', 'assigned', 'in_progress', 'resolved', 'closed'],
  stepAlias: { on_hold: 'in_progress' }
});

const ON_HOLD_REASONS = {
  awaiting_user: 'En attente du demandeur',
  awaiting_vendor: 'En attente du fournisseur',
  awaiting_change: 'En attente d’un changement'
};

const RESOLUTION_CODES = {
  permanent_fix: 'Résolu définitivement',
  workaround: 'Contournement',
  not_reproducible: 'Non reproductible',
  duplicate: 'Doublon',
  user_error: 'Erreur d’utilisation'
};

const CONTACT_TYPES = { portal: 'Portail', phone: 'Téléphone', email: 'Email', chat: 'Messagerie instantanée', ai: 'Portail (assistant IA)' };

/** États « ouverts » : ceux qui comptent dans les files et les SLA. */
const OPEN_STATES = ['new', 'assigned', 'in_progress', 'on_hold'];

module.exports = { workflow, ON_HOLD_REASONS, RESOLUTION_CODES, CONTACT_TYPES, OPEN_STATES };
