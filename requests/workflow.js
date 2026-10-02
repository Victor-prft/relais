'use strict';

const { defineWorkflow } = require('../lib/workflow');

/**
 * Demande de service (REQ) :
 *   En approbation → En cours → Traitée → Close
 *                  ↘ Rejetée          (décision du manager)
 *   Annulée : par le demandeur ou le support tant que rien n'est traité.
 * L'entrée et la sortie de « En approbation » sont réservées au système
 * (décision d'approbation) ; « Traitée » arrive quand la dernière tâche se ferme.
 */
const requestWorkflow = defineWorkflow({
  states: {
    pending_approval: 'En approbation',
    in_progress: 'En cours',
    fulfilled: 'Traitée',
    closed: 'Close',
    rejected: 'Rejetée',
    canceled: 'Annulée'
  },
  transitions: {
    pending_approval: ['canceled'],
    in_progress: ['fulfilled', 'canceled'],
    fulfilled: ['closed'],
    closed: [],
    rejected: [],
    canceled: []
  },
  systemTransitions: {
    pending_approval: ['in_progress', 'rejected']
  },
  requesterTransitions: {
    pending_approval: ['canceled'],
    in_progress: ['canceled'],
    fulfilled: ['closed']
  },
  terminal: ['closed', 'rejected', 'canceled'],
  steps: ['pending_approval', 'in_progress', 'fulfilled', 'closed']
});

/**
 * Tâche de demande (TASK) :
 *   En attente (une étape précédente n'est pas finie) → À traiter → En cours → Terminée
 *                                                                ↘ Non réalisée
 */
const taskWorkflow = defineWorkflow({
  states: {
    pending: 'En attente',
    open: 'À traiter',
    in_progress: 'En cours',
    closed_complete: 'Terminée',
    closed_incomplete: 'Non réalisée',
    canceled: 'Annulée'
  },
  transitions: {
    pending: ['canceled'],
    open: ['in_progress', 'closed_complete', 'closed_incomplete', 'canceled'],
    in_progress: ['open', 'closed_complete', 'closed_incomplete', 'canceled'],
    closed_complete: [],
    closed_incomplete: [],
    canceled: []
  },
  systemTransitions: { pending: ['open'] },
  terminal: ['closed_complete', 'closed_incomplete', 'canceled'],
  steps: ['open', 'in_progress', 'closed_complete'],
  stepAlias: { pending: 'open' }
});

const APPROVAL_STATES = { not_required: 'Sans approbation', requested: 'En attente d’approbation', approved: 'Approuvée', rejected: 'Refusée' };

module.exports = { requestWorkflow, taskWorkflow, APPROVAL_STATES };
