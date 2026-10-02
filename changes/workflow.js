'use strict';

const { defineWorkflow } = require('../lib/workflow');

/**
 * Cycle de vie d'un changement (ITIL, CAB simplifié) :
 *
 *   Brouillon → Évaluation CAB → Autorisé → Planifié → Mise en œuvre → Revue → Clos
 *                  ↘ Rejeté (décision du CAB)
 *   Standard : Brouillon → Planifié directement (pré-autorisé par son modèle).
 *   Annulé : tant que la mise en œuvre n'a pas commencé.
 *
 * Évaluation → Autorisé / Rejeté est réservé au système : c'est la règle
 * d'approbation qui conclut (normal : tous les approbateurs ; urgent : le premier avis).
 */
const workflow = defineWorkflow({
  states: {
    draft: 'Brouillon',
    assess: 'Évaluation CAB',
    authorized: 'Autorisé',
    scheduled: 'Planifié',
    implement: 'Mise en œuvre',
    review: 'Revue',
    closed: 'Clos',
    rejected: 'Rejeté',
    canceled: 'Annulé'
  },
  transitions: {
    draft: ['assess', 'scheduled', 'canceled'],
    assess: ['draft', 'canceled'],
    authorized: ['scheduled', 'canceled'],
    scheduled: ['implement', 'canceled'],
    implement: ['review'],
    review: ['closed'],
    closed: [],
    rejected: ['draft'],
    canceled: []
  },
  systemTransitions: { assess: ['authorized', 'rejected'] },
  terminal: ['closed', 'canceled'],
  steps: ['draft', 'assess', 'authorized', 'scheduled', 'implement', 'review', 'closed']
});

const CHANGE_TYPES = { standard: 'Standard', normal: 'Normal', emergency: 'Urgent' };
const RISKS = { low: 'Faible', moderate: 'Modéré', high: 'Élevé' };
const CLOSE_CODES = {
  successful: 'Réussi',
  successful_with_issues: 'Réussi avec réserves',
  unsuccessful: 'Échec',
  backed_out: 'Retour arrière effectué'
};

/** États où le changement occupe sa fenêtre (calendrier, conflits). */
const ACTIVE_STATES = ['assess', 'authorized', 'scheduled', 'implement'];

/** Contenu figé dès la soumission : on ne change pas un plan approuvé sans repasser par le CAB. */
const CONTENT_FIELDS = ['change_type', 'risk', 'justification', 'implementation_plan', 'backout_plan', 'test_plan', 'title', 'description'];

module.exports = { workflow, CHANGE_TYPES, RISKS, CLOSE_CODES, ACTIVE_STATES, CONTENT_FIELDS };
