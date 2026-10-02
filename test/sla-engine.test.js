'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb, addUser, addGroup } = require('./helpers/app');
const { createTicket, updateTicket } = require('../tickets/service');
const { addEntry } = require('../tickets/journal');
const { ticketSlas } = require('../sla/engine');
const { runSlaJob } = require('../sla/job');
const { zonedToUtc } = require('../lib/tz');

const paris = (s) => {
  const [date, time] = s.split(' ');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return zonedToUtc({ year, month, day, hour, minute }, 'Europe/Paris');
};

function setup() {
  const db = createTestDb();
  const agentId = addUser(db, { email: 'agent@x.test', role: 'agent', full_name: 'Agent' });
  const managerId = addUser(db, { email: 'chef@x.test', role: 'manager', full_name: 'Cheffe' });
  const userId = addUser(db, { email: 'user@x.test', role: 'user', full_name: 'Utilisateur' });
  const group = addGroup(db, 'SD', [agentId], managerId);
  const row = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return { db, agent: row(agentId), manager: row(managerId), user: row(userId), group };
}

const byTarget = (db, ticketId, now) => Object.fromEntries(ticketSlas(db, ticketId, now).filter((s) => s.stage !== 'canceled').map((s) => [s.target, s]));

test('SLA d’un incident P3 en heures ouvrées', async (t) => {
  const { db, agent, user, group } = setup();
  const ctx = (u, s) => ({ db, user: u, now: paris(s) });

  // P3 : prise en charge 2 h, résolution 20 h ouvrées (calendrier lun–ven 8 h–18 h).
  const inc = createTicket(ctx(user, '2026-03-02 16:00'), 'incident', { title: 'Lent', impact: 2, urgency: 2, assignment_group_id: group });

  await t.test('deux SLA démarrent à l’ouverture, échéances en heures ouvrées', () => {
    const s = byTarget(db, inc.id, paris('2026-03-02 16:00'));
    assert.equal(s.response.due_at, paris('2026-03-02 18:00').toISOString());
    // 20 h ouvrées à partir de lundi 16 h : 2 h lundi + 10 h mardi + 8 h mercredi → mercredi 16 h
    assert.equal(s.resolution.due_at, paris('2026-03-04 16:00').toISOString());
  });

  await t.test('la nuit ne compte pas : 75 % de la prise en charge le lendemain 8 h 30', () => {
    const s = byTarget(db, inc.id, paris('2026-03-03 08:30'));
    assert.equal(s.response.elapsed_minutes_now, 150);
    assert.equal(s.response.status, 'breached');
    const early = byTarget(db, inc.id, paris('2026-03-02 17:35'));
    assert.equal(early.response.status, 'at_risk');
    assert.ok(Math.abs(early.response.percent_now - 95 / 120) < 1e-9);
  });

  await t.test('prise en charge : le SLA de réponse s’arrête, dépassé', () => {
    updateTicket(ctx(agent, '2026-03-03 08:30'), inc.id, { assigned_to_id: agent.id, state: 'in_progress' });
    const s = byTarget(db, inc.id, paris('2026-03-03 08:30'));
    assert.equal(s.response.stage, 'completed');
    assert.equal(s.response.has_breached, 1);
    assert.equal(s.response.status, 'breached');
    assert.equal(s.resolution.stage, 'running');
  });

  await t.test('en attente : la résolution se fige, puis reprend avec une nouvelle échéance', () => {
    updateTicket(ctx(agent, '2026-03-03 10:00'), inc.id, { state: 'on_hold', on_hold_reason: 'awaiting_user' });
    let s = byTarget(db, inc.id, paris('2026-03-05 10:00'));
    assert.equal(s.resolution.stage, 'paused');
    assert.equal(s.resolution.elapsed_minutes_now, 120 + 120, 'lundi 16-18 h + mardi 8-10 h');
    assert.equal(s.resolution.due_at, null);
    // Le demandeur répond jeudi 10 h → relance automatique (abonné du journal).
    addEntry(ctx(user, '2026-03-05 10:00'), inc.id, { kind: 'comment', body: 'Voilà.' });
    s = byTarget(db, inc.id, paris('2026-03-05 10:00'));
    assert.equal(s.resolution.stage, 'running');
    // reste 1200 − 240 = 960 min → jeudi 10 h + 8 h (jeudi) + 8 h (vendredi 8-16 h)
    assert.equal(s.resolution.due_at, paris('2026-03-06 16:00').toISOString());
  });

  await t.test('résolu : arrêté dans les temps ; rouvert : le compteur reprend', () => {
    updateTicket(ctx(agent, '2026-03-05 15:00'), inc.id, { state: 'resolved', resolution_code: 'permanent_fix', resolution_notes: 'ok' });
    let s = byTarget(db, inc.id, paris('2026-03-05 15:00'));
    assert.equal(s.resolution.stage, 'completed');
    assert.equal(s.resolution.has_breached, 0);
    assert.equal(s.resolution.elapsed_minutes, 240 + 300);
    updateTicket(ctx(user, '2026-03-09 09:00'), inc.id, { state: 'in_progress' });
    s = byTarget(db, inc.id, paris('2026-03-09 10:00'));
    assert.equal(s.resolution.stage, 'running');
    assert.equal(s.resolution.elapsed_minutes_now, 540 + 60, 'le temps à l’état Résolu ne compte pas');
  });
});

