'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb, startTestApp, addUser, addGroup } = require('./helpers/app');
const { saveItem, orderItem } = require('../requests/catalog');
const { updateTicket, loadTicket } = require('../tickets/service');
const { decide } = require('../approvals/service');
const { tasksOf } = require('../requests/fulfillment');
const { ticketSlas } = require('../sla/engine');

function setup(db) {
  const mgr = addUser(db, { email: 'chef@x.test', role: 'manager', full_name: 'Cheffe' });
  const a1 = addUser(db, { email: 'a1@x.test', role: 'agent' });
  const u = addUser(db, { email: 'u@x.test', role: 'user', manager_id: mgr });
  const other = addUser(db, { email: 'o@x.test', role: 'user' });
  const sd = addGroup(db, 'SD', [a1]);
  const infra = addGroup(db, 'Infra', [a1]);
  const row = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const admin = { id: 0, role: 'admin', full_name: 'Admin' };
  const ctx = (user) => ({ db, user, now: new Date('2026-03-02T09:00:00Z') });
  const pc = saveItem(ctx(admin), null, {
    name: 'Nouveau PC',
    short_description: 'Un poste',
    requires_approval: true,
    form_schema: [
      { name: 'model', label: 'Modèle', type: 'select', options: ['Portable', 'Fixe'], required: true },
      { name: 'why', label: 'Justification', type: 'textarea', required: true }
    ],
    tasks: [
      { sequence: 1, title: 'Commander', assignment_group_id: sd },
      { sequence: 1, title: 'Créer le compte', assignment_group_id: infra },
      { sequence: 2, title: 'Livrer', assignment_group_id: sd }
    ]
  });
  const reset = saveItem(ctx(admin), null, {
    name: 'Réinitialisation',
    short_description: 'Mot de passe',
    requires_approval: false,
    form_schema: [{ name: 'app', label: 'Application', type: 'text', required: true }],
    tasks: [{ sequence: 1, title: 'Réinitialiser', assignment_group_id: sd }]
  });
  return { mgr: row(mgr), a1: row(a1), u: row(u), other: row(other), pc, reset, ctx };
}

test('catalogue et exécution des demandes', async (t) => {
  const db = createTestDb();
  const { mgr, a1, u, other, pc, reset, ctx } = setup(db);

  await t.test('formulaire validé contre le schéma de l’article', () => {
    assert.throws(() => orderItem(ctx(u), pc.id, { variables: { model: 'Tablette', why: 'x' } }), (e) => e.details.some((d) => d.path === 'model'));
    assert.throws(() => orderItem(ctx(u), pc.id, { variables: { model: 'Fixe' } }), (e) => e.details.some((d) => d.path === 'why'));
  });

  await t.test('sans approbation : en cours, tâches générées, SLA démarré', () => {
    const req = orderItem(ctx(u), reset.id, { variables: { app: 'ERP' } });
    assert.equal(req.number, 'REQ0001001');
    assert.equal(req.state, 'in_progress');
    assert.equal(req.approval_state, 'not_required');
    const tasks = tasksOf(db, req.id);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].number, 'TASK0001001');
    assert.equal(tasks[0].state, 'open');
    assert.equal(ticketSlas(db, req.id)[0].stage, 'running');
    updateTicket(ctx(a1), tasks[0].id, { state: 'closed_complete' });
    assert.equal(loadTicket(db, req.id).state, 'fulfilled', 'dernière tâche close → demande traitée');
    assert.equal(ticketSlas(db, req.id)[0].stage, 'completed');
  });

  let req;
  await t.test('avec approbation : en attente du manager du bénéficiaire, SLA en pause', () => {
    req = orderItem(ctx(u), pc.id, { variables: { model: 'Portable', why: 'Arrivée' } });
    assert.equal(req.state, 'pending_approval');
    assert.equal(req.approval_state, 'requested');
    assert.equal(tasksOf(db, req.id).length, 0);
    assert.equal(ticketSlas(db, req.id)[0].stage, 'paused');
    const ap = db.prepare('SELECT * FROM approvals WHERE ticket_id = ?').get(req.id);
    assert.equal(ap.approver_id, mgr.id);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'approval_requested'").get(mgr.id).n, 1);
  });

  await t.test('personne ne contourne l’approbation', () => {
    assert.throws(() => updateTicket(ctx(a1), req.id, { state: 'in_progress' }), /interdite/);
    const ap = db.prepare('SELECT id FROM approvals WHERE ticket_id = ?').get(req.id);
    assert.throws(() => decide(ctx(other), ap.id, 'approved'), /pas adressée/);
    assert.throws(() => decide(ctx(mgr), ap.id, 'rejected'), /motivé/);
  });

  await t.test('approuvée : tâches de la séquence 1 ouvertes, la 2 attend', () => {
    const ap = db.prepare('SELECT id FROM approvals WHERE ticket_id = ?').get(req.id);
    const { outcome } = decide(ctx(mgr), ap.id, 'approved', 'OK');
    assert.equal(outcome, 'approved');
    const fresh = loadTicket(db, req.id);
    assert.equal(fresh.state, 'in_progress');
    assert.equal(fresh.approval_state, 'approved');
    const tasks = tasksOf(db, req.id);
    assert.deepEqual(tasks.map((x) => x.state), ['open', 'open', 'pending']);
    assert.throws(() => decide(ctx(mgr), ap.id, 'approved'), /déjà été traitée/);
    assert.equal(ticketSlas(db, req.id)[0].stage, 'running', 'le SLA reprend après approbation');
  });

  await t.test('la séquence 2 s’ouvre quand la 1 est close, puis la demande est traitée', () => {
    const [t1, t2, t3] = tasksOf(db, req.id);
    updateTicket(ctx(a1), t1.id, { state: 'closed_complete' });
    assert.equal(loadTicket(db, t3.id).state, 'pending', 'une tâche de la séquence 1 reste ouverte');
    updateTicket(ctx(a1), t2.id, { state: 'closed_incomplete' });
    assert.equal(loadTicket(db, t3.id).state, 'open');
    assert.throws(() => updateTicket(ctx(a1), t3.id, { state: 'pending' }), /interdite/);
    updateTicket(ctx(a1), t3.id, { state: 'in_progress' });
    assert.equal(loadTicket(db, t3.id).assigned_to_id, a1.id, 'prise en charge = auto-assignation');
    updateTicket(ctx(a1), t3.id, { state: 'closed_complete' });
    assert.equal(loadTicket(db, req.id).state, 'fulfilled');
  });

  await t.test('prise en charge par un agent hors du groupe : refusée, rien n’est assigné', () => {
    // Régression : l'auto-assignation posait l'agent sans vérifier le groupe, et la mise à jour suivante échouait.
    const r = orderItem(ctx(u), reset.id, { variables: { app: 'GED' } });
    const [task] = tasksOf(db, r.id);
    const outsiderId = addUser(db, { email: 'out@x.test', role: 'agent' });
    const outsider = db.prepare('SELECT * FROM users WHERE id = ?').get(outsiderId);
    assert.throws(() => updateTicket(ctx(outsider), task.id, { state: 'in_progress' }), /pas membre du groupe/);
    assert.equal(loadTicket(db, task.id).assigned_to_id, null);
    updateTicket(ctx(a1), task.id, { state: 'in_progress' });
    assert.equal(updateTicket(ctx(a1), task.id, { state: 'closed_complete' }).state, 'closed_complete');
  });

  await t.test('rejetée : aucune tâche, demande close', () => {
    const r2 = orderItem(ctx(u), pc.id, { variables: { model: 'Fixe', why: 'Confort' } });
    const ap = db.prepare('SELECT id FROM approvals WHERE ticket_id = ?').get(r2.id);
    decide(ctx(mgr), ap.id, 'rejected', 'Budget épuisé');
    const fresh = loadTicket(db, r2.id);
    assert.equal(fresh.state, 'rejected');
    assert.equal(fresh.approval_state, 'rejected');
    assert.equal(tasksOf(db, r2.id).length, 0);
  });

  await t.test('annulation par le demandeur : les tâches ouvertes sont annulées', () => {
    const r3 = orderItem(ctx(u), reset.id, { variables: { app: 'CRM' } });
    updateTicket(ctx(u), r3.id, { state: 'canceled' });
    assert.ok(tasksOf(db, r3.id).every((x) => x.state === 'canceled'));
  });

  await t.test('commande pour un autre : approbation de son manager à lui', () => {
    const r4 = orderItem(ctx(other), pc.id, { requested_for_id: u.id, variables: { model: 'Fixe', why: 'Remplacement' } });
    assert.equal(r4.requested_for_id, u.id);
    assert.equal(db.prepare('SELECT approver_id FROM approvals WHERE ticket_id = ?').get(r4.id).approver_id, mgr.id);
  });
});

