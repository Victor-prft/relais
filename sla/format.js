'use strict';

/** Durée en minutes → « 2 h 15 », « 1 j 3 h » (journée ouvrée comptée en heures pleines). */
function formatMinutes(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${String(rest).padStart(2, '0')}` : `${h} h`;
}

module.exports = { formatMinutes };
