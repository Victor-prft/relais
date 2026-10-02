'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb, addUser, addGroup } = require('./helpers/app');
const { workflow } = require('../incidents/workflow');
const { createTicket, updateTicket, loadTicket } = require('../tickets/service');
const { addEntry, listActivity } = require('../tickets/journal');
const { autoCloseResolved } = require('../incidents/auto-close');

test('table des transitions', async (t) => {
  await t.test('chemin nominal autorisé pour le support', () => {
    const path = ['new', 'assigned', 'in_progress', 'on_hold', 'in_progress', 'resolved', 'closed'];
    for (let i = 1; i < path.length; i += 1) assert.ok(workflow.can(path[i - 1], path[i]), `${path[i - 1]} → ${path[i]}`);
  });

  await t.test('états terminaux sans issue', () => {
    for (const state of ['closed', 'canceled']) {
      for (const to of Object.keys(workflow.states)) if (to !== state) assert.equal(workflow.can(state, to), false);
    }
  });

  await t.test('interdits : sauter de Nouveau à Clos, rouvrir un clos, résolu → en attente', () => {
    assert.equal(workflow.can('new', 'closed'), false);
    assert.equal(workflow.can('closed', 'in_progress'), false);
    assert.equal(workflow.can('resolved', 'on_hold'), false);
    assert.equal(workflow.can('resolved', 'canceled'), false);
  });

  await t.test('le demandeur ne peut que confirmer, rouvrir ou annuler un nouveau', () => {
    const opts = { staff: false };
    assert.ok(workflow.can('resolved', 'closed', opts));
    assert.ok(workflow.can('resolved', 'in_progress', opts));
    assert.ok(workflow.can('new', 'canceled', opts));
    assert.equal(workflow.can('new', 'in_progress', opts), false);
    assert.equal(workflow.can('in_progress', 'resolved', opts), false);
    assert.equal(workflow.can('assigned', 'canceled', opts), false);
  });

  await t.test('chaque transition déclarée vise un état connu', () => {
    for (const [from, targets] of Object.entries(workflow.transitions)) {
      assert.ok(workflow.states[from]);
      for (const to of targets) assert.ok(workflow.states[to], `${from} → ${to}`);
    }
  });
});