test('API catalogue, demandes, approbations', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const { pc } = setup(app.db);
  addUser(app.db, { email: 'admin@x.test', role: 'admin' });
  const user = app.client();
  await user.login('u@x.test');
  const other = app.client();
  await other.login('o@x.test');
  const chef = app.client();
  await chef.login('chef@x.test');
  const admin = app.client();
  await admin.login('admin@x.test');

  await t.test('commande via l’API et visibilité', async () => {
    const res = await user.post(`/api/catalog/items/${pc.id}/order`, { variables: { model: 'Portable', why: 'Arrivée' } });
    assert.equal(res.status, 201);
    assert.equal(res.body.state, 'pending_approval');
    assert.equal((await other.get(`/api/requests/${res.body.id}`)).status, 404);
    assert.equal((await chef.get(`/api/requests/${res.body.id}`)).status, 200, 'l’approbateur voit la demande');
    const portal = await user.get('/api/portal/tickets?open=1');
    assert.equal(portal.body.items[0].number, res.body.number);
  });

  await t.test('approbation via l’API', async () => {
    const pending = (await chef.get('/api/approvals')).body.items;
    assert.equal(pending.length, 1);
    assert.equal(pending[0].variables.model, 'Portable');
    assert.equal((await other.post(`/api/approvals/${pending[0].id}/decision`, { decision: 'approved' })).status, 403);
    const res = await chef.post(`/api/approvals/${pending[0].id}/decision`, { decision: 'approved', comment: 'Validé' });
    assert.equal(res.body.outcome, 'approved');
    const detail = (await chef.get(`/api/requests/${pending[0].ticket_id}`)).body;
    assert.equal(detail.tasks.length, 3);
    assert.equal(detail.approvals[0].state, 'approved');
  });

  await t.test('administration du catalogue', async () => {
    assert.equal((await user.post('/api/catalog/admin/items', {})).status, 403);
    const bad = await admin.post('/api/catalog/admin/items', { name: 'X', short_description: 'x', requires_approval: false, form_schema: [{ name: 'a', label: 'A', type: 'select' }] });
    assert.equal(bad.status, 400);
    const ok = await admin.post('/api/catalog/admin/items', { name: 'Souris', short_description: 'Une souris', requires_approval: false, form_schema: [] });
    assert.equal(ok.status, 201);
    assert.equal((await admin.post('/api/catalog/admin/items', { name: 'Souris', short_description: 'x', requires_approval: false, form_schema: [] })).status, 409);
  });
});