test('changement de priorité : nouveau SLA, temps écoulé conservé', () => {
  const { db, agent, user, group } = setup();
  const ctx = (u, s) => ({ db, user: u, now: paris(s) });
  const inc = createTicket(ctx(user, '2026-03-02 09:00'), 'incident', { title: 'x', impact: 3, urgency: 3, assignment_group_id: group });
  // P5 → P2 une heure plus tard : la résolution P2 (8 h) a déjà 1 h de consommée.
  updateTicket(ctx(agent, '2026-03-02 10:00'), inc.id, { impact: 1, urgency: 2 });
  const all = ticketSlas(db, inc.id, paris('2026-03-02 10:00'));
  assert.equal(all.filter((s) => s.stage === 'canceled').length, 2);
  const active = Object.fromEntries(all.filter((s) => s.stage !== 'canceled').map((s) => [s.target, s]));
  assert.equal(active.resolution.name, 'Résolution P2');
  assert.equal(active.resolution.elapsed_minutes_now, 60);
  assert.equal(active.resolution.due_at, paris('2026-03-02 17:00').toISOString());
  assert.equal(active.response.name, 'Prise en charge P2');
  assert.equal(active.response.has_breached, 1, '1 h écoulée pour une prise en charge de 30 min');
});

test('P1 : calendrier 24 h/24', () => {
  const { db, user, group } = setup();
  const inc = createTicket({ db, user, now: paris('2026-03-07 23:00') }, 'incident', { title: 'Panne', impact: 1, urgency: 1, assignment_group_id: group });
  const s = byTarget(db, inc.id, paris('2026-03-07 23:00'));
  assert.equal(s.response.due_at, paris('2026-03-07 23:15').toISOString());
  assert.equal(s.resolution.due_at, paris('2026-03-08 03:00').toISOString());
});

test('annulation : SLA annulés', () => {
  const { db, user, agent, group } = setup();
  const inc = createTicket({ db, user, now: paris('2026-03-02 09:00') }, 'incident', { title: 'x', assignment_group_id: group });
  updateTicket({ db, user: agent, now: paris('2026-03-02 09:30') }, inc.id, { state: 'canceled' });
  assert.ok(ticketSlas(db, inc.id).every((s) => s.stage === 'canceled'));
});

test('job SLA : à risque puis dépassé, une seule notification de chaque', () => {
  const { db, agent, manager, user, group } = setup();
  const inc = createTicket({ db, user, now: paris('2026-03-02 09:00') }, 'incident', { title: 'Imprimante', impact: 2, urgency: 2, assignment_group_id: group });
  updateTicket({ db, user: agent, now: paris('2026-03-02 09:05') }, inc.id, { assigned_to_id: agent.id, state: 'in_progress' });
  const count = (type, userId) => db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE type = ? AND user_id = ?').get(type, userId).n;

  // Résolution P3 = 1200 min ouvrées depuis lundi 9 h : 540 min lundi, puis 75 % (900 min) mardi 14 h,
  // 100 % mercredi 9 h.
  assert.deepEqual(runSlaJob(db, paris('2026-03-03 10:00')), { refreshed: 1, at_risk: 0, breached: 0 });
  assert.equal(runSlaJob(db, paris('2026-03-03 14:30')).at_risk, 1);
  assert.equal(runSlaJob(db, paris('2026-03-03 15:00')).at_risk, 0, 'pas de doublon');
  assert.equal(count('sla_at_risk', agent.id), 1);
  assert.equal(runSlaJob(db, paris('2026-03-04 09:30')).breached, 1);
  assert.equal(count('sla_breached', agent.id), 1);
  assert.equal(count('sla_breached', manager.id), 1, 'le manager du groupe est prévenu du dépassement');
  const cached = db.prepare("SELECT percent, has_breached FROM ticket_slas s JOIN sla_definitions d ON d.id = s.sla_definition_id WHERE s.ticket_id = ? AND d.target = 'resolution'").get(inc.id);
  assert.equal(cached.has_breached, 1);
  assert.ok(cached.percent > 1);
});
