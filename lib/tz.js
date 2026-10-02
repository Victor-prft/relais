'use strict';

/**
 * Fuseaux horaires sans dépendance, via Intl. On stocke tout en UTC ; les
 * heures ouvrées, elles, s'entendent en heure locale (9 h à Paris = 7 h ou 8 h
 * UTC selon la saison). Ces fonctions font le pont, changements d'heure compris.
 */

const formatters = new Map();

function formatter(tz) {
  if (!formatters.has(tz)) {
    formatters.set(
      tz,
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short'
      })
    );
  }
  return formatters.get(tz);
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Composantes locales d'un instant : { year, month, day, hour, minute, second, weekday (0 = dimanche) }. */
function zonedParts(date, tz) {
  const out = {};
  for (const { type, value } of formatter(tz).formatToParts(date)) {
    if (type === 'weekday') out.weekday = WEEKDAYS[value];
    else if (type !== 'literal') out[type] = Number(value);
  }
  return out;
}

/** Décalage local − UTC en minutes à cet instant (+60 l'hiver à Paris, +120 l'été). */
function offsetMinutes(date, tz) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/**
 * Instant UTC correspondant à une heure locale. Une heure qui n'existe pas
 * (le passage à l'heure d'été saute 2 h → 3 h) glisse vers l'heure valide suivante.
 */
function zonedToUtc({ year, month, day, hour = 0, minute = 0 }, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = offsetMinutes(new Date(guess), tz);
  let t = guess - first * 60000;
  const second = offsetMinutes(new Date(t), tz);
  if (second !== first) t = guess - second * 60000;
  return new Date(t);
}

/** 'YYYY-MM-DD' local. */
function localDateString(date, tz) {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Jour civil suivant / précédent ('YYYY-MM-DD' ± n), indépendant du fuseau. */
function shiftDay(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

function weekdayOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

module.exports = { zonedParts, offsetMinutes, zonedToUtc, localDateString, shiftDay, weekdayOf };
