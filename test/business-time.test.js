'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { businessMinutesBetween, addBusinessMinutes, isBusinessTime, loadCalendar } = require('../sla/business-time');
const { createTestDb } = require('./helpers/app');
const { zonedToUtc } = require('../lib/tz');

const TZ = 'Europe/Paris';
const OFFICE = {
  name: 'bureau',
  timezone: TZ,
  hours: { 1: [[480, 1080]], 2: [[480, 1080]], 3: [[480, 1080]], 4: [[480, 1080]], 5: [[480, 1080]] },
  holidays: new Set(['2026-05-01', '2026-12-25'])
};
const ALWAYS = { name: '24/7', timezone: TZ, hours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [[0, 1440]]])), holidays: new Set() };

/** Heure de Paris → Date. */
const paris = (s) => {
  const [date, time = '00:00'] = s.split(' ');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return zonedToUtc({ year, month, day, hour, minute }, TZ);
};
const between = (cal, a, b) => businessMinutesBetween(cal, paris(a), paris(b));
const add = (cal, a, m) => addBusinessMinutes(cal, paris(a), m).toISOString();

test('minutes ouvrées entre deux instants', async (t) => {
  await t.test('dans la même journée', () => {
    assert.equal(between(OFFICE, '2026-03-02 09:00', '2026-03-02 11:00'), 120); // lundi
  });
  await t.test('le soir et le week-end ne comptent pas', () => {
    assert.equal(between(OFFICE, '2026-03-06 17:00', '2026-03-09 09:00'), 120); // vendredi → lundi
    assert.equal(between(OFFICE, '2026-03-07 10:00', '2026-03-09 08:30'), 30); // samedi → lundi
    assert.equal(between(OFFICE, '2026-03-02 19:00', '2026-03-03 07:00'), 0); // nuit
  });
  await t.test('jour férié sauté (1er mai, un vendredi)', () => {
    assert.equal(between(OFFICE, '2026-04-30 17:00', '2026-05-04 09:00'), 120);
  });
  await t.test('passage à l’heure d’été (29 mars 2026) : les plages restent en heure locale', () => {
    // vendredi 17 h (UTC+1) → lundi 9 h (UTC+2) : 1 h + 1 h ouvrées
    assert.equal(between(OFFICE, '2026-03-27 17:00', '2026-03-30 09:00'), 120);
  });
  await t.test('24 h/24 : la nuit du changement d’heure dure 23 h ou 25 h', () => {
    assert.equal(between(ALWAYS, '2026-03-29 00:00', '2026-03-29 04:00'), 180);
    assert.equal(between(ALWAYS, '2026-10-25 00:00', '2026-10-25 04:00'), 300);
    assert.equal(between(ALWAYS, '2026-03-28 12:00', '2026-03-30 12:00'), 47 * 60);
  });
  await t.test('plusieurs plages dans la journée (pause déjeuner)', () => {
    const lunch = { ...OFFICE, hours: { 1: [[480, 720], [780, 1080]] } };
    assert.equal(between(lunch, '2026-03-02 11:00', '2026-03-02 14:00'), 120);
  });
  await t.test('intervalle vide ou inversé', () => {
    assert.equal(between(OFFICE, '2026-03-02 10:00', '2026-03-02 10:00'), 0);
    assert.equal(between(OFFICE, '2026-03-02 11:00', '2026-03-02 10:00'), 0);
  });
  await t.test('sur plusieurs semaines', () => {
    // du lundi 2 mars 8 h au lundi 16 mars 8 h : 10 jours ouvrés de 600 min
    assert.equal(between(OFFICE, '2026-03-02 08:00', '2026-03-16 08:00'), 6000);
  });
});

test('échéance en minutes ouvrées', async (t) => {
  await t.test('dans la journée, puis report au lendemain matin', () => {
    assert.equal(add(OFFICE, '2026-03-02 09:00', 60), paris('2026-03-02 10:00').toISOString());
    assert.equal(add(OFFICE, '2026-03-02 17:30', 60), paris('2026-03-03 08:30').toISOString());
  });
  await t.test('démarrage hors heures : le compteur part à l’ouverture', () => {
    assert.equal(add(OFFICE, '2026-03-02 06:00', 30), paris('2026-03-02 08:30').toISOString());
    assert.equal(add(OFFICE, '2026-03-07 12:00', 30), paris('2026-03-09 08:30').toISOString());
  });
  await t.test('par-dessus un week-end et un jour férié', () => {
    assert.equal(add(OFFICE, '2026-03-06 17:00', 120), paris('2026-03-09 09:00').toISOString());
    assert.equal(add(OFFICE, '2026-04-30 17:00', 120), paris('2026-05-04 09:00').toISOString());
  });
  await t.test('24 h/24 à travers le passage à l’heure d’hiver', () => {
    assert.equal(add(ALWAYS, '2026-10-25 00:00', 240), paris('2026-10-25 03:00').toISOString());
  });
  await t.test('aller-retour : la durée mesurée après l’échéance est celle demandée', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 200; i += 1) {
      const start = new Date(paris('2026-01-05 00:00').getTime() + Math.floor(rnd() * 330 * 86400000));
      const minutes = 1 + Math.floor(rnd() * 5000);
      for (const cal of [OFFICE, ALWAYS]) {
        const due = addBusinessMinutes(cal, start, minutes);
        assert.ok(Math.abs(businessMinutesBetween(cal, start, due) - minutes) < 1e-6, `${start.toISOString()} + ${minutes}`);
      }
    }
  });
  await t.test('calendrier sans plage : erreur explicite', () => {
    assert.throws(() => addBusinessMinutes({ ...OFFICE, hours: {} }, new Date(), 10), /aucune plage/);
  });
});

test('isBusinessTime et calendriers du référentiel', () => {
  assert.equal(isBusinessTime(OFFICE, paris('2026-03-02 08:00')), true);
  assert.equal(isBusinessTime(OFFICE, paris('2026-03-02 18:00')), false);
  assert.equal(isBusinessTime(OFFICE, paris('2026-12-25 10:00')), false);
  const db = createTestDb();
  const office = loadCalendar(db, 1);
  assert.equal(office.timezone, 'Europe/Paris');
  assert.ok(office.holidays.has('2026-05-14'), 'Ascension 2026');
  assert.equal(between(office, '2026-05-13 17:00', '2026-05-15 09:00'), 120);
  assert.equal(loadCalendar(db, 2).hours[0][0][1], 1440);
});
