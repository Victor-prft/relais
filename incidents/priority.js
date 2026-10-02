'use strict';

/**
 * Matrice ITIL impact × urgence → priorité (1 = le plus fort).
 *
 *              urgence 1   urgence 2   urgence 3
 *   impact 1      P1          P2          P3
 *   impact 2      P2          P3          P4
 *   impact 3      P3          P4          P5
 *
 * La matrice est symétrique et linéaire : priorité = impact + urgence − 1.
 * On garde la table explicite pour qu'elle se lise comme dans le référentiel.
 */
const MATRIX = [
  [1, 2, 3],
  [2, 3, 4],
  [3, 4, 5]
];

const LEVELS = { 1: 'Haute', 2: 'Moyenne', 3: 'Basse' };
const PRIORITIES = { 1: 'Critique', 2: 'Haute', 3: 'Moyenne', 4: 'Basse', 5: 'Planifiée' };

function computePriority(impact, urgency) {
  const i = Number(impact);
  const u = Number(urgency);
  if (![1, 2, 3].includes(i) || ![1, 2, 3].includes(u)) {
    throw new RangeError(`Impact et urgence doivent valoir 1, 2 ou 3 (reçu ${impact} × ${urgency})`);
  }
  return MATRIX[i - 1][u - 1];
}

const priorityLabel = (p) => `P${p} ${PRIORITIES[p] || ''}`.trim();

module.exports = { computePriority, priorityLabel, MATRIX, LEVELS, PRIORITIES };
