'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb, startTestApp, addUser, addGroup } = require('./helpers/app');
const { createCi, addRelation } = require('../cmdb/service');
const { createChange, submitToCab, setCis } = require('../changes/service');
const { findConflicts } = require('../changes/conflicts');
const { updateTicket, loadTicket } = require('../tickets/service');
const { decide } = require('../approvals/service');

const cls = (db, code) => db.prepare('SELECT id FROM ci_classes WHERE code = ?').get(code).id;

function setup(db) {
  const m1 = addUser(db, { email: 'm1@x.test', role: 'manager', full_name: 'Manager Un' });
  const m2 = addUser(db, { email: 'm2@x.test', role: 'manager', full_name: 'Manager Deux' });
  const agentId = addUser(db, { email: 'ag@x.test', role: 'agent' });
  addGroup(db, 'Infra', [agentId]);
  const row = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const ctx = (user, iso = '2026-03-02T09:00:00Z') => ({ db, user, now: new Date(iso) });
  const sys = ctx(null);
  const srv = createCi(sys, { name: 'SRV', class_id: cls(db, 'server'), attributes: { os: 'Linux' }, criticality: 1 }).id;
  const dbci = createCi(sys, { name: 'DB', class_id: cls(db, 'database'), attributes: { engine: 'PostgreSQL' } }).id;
  const app = createCi(sys, { name: 'APP', class_id: cls(db, 'application'), criticality: 3 }).id;
  const lonely = createCi(sys, { name: 'SEUL', class_id: cls(db, 'application'), criticality: 3 }).id;
  addRelation(sys, srv, dbci, 'hosts');
  addRelation(sys, app, dbci, 'depends_on');
  db.prepare("INSERT INTO standard_changes (name, implementation_plan, backout_plan, risk, duration_minutes) VALUES ('Redémarrage', 'Redémarrer', 'Rien', 'low', 30)").run();
  return { m1: row(m1), m2: row(m2), agent: row(agentId), ci: { srv, db: dbci, app, lonely }, ctx };
}

const plan = { justification: 'Faille', implementation_plan: 'Appliquer', backout_plan: 'Restaurer', planned_start: '2026-03-10T20:00:00.000Z', planned_end: '2026-03-10T22:00:00.000Z' };

test('workflow des changements', async (t) => {
  const db = createTestDb();
  const { m1, m2, agent, ci, ctx } = setup(db);

  await t.test('normal : brouillon → CAB (tous) → autorisé → planifié → mise en œuvre → revue → clos', () => {
    const chg = createChange(ctx(agent), { title: 'Patch SRV', ...plan, ci_ids: [ci.srv] });
    assert.equal(chg.number, 'CHG0001001');
    assert.equal(chg.state, 'draft');
    assert.throws(() => updateTicket(ctx(agent), chg.id, { state: 'scheduled' }), /passe d’abord par le CAB/);
    submitToCab(ctx(agent), chg.id, [m1.id, m2.id]);
    assert.equal(loadTicket(db, chg.id).state, 'assess');
    assert.throws(() => updateTicket(ctx(agent), chg.id, { state: 'authorized' }), /interdite/);
    assert.throws(() => updateTicket(ctx(agent), chg.id, { backout_plan: 'Autre chose' }), /figé/);
    const [a1, a2] = db.prepare('SELECT id FROM approvals WHERE ticket_id = ? ORDER BY id').all(chg.id);
    assert.equal(decide(ctx(m1), a1.id, 'approved').outcome, null, 'un seul avis ne suffit pas');
    assert.equal(decide(ctx(m2), a2.id, 'approved').outcome, 'approved');
    assert.equal(loadTicket(db, chg.id).state, 'authorized');
    updateTicket(ctx(agent), chg.id, { state: 'scheduled' });
    const started = updateTicket(ctx(agent, '2026-03-10T20:05:00Z'), chg.id, { state: 'implement' });
    assert.equal(started.actual_start, '2026-03-10T20:05:00.000Z');
    assert.throws(() => updateTicket(ctx(agent), chg.id, { planned_end: '2026-03-11T01:00:00.000Z' }), /ne se modifie plus/);
    updateTicket(ctx(agent, '2026-03-10T21:40:00Z'), chg.id, { state: 'review' });
    assert.throws(() => updateTicket(ctx(agent), chg.id, { state: 'closed' }), /obligatoires/);
    const closed = updateTicket(ctx(agent), chg.id, { state: 'closed', close_code: 'successful' });
    assert.equal(closed.state, 'closed');
  });

  await t.test('normal : un refus suffit à rejeter ; retour en brouillon possible', () => {
    const chg = createChange(ctx(agent), { title: 'Migration DB', ...plan, ci_ids: [ci.db] });
    submitToCab(ctx(agent), chg.id, [m1.id, m2.id]);
    const [a1] = db.prepare('SELECT id FROM approvals WHERE ticket_id = ? ORDER BY id').all(chg.id);
    assert.throws(() => decide(ctx(m1), a1.id, 'rejected'), /motivé/);
    decide(ctx(m1), a1.id, 'rejected', 'Pas pendant la clôture');
    assert.equal(loadTicket(db, chg.id).state, 'rejected');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE ticket_id = ? AND state = 'requested'").get(chg.id).n, 0, 'les avis restants sont annulés');
    updateTicket(ctx(agent), chg.id, { state: 'draft' });
    updateTicket(ctx(agent), chg.id, { backout_plan: 'Plan B revu' });
  });

  await t.test('urgent : le premier avis tranche', () => {
    const chg = createChange(ctx(agent), { title: 'Correctif urgent', change_type: 'emergency', ...plan });
    assert.equal(chg.priority, 2);
    submitToCab(ctx(agent), chg.id, [m1.id, m2.id]);
    const [, a2] = db.prepare('SELECT id FROM approvals WHERE ticket_id = ? ORDER BY id').all(chg.id);
    assert.equal(decide(ctx(m2), a2.id, 'approved').outcome, 'approved');
    assert.equal(loadTicket(db, chg.id).state, 'authorized');
  });

  await t.test('standard : depuis un modèle, planifié sans CAB', () => {
    const tpl = db.prepare('SELECT id FROM standard_changes').get().id;
    const chg = createChange(ctx(agent), { template_id: tpl, planned_start: '2026-03-12T19:00:00.000Z', ci_ids: [ci.app] });
    assert.equal(chg.change_type, 'standard');
    assert.equal(chg.planned_end, '2026-03-12T19:30:00.000Z', 'durée du modèle');
    assert.throws(() => submitToCab(ctx(agent), chg.id, [m1.id]), /pré-autorisé/);
    assert.equal(updateTicket(ctx(agent), chg.id, { state: 'scheduled' }).state, 'scheduled');
  });

  await t.test('CAB : uniquement des managers ; soumission exige plan et fenêtre', () => {
    const chg = createChange(ctx(agent), { title: 'Incomplet' });
    assert.throws(() => submitToCab(ctx(agent), chg.id, [agent.id]), /managers/);
    assert.throws(() => submitToCab(ctx(agent), chg.id, [m1.id]), /obligatoires/);
  });
});

