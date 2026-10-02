'use strict';

const { zonedToUtc, localDateString, shiftDay, weekdayOf } = require('../lib/tz');

/**
 * Temps ouvré.
 *
 * Un calendrier = des plages horaires locales par jour de la semaine + des
 * jours fériés, dans un fuseau. On découpe le temps jour civil par jour civil
 * (en heure locale), on convertit chaque plage en instants UTC — ce qui règle
 * les changements d'heure —, puis on intersecte avec l'intervalle demandé.
 *
 *   calendar = { timezone, hours: { 1: [[480, 1080]], … }, holidays: Set('2026-12-25') }
 */

const MIN = 60000;
const MAX_DAYS = 3660;

function loadCalendar(db, id) {
  const cal = db.prepare('SELECT * FROM business_calendars WHERE id = ?').get(id);
  if (!cal) throw new Error(`Calendrier introuvable : ${id}`);
  const hours = {};
  for (const row of db.prepare('SELECT weekday, start_minute, end_minute FROM business_hours WHERE calendar_id = ? ORDER BY start_minute').all(id)) {
    (hours[row.weekday] ||= []).push([row.start_minute, row.end_minute]);
  }
  const holidays = new Set(db.prepare('SELECT date FROM holidays WHERE calendar_id = ?').all(id).map((r) => r.date));
  return { id: cal.id, name: cal.name, timezone: cal.timezone, hours, holidays };
}

/** Instant UTC d'une minute locale d'un jour ('YYYY-MM-DD', 0..1440). */
function at(calendar, ymd, minute) {
  if (minute >= 1440) return at(calendar, shiftDay(ymd, 1), minute - 1440);
  const [year, month, day] = ymd.split('-').map(Number);
  return zonedToUtc({ year, month, day, hour: Math.floor(minute / 60), minute: minute % 60 }, calendar.timezone).getTime();
}

/** Plages ouvrées d'un jour civil local, en instants UTC [début, fin[. */
function dayWindows(calendar, ymd) {
  if (calendar.holidays.has(ymd)) return [];
  return (calendar.hours[weekdayOf(ymd)] || []).map(([s, e]) => [at(calendar, ymd, s), at(calendar, ymd, e)]);
}

const hasAnyHours = (calendar) => Object.values(calendar.hours).some((list) => list.length);

/** Minutes ouvrées entre deux instants (0 si fin ≤ début). */
function businessMinutesBetween(calendar, start, end) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (!(e > s)) return 0;
  let total = 0;
  // Un jour de marge avant : une plage peut commencer la veille en heure locale.
  let ymd = shiftDay(localDateString(new Date(s), calendar.timezone), -1);
  const last = localDateString(new Date(e), calendar.timezone);
  for (let i = 0; i < MAX_DAYS; i += 1) {
    for (const [a, b] of dayWindows(calendar, ymd)) {
      const lo = Math.max(a, s);
      const hi = Math.min(b, e);
      if (hi > lo) total += hi - lo;
    }
    if (ymd >= last) break;
    ymd = shiftDay(ymd, 1);
  }
  return total / MIN;
}

/** Instant atteint après `minutes` ouvrées à partir de `start`. */
function addBusinessMinutes(calendar, start, minutes) {
  const s = new Date(start).getTime();
  if (minutes <= 0) return new Date(s);
  if (!hasAnyHours(calendar)) throw new Error(`Le calendrier « ${calendar.name} » n’a aucune plage ouvrée`);
  let left = minutes * MIN;
  let ymd = shiftDay(localDateString(new Date(s), calendar.timezone), -1);
  for (let i = 0; i < MAX_DAYS; i += 1) {
    for (const [a, b] of dayWindows(calendar, ymd)) {
      const from = Math.max(a, s);
      if (b <= from) continue;
      const avail = b - from;
      if (left <= avail) return new Date(from + left);
      left -= avail;
    }
    ymd = shiftDay(ymd, 1);
  }
  throw new Error('Échéance au-delà de dix ans : calendrier sans plage ouvrée ?');
}

/** L'instant tombe-t-il dans une plage ouvrée ? */
function isBusinessTime(calendar, instant) {
  const t = new Date(instant).getTime();
  const ymd = localDateString(new Date(t), calendar.timezone);
  return [shiftDay(ymd, -1), ymd].some((d) => dayWindows(calendar, d).some(([a, b]) => t >= a && t < b));
}

module.exports = { loadCalendar, businessMinutesBetween, addBusinessMinutes, isBusinessTime, dayWindows };
