'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computePriority, MATRIX } = require('../incidents/priority');

test('matrice ITIL impact × urgence', () => {
  const expected = {
    '1x1': 1, '1x2': 2, '1x3': 3,
    '2x1': 2, '2x2': 3, '2x3': 4,
    '3x1': 3, '3x2': 4, '3x3': 5
  };
  for (const [key, priority] of Object.entries(expected)) {
    const [impact, urgency] = key.split('x').map(Number);
    assert.equal(computePriority(impact, urgency), priority, `impact ${impact} × urgence ${urgency}`);
  }
});

test('la matrice est symétrique et égale à impact + urgence − 1', () => {
  for (let i = 1; i <= 3; i += 1) {
    for (let u = 1; u <= 3; u += 1) {
      assert.equal(MATRIX[i - 1][u - 1], MATRIX[u - 1][i - 1]);
      assert.equal(computePriority(i, u), i + u - 1);
    }
  }
});

test('les valeurs numériques en chaîne sont acceptées', () => {
  assert.equal(computePriority('2', '1'), 2);
});

test('hors bornes : erreur explicite', () => {
  for (const [i, u] of [[0, 1], [4, 1], [1, 0], [1, 4], [null, 2], ['a', 2], [1.5, 2]]) {
    assert.throws(() => computePriority(i, u), RangeError);
  }
});