test('conflits de planification', () => {
  const db = createTestDb();
  const { agent, m1, ci, ctx } = setup(db);
  const schedule = (title, ciIds, start, end) => {
    const chg = createChange(ctx(agent), { title, ...plan, planned_start: start, planned_end: end, ci_ids: ciIds });
    submitToCab(ctx(agent), chg.id, [m1.id]);
    return chg;
  };
  const a = schedule('A', [ci.srv], '2026-03-10T20:00:00.000Z', '2026-03-10T22:00:00.000Z');
  schedule('B', [ci.srv], '2026-03-10T21:00:00.000Z', '2026-03-10T23:00:00.000Z');
  schedule('C', [ci.app], '2026-03-10T21:30:00.000Z', '2026-03-10T21:45:00.000Z');
  schedule('D', [ci.srv], '2026-03-10T22:00:00.000Z', '2026-03-10T23:00:00.000Z');
  schedule('E', [ci.lonely], '2026-03-10T20:00:00.000Z', '2026-03-10T23:00:00.000Z');

  const found = findConflicts(db, { changeId: a.id, ciIds: [ci.srv], start: '2026-03-10T20:00:00.000Z', end: '2026-03-10T22:00:00.000Z' });
  const byTitle = Object.fromEntries(found.map((f) => [f.title, f.level]));
  assert.equal(byTitle.B, 'conflict', 'même CI, fenêtres qui se chevauchent');
  assert.equal(byTitle.C, 'warning', 'APP dépend de DB hébergée par SRV : conflit indirect');
  assert.equal(byTitle.D, undefined, 'fenêtres bout à bout : pas de chevauchement');
  assert.equal(byTitle.E, undefined, 'CI sans lien');
  assert.equal(found[0].level, 'conflict', 'les conflits directs d’abord');

  assert.throws(() => setCis(ctx(agent), a.id, []), /brouillon/, 'pas pendant l’évaluation du CAB');
  const draft = createChange(ctx(agent), { title: 'Brouillon' });
  setCis(ctx(agent), draft.id, [ci.app, ci.app]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ticket_cis WHERE ticket_id = ?').get(draft.id).n, 1);
  assert.throws(() => setCis(ctx(agent), draft.id, [99999]), /CI inconnu/);
});

test('API changements et calendrier', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const { m1, ci } = setup(app.db);
  addUser(app.db, { email: 'u@x.test', role: 'user' });
  const agent = app.client();
  await agent.login('ag@x.test');
  const user = app.client();
  await user.login('u@x.test');

  assert.equal((await user.get('/api/changes')).status, 403);
  const created = await agent.post('/api/changes', { title: 'Patch', ...plan, ci_ids: [ci.srv] });
  assert.equal(created.status, 201);
  assert.equal(created.body.risk_suggestion.risk, 'high', 'CI critique');
  assert.equal((await agent.patch(`/api/changes/${created.body.id}`, { state: 'assess' })).status, 400);
  const submitted = await agent.post(`/api/changes/${created.body.id}/submit`, { approver_ids: [m1.id] });
  assert.equal(submitted.body.state, 'assess');
  const other = await agent.post('/api/changes', { title: 'Autre', ...plan, ci_ids: [ci.srv] });
  await agent.post(`/api/changes/${other.body.id}/submit`, { approver_ids: [m1.id] });

  const cal = await agent.get('/api/changes/calendar?from=2026-03-01T00:00:00.000Z&to=2026-04-01T00:00:00.000Z');
  assert.equal(cal.body.items.length, 2);
  assert.equal(cal.body.items[0].conflicts[0].level, 'conflict');
  const live = await agent.get(`/api/changes/conflicts?ci_ids=${ci.srv}&start=2026-03-10T21:00:00.000Z&end=2026-03-10T21:30:00.000Z`);
  assert.equal(live.body.items.length, 2);
  assert.equal((await agent.get('/api/changes/calendar?from=2026-04-01T00:00:00.000Z&to=2026-03-01T00:00:00.000Z')).status, 400);
  const widget = await agent.get('/api/dashboard/widgets/changes_week');
  assert.equal(widget.body.available, true);
});
