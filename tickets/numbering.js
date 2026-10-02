'use strict';

/**
 * Numéros lisibles : préfixe + 7 chiffres (INC0001001). L'incrément et la
 * lecture tiennent en une instruction : deux créations simultanées ne
 * peuvent pas obtenir le même numéro.
 */
function nextNumber(db, prefix) {
  const row = db
    .prepare('UPDATE number_sequences SET next_value = next_value + 1 WHERE prefix = ? RETURNING next_value - 1 AS n')
    .get(prefix);
  if (!row) throw new Error(`Séquence inconnue : ${prefix}`);
  return formatNumber(prefix, row.n);
}

const formatNumber = (prefix, n) => `${prefix}${String(n).padStart(7, '0')}`;

const NUMBER_PATTERN = /^(INC|REQ|TASK|CHG|KB)(\d{7})$/;

module.exports = { nextNumber, formatNumber, NUMBER_PATTERN };