test('cycle de vie via le service', async (t) => {
  const db = createTestDb();
  const agentId = addUser(db, { email: 'agent@x.test', role: 'agent', full_name: 'Agent Un' });
  const otherAgent = addUser(db, { email: 'agent2@x.test', role: 'agent', full_name: 'Agent Deux' });
  const userId = addUser(db, { email: 'user@x.test', role: 'user', full_name: 'Utilisatrice' });
  const sd = addGroup(db, 'Service Desk', [agentId]);
  addGroup(db, 'Infra', [otherAgent]);
  const agent = db.prepare('SELECT * FROM users WHERE id = ?').get(agentId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  let clock = new Date('2026-03-02T08:00:00.000Z');
  const as = (u) => ({ db, user: u, now: clock });
  const tick = (minutes) => {
    clock = new Date(clock.getTime() + minutes * 60000);
  };

  const inc = createTicket(as(user), 'incident', { title: 'Écran noir', impact: 2, urgency: 1 });

  await t.test('numérotation, priorité calculée, état initial', () => {
    assert.equal(inc.number, 'INC0001001');
    assert.equal(inc.priority, 2);
    assert.equal(inc.state, 'new');
    assert.equal(inc.requester_id, userId);
    assert.equal(createTicket(as(user), 'incident', { title: 'Autre' }).number, 'INC0001002');
  });

  await t.test('assigner un agent passe à « Assigné » et prend son groupe', () => {
    tick(5);
    const t1 = updateTicket(as(agent), inc.id, { assigned_to_id: agentId });
    assert.equal(t1.state, 'assigned');
    assert.equal(t1.assignment_group_id, sd);
    assert.equal(t1.version, 2);
  });

  await t.test('un agent hors du groupe est refusé', () => {
    assert.throws(() => updateTicket(as(agent), inc.id, { assigned_to_id: otherAgent }), /groupe/);
  });

  await t.test('un utilisateur simple ne peut pas être assigné', () => {
    assert.throws(() => updateTicket(as(agent), inc.id, { assigned_to_id: userId }), /agent actif/);
  });

  await t.test('version périmée → conflit', () => {
    assert.throws(() => updateTicket(as(agent), inc.id, { title: 'x' }, { expectedVersion: 1 }), (err) => err.status === 409);
  });

  await t.test('en cours puis en attente exige un motif', () => {
    tick(10);
    const t2 = updateTicket(as(agent), inc.id, { state: 'in_progress' });
    assert.equal(t2.first_response_at, clock.toISOString());
    assert.throws(() => updateTicket(as(agent), inc.id, { state: 'on_hold' }), /motif/);
    const t3 = updateTicket(as(agent), inc.id, { state: 'on_hold', on_hold_reason: 'awaiting_user' });
    assert.equal(t3.on_hold_reason, 'awaiting_user');
  });

  await t.test('la réponse du demandeur relance l’incident', () => {
    tick(30);
    addEntry(as(user), inc.id, { kind: 'comment', body: 'Voilà la capture demandée.' });
    const t4 = loadTicket(db, inc.id);
    assert.equal(t4.state, 'in_progress');
    assert.equal(t4.on_hold_reason, null);
  });

  await t.test('un demandeur ne peut pas résoudre ni écrire de note interne', () => {
    assert.throws(() => updateTicket(as(user), inc.id, { state: 'resolved' }), /interdite/);
    assert.throws(() => addEntry(as(user), inc.id, { kind: 'work_note', body: 'x' }), /réservées/);
  });

  await t.test('résoudre exige code et notes', () => {
    tick(60);
    assert.throws(() => updateTicket(as(agent), inc.id, { state: 'resolved' }), /résolution/);
    const t5 = updateTicket(as(agent), inc.id, { state: 'resolved', resolution_code: 'permanent_fix', resolution_notes: 'Câble remplacé' });
    assert.equal(t5.resolved_at, clock.toISOString());
  });

  await t.test('le demandeur rouvre : compteur et date de résolution remis', () => {
    tick(5);
    const t6 = updateTicket(as(user), inc.id, { state: 'in_progress' });
    assert.equal(t6.reopen_count, 1);
    assert.equal(t6.resolved_at, null);
  });

  await t.test('l’impact recalcule la priorité et l’audit garde les libellés', () => {
    const t7 = updateTicket(as(agent), inc.id, { impact: 3, urgency: 3 });
    assert.equal(t7.priority, 5);
    const audit = db.prepare("SELECT * FROM audit_entries WHERE entity_id = ? AND field = 'priority' ORDER BY id DESC").get(inc.id);
    assert.equal(audit.old_display, 'P2 Haute');
    assert.equal(audit.new_display, 'P5 Planifiée');
  });

  await t.test('clôture automatique après le délai, puis plus rien ne bouge', () => {
    updateTicket(as(agent), inc.id, { state: 'resolved', resolution_code: 'workaround', resolution_notes: 'ok' });
    assert.deepEqual(autoCloseResolved(db, new Date(clock.getTime() + 2 * 86400000)), { closed: 0 });
    assert.deepEqual(autoCloseResolved(db, new Date(clock.getTime() + 3 * 86400000 + 1000)), { closed: 1 });
    const closed = loadTicket(db, inc.id);
    assert.equal(closed.state, 'closed');
    assert.throws(() => updateTicket(as(agent), inc.id, { title: 'Modif' }), /plus modifiable/);
  });

  await t.test('le fil public du demandeur masque les notes et champs internes', () => {
    addEntry(as(agent), inc.id, { kind: 'work_note', body: 'interne' });
    const internal = listActivity(db, inc.id, { internal: true });
    const pub = listActivity(db, inc.id, { internal: false });
    assert.ok(internal.some((e) => e.type === 'work_note'));
    assert.ok(!pub.some((e) => e.type === 'work_note'));
    const pubFields = pub.filter((e) => e.type === 'audit').flatMap((e) => e.changes.map((c) => c.field));
    assert.ok(pubFields.includes('state'));
    assert.ok(!pubFields.includes('assignment_group_id'));
  });
});
