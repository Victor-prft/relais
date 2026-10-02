'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, addUser, addGroup } = require('./helpers/app');
const { createTicket, updateTicket } = require('../tickets/service');
const { WIDGETS } = require('../dashboard/widgets');

test('tableau de bord', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const agentId = addUser(app.db, { email: 'agent@x.test', role: 'agent' });
  const managerId = addUser(app.db, { email: 'chef@x.test', role: 'manager' });
  addUser(app.db, { email: 'user@x.test', role: 'user' });
  const g = addGroup(app.db, 'SD', [agentId], managerId);
  const agentRow = app.db.prepare('SELECT * FROM users WHERE id = ?').get(agentId);
  const ctx = { db: app.db, user: agentRow, now: new Date() };
  const a = createTicket(ctx, 'incident', { title: 'A', impact: 1, urgency: 1, assignment_group_id: g });
  createTicket(ctx, 'incident', { title: 'B', category_id: 2, assignment_group_id: g });
  updateTicket(ctx, a.id, { assigned_to_id: agentId, state: 'in_progress' });

  const agent = app.client();
  await agent.login('agent@x.test');
  const manager = app.client();
  await manager.login('chef@x.test');
  const user = app.client();
  await user.login('user@x.test');

  await t.test('réservé au support', async () => {
    assert.equal((await user.get('/api/dashboard/layout')).status, 403);
  });

  await t.test('disposition par défaut selon le rôle', async () => {
    const la = (await agent.get('/api/dashboard/layout')).body;
    const lm = (await manager.get('/api/dashboard/layout')).body;
    assert.equal(la.custom, false);
    assert.ok(la.layout.some((w) => w.id === 'my_open'));
    assert.equal(lm.layout[1].id, 'pending_approvals');
  });

  await t.test('disposition enregistrée par utilisateur, réinitialisable', async () => {
    const layout = [{ id: 'sla_risk', x: 0, y: 0, w: 12, h: 4 }];
    assert.equal((await agent.put('/api/dashboard/layout', { layout })).status, 200);
    assert.deepEqual((await agent.get('/api/dashboard/layout')).body.layout, layout);
    assert.notDeepEqual((await manager.get('/api/dashboard/layout')).body.layout, layout);
    await agent.del('/api/dashboard/layout');
    assert.equal((await agent.get('/api/dashboard/layout')).body.custom, false);
  });

  await t.test('widget inconnu, doublon ou position hors grille refusés', async () => {
    assert.equal((await agent.put('/api/dashboard/layout', { layout: [{ id: 'pirate', x: 0, y: 0, w: 1, h: 1 }] })).status, 403);
    const dup = [{ id: 'kpis', x: 0, y: 0, w: 12, h: 2 }, { id: 'kpis', x: 0, y: 2, w: 12, h: 2 }];
    assert.equal((await agent.put('/api/dashboard/layout', { layout: dup })).status, 400);
    assert.equal((await agent.put('/api/dashboard/layout', { layout: [{ id: 'kpis', x: 14, y: 0, w: 12, h: 2 }] })).status, 400);
    assert.equal((await agent.get('/api/dashboard/widgets/pirate')).status, 404);
  });

  await t.test('chaque widget répond', async () => {
    for (const id of Object.keys(WIDGETS)) {
      const res = await manager.get(`/api/dashboard/widgets/${id}`);
      assert.equal(res.status, 200, id);
    }
  });

  await t.test('données : mes tickets, file, indicateurs, courbe 30 jours', async () => {
    const mine = (await agent.get('/api/dashboard/widgets/my_open')).body;
    assert.equal(mine.counts[1], 1);
    const queue = (await agent.get('/api/dashboard/widgets/group_queue')).body;
    assert.equal(queue.total, 2);
    assert.equal(queue.unassigned, 1);
    assert.equal(queue.items[0].title, 'B', 'les non assignés d’abord');
    const kpis = (await agent.get('/api/dashboard/widgets/kpis')).body;
    assert.equal(kpis.open, 2);
    assert.equal(kpis.critical, 1);
    const daily = (await agent.get('/api/dashboard/widgets/incidents_daily')).body;
    assert.equal(daily.days.length, 30);
    assert.equal(daily.opened.at(-1), 2);
  });
});
