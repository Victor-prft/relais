'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, addUser, addGroup } = require('./helpers/app');

test('API incidents', async (t) => {
  const ctx = await startTestApp();
  t.after(() => ctx.close());
  const agentId = addUser(ctx.db, { email: 'agent@x.test', role: 'agent' });
  addUser(ctx.db, { email: 'lea@x.test', role: 'user' });
  addUser(ctx.db, { email: 'marc@x.test', role: 'user' });
  const sd = addGroup(ctx.db, 'Service Desk', [agentId]);
  ctx.db.prepare('UPDATE categories SET default_group_id = ? WHERE id = 1').run(sd);

  const lea = ctx.client();
  await lea.login('lea@x.test');
  const marc = ctx.client();
  await marc.login('marc@x.test');
  const agent = ctx.client();
  await agent.login('agent@x.test');

  let incident;

  await t.test('un utilisateur crée un incident : demandeur forcé, routage par catégorie', async () => {
    const res = await lea.post('/api/incidents', { title: 'Imprimante bloquée', category_id: 3, impact: 3, urgency: 2, requester_id: 999, assigned_to_id: agentId });
    assert.equal(res.status, 201);
    incident = res.body;
    assert.equal(incident.requester_email, 'lea@x.test');
    assert.equal(incident.assignment_group_id, sd, 'groupe par défaut de la catégorie parente');
    assert.equal(incident.assigned_to_id, null, 'un utilisateur ne choisit pas l’agent');
    assert.equal(incident.priority, 4);
  });

  await t.test('un autre utilisateur ne le voit pas (404) ni dans sa liste', async () => {
    assert.equal((await marc.get(`/api/incidents/${incident.id}`)).status, 404);
    assert.equal((await marc.get(`/api/tickets/${incident.id}/activity`)).status, 404);
    const list = await marc.get('/api/incidents');
    assert.equal(list.body.total, 0);
  });

  await t.test('l’agent le voit et l’assigne avec la version', async () => {
    const res = await agent.patch(`/api/incidents/${incident.id}`, { assigned_to_id: agentId, version: incident.version });
    assert.equal(res.status, 200);
    assert.equal(res.body.state, 'assigned');
    const stale = await agent.patch(`/api/incidents/${incident.id}`, { title: 'x', version: incident.version });
    assert.equal(stale.status, 409);
  });

  await t.test('le demandeur ne peut changer que l’état', async () => {
    const res = await lea.patch(`/api/incidents/${incident.id}`, { title: 'Pirate' });
    assert.equal(res.status, 400);
  });

  await t.test('liste : filtres, tri, recherche, pagination', async () => {
    for (let i = 0; i < 5; i += 1) await agent.post('/api/incidents', { title: `Panne VPN ${i}`, category_id: 11, impact: 1, urgency: i % 3 + 1 });
    const filters = encodeURIComponent(JSON.stringify([{ field: 'priority', op: 'in', value: [1, 2] }, { field: 'active', op: 'eq', value: true }]));
    const res = await agent.get(`/api/incidents?filters=${filters}&sort=priority&dir=asc&pageSize=2`);
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 4);
    assert.equal(res.body.items.length, 2);
    assert.equal(res.body.items[0].priority, 1);
    const search = await agent.get('/api/incidents?q=Imprimante');
    assert.equal(search.body.total, 1);
  });

  await t.test('liste : un champ ou un tri inconnu ne passe jamais dans le SQL', async () => {
    const bad = encodeURIComponent(JSON.stringify([{ field: 't.id; DROP TABLE tickets', op: 'eq', value: 1 }]));
    assert.equal((await agent.get(`/api/incidents?filters=${bad}`)).status, 400);
    const sorted = await agent.get('/api/incidents?sort=id%3B%20DROP%20TABLE%20tickets');
    assert.equal(sorted.status, 200, 'tri inconnu : on retombe sur le tri par défaut');
    const injection = encodeURIComponent(JSON.stringify([{ field: 'title', op: 'contains', value: "' OR 1=1 --" }]));
    assert.equal((await agent.get(`/api/incidents?filters=${injection}`)).body.total, 0);
  });

  await t.test('symboles @me et @mygroups', async () => {
    const mine = encodeURIComponent(JSON.stringify([{ field: 'assigned_to_id', op: 'eq', value: '@me' }]));
    assert.equal((await agent.get(`/api/incidents?filters=${mine}`)).body.total, 1);
    const groups = encodeURIComponent(JSON.stringify([{ field: 'assignment_group_id', op: 'in', value: '@mygroups' }]));
    assert.ok((await agent.get(`/api/incidents?filters=${groups}`)).body.total >= 1);
  });

  await t.test('journal : commentaire du demandeur, note interne invisible pour lui', async () => {
    assert.equal((await agent.post(`/api/tickets/${incident.id}/journal`, { kind: 'work_note', body: 'Vérifier le pilote' })).status, 201);
    assert.equal((await lea.post(`/api/tickets/${incident.id}/journal`, { kind: 'comment', body: 'Merci !' })).status, 201);
    assert.equal((await lea.post(`/api/tickets/${incident.id}/journal`, { kind: 'work_note', body: 'x' })).status, 403);
    const activity = await lea.get(`/api/tickets/${incident.id}/activity`);
    assert.ok(activity.body.items.some((e) => e.body === 'Merci !'));
    assert.ok(!activity.body.items.some((e) => e.type === 'work_note'));
  });

  await t.test('recherche par numéro', async () => {
    const res = await agent.get(`/api/tickets/by-number/${incident.number}`);
    assert.equal(res.body.id, incident.id);
    assert.equal((await marc.get(`/api/tickets/by-number/${incident.number}`)).status, 404);
  });

  await t.test('liens entre tickets', async () => {
    const other = (await agent.post('/api/incidents', { title: 'Imprimante 2e étage' })).body;
    assert.equal((await agent.post(`/api/tickets/${other.id}/relations`, { number: incident.number, kind: 'duplicate_of' })).status, 201);
    const rel = await agent.get(`/api/tickets/${incident.id}/relations`);
    assert.equal(rel.body.items[0].direction, 'in');
    assert.equal((await lea.post(`/api/tickets/${incident.id}/relations`, { number: other.number, kind: 'related' })).status, 403);
  });

  await t.test('vues enregistrées par utilisateur', async () => {
    const query = { filters: [{ field: 'priority', op: 'eq', value: 1 }] };
    assert.equal((await agent.post('/api/lists/incidents/filters', { name: 'P1', query })).status, 201);
    assert.equal((await agent.post('/api/lists/incidents/filters', { name: 'P1', query })).status, 409);
    const prefs = await agent.get('/api/lists/incidents');
    assert.equal(prefs.body.filters[0].name, 'P1');
    assert.equal((await lea.get('/api/lists/incidents')).body.filters.length, 0);
  });
});
