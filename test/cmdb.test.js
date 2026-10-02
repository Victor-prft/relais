'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb, startTestApp, addUser } = require('./helpers/app');
const { createCi, addRelation, updateCi } = require('../cmdb/service');
const { neighborhood, impactOf } = require('../cmdb/graph');
const { validateValues, parseFormSchema } = require('../lib/form-schema');
const { createTicket } = require('../tickets/service');

const cls = (db, code) => db.prepare('SELECT id FROM ci_classes WHERE code = ?').get(code).id;

function buildCmdb(db) {
  const ctx = { db, user: null, now: new Date('2026-05-01T08:00:00Z') };
  const mk = (name, code, attributes = {}) => createCi(ctx, { name, class_id: cls(db, code), attributes }).id;
  const ids = {
    rtr: mk('RTR', 'network'),
    sw: mk('SW', 'network'),
    srv: mk('SRV', 'server', { os: 'Linux' }),
    db: mk('DB', 'database', { engine: 'PostgreSQL' }),
    app: mk('APP', 'application'),
    front: mk('FRONT', 'application'),
    lonely: mk('SEUL', 'application')
  };
  addRelation(ctx, ids.sw, ids.rtr, 'connects_to');
  addRelation(ctx, ids.srv, ids.sw, 'connects_to');
  addRelation(ctx, ids.srv, ids.db, 'hosts');
  addRelation(ctx, ids.app, ids.db, 'depends_on');
  addRelation(ctx, ids.front, ids.app, 'depends_on');
  return { ctx, ids };
}

test('formulaires dynamiques', async (t) => {
  const schema = parseFormSchema([
    { name: 'os', label: 'OS', type: 'text', required: true },
    { name: 'ram', label: 'RAM', type: 'number', min: 1, max: 512 },
    { name: 'engine', label: 'Moteur', type: 'select', options: ['A', 'B'] },
    { name: 'virtual', label: 'VM', type: 'checkbox' }
  ]);

  await t.test('valeurs valides normalisées, champs inconnus retirés', () => {
    const out = validateValues(schema, { os: ' Linux ', ram: '16', engine: 'A', pirate: 'x' });
    assert.deepEqual(out, { os: 'Linux', ram: 16, engine: 'A', virtual: false });
  });

  await t.test('obligatoire, bornes, liste fermée', () => {
    assert.throws(() => validateValues(schema, { ram: 4 }), (e) => e.details.some((d) => d.path === 'os'));
    assert.throws(() => validateValues(schema, { os: 'x', ram: 9999 }), (e) => e.details.some((d) => d.path === 'ram'));
    assert.throws(() => validateValues(schema, { os: 'x', engine: 'Z' }), (e) => e.details.some((d) => d.path === 'engine'));
  });

  await t.test('schéma mal formé refusé', () => {
    assert.throws(() => parseFormSchema([{ name: 'a', label: 'A', type: 'select' }]), /Schéma/);
    assert.throws(() => parseFormSchema([{ name: 'Bad Name', label: 'A', type: 'text' }]), /Schéma/);
    assert.throws(() => parseFormSchema([{ name: 'a', label: 'A', type: 'text' }, { name: 'a', label: 'B', type: 'text' }]), /Schéma/);
  });
});

test('CMDB : attributs, relations, impact', async (t) => {
  const db = createTestDb();
  const { ctx, ids } = buildCmdb(db);

  await t.test('les attributs suivent le schéma de la classe', () => {
    assert.throws(() => createCi(ctx, { name: 'X', class_id: cls(db, 'database'), attributes: {} }), /invalide/);
    assert.throws(() => createCi(ctx, { name: 'SRV', class_id: cls(db, 'server'), attributes: { os: 'x' } }), /déjà ce nom/);
  });

  await t.test('relations : ni soi-même, ni doublon, ni hébergement réciproque', () => {
    assert.throws(() => addRelation(ctx, ids.app, ids.app, 'depends_on'), /lui-même/);
    assert.throws(() => addRelation(ctx, ids.app, ids.db, 'depends_on'), /existe déjà/);
    assert.throws(() => addRelation(ctx, ids.db, ids.srv, 'hosts'), /héberge déjà/);
  });

  await t.test('impact : la panne remonte les dépendances et descend l’hébergement', () => {
    const names = (rows) => rows.map((r) => r.name).sort();
    assert.deepEqual(names(impactOf(db, ids.db)), ['APP', 'FRONT']);
    assert.deepEqual(names(impactOf(db, ids.srv)), ['APP', 'DB', 'FRONT']);
    assert.deepEqual(names(impactOf(db, ids.rtr)), ['APP', 'DB', 'FRONT', 'SRV', 'SW']);
    assert.deepEqual(impactOf(db, ids.front), []);
    const depth = Object.fromEntries(impactOf(db, ids.srv).map((r) => [r.name, r.depth]));
    assert.deepEqual(depth, { DB: 1, APP: 2, FRONT: 3 });
  });

  await t.test('une boucle de dépendances ne fait pas tourner la requête sans fin', () => {
    addRelation(ctx, ids.db, ids.front, 'depends_on');
    const rows = impactOf(db, ids.db);
    assert.ok(rows.length <= 3);
  });

  await t.test('voisinage borné en profondeur', () => {
    const g1 = neighborhood(db, ids.srv, 1);
    assert.deepEqual(g1.nodes.map((n) => n.name).sort(), ['DB', 'SRV', 'SW']);
    assert.ok(g1.nodes.find((n) => n.name === 'SRV').root);
    assert.ok(g1.edges.every((e) => g1.nodes.some((n) => n.id === e.source) && g1.nodes.some((n) => n.id === e.target)));
    const g2 = neighborhood(db, ids.srv, 2);
    assert.ok(g2.nodes.some((n) => n.name === 'RTR'));
    assert.deepEqual(neighborhood(db, ids.lonely, 2).edges, []);
  });

  await t.test('l’audit garde les changements de CI', () => {
    updateCi({ ...ctx, now: new Date('2026-05-02T08:00:00Z') }, ids.srv, { status: 'maintenance' });
    const row = db.prepare("SELECT * FROM audit_entries WHERE entity = 'ci' AND entity_id = ? AND field = 'status'").get(ids.srv);
    assert.equal(row.old_display, 'En service');
    assert.equal(row.new_display, 'En maintenance');
  });
});

test('API CMDB', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const { ids } = buildCmdb(app.db);
  addUser(app.db, { email: 'agent@x.test', role: 'agent' });
  addUser(app.db, { email: 'user@x.test', role: 'user' });
  const agent = app.client();
  await agent.login('agent@x.test');
  const user = app.client();
  await user.login('user@x.test');

  await t.test('réservée au support', async () => {
    assert.equal((await user.get('/api/cis')).status, 403);
    assert.equal((await user.get(`/api/cis/${ids.srv}`)).status, 403);
  });

  await t.test('liste, fiche, graphe, impact', async () => {
    const list = await agent.get('/api/cis?q=SR');
    assert.equal(list.body.items[0].name, 'SRV');
    const ci = await agent.get(`/api/cis/${ids.srv}`);
    assert.equal(ci.body.relations.length, 2);
    assert.ok((await agent.get(`/api/cis/${ids.srv}/graph?depth=2`)).body.nodes.length >= 4);
    assert.equal((await agent.get(`/api/cis/${ids.db}/impact`)).body.items.length, 2);
  });

  await t.test('incidents liés à un CI', async () => {
    const agentRow = app.db.prepare("SELECT * FROM users WHERE email = 'agent@x.test'").get();
    createTicket({ db: app.db, user: agentRow, now: new Date() }, 'incident', { title: 'DB lente', ci_id: ids.db });
    const res = await agent.get(`/api/cis/${ids.db}/tickets?type=incident`);
    assert.equal(res.body.items.length, 1);
    const filters = encodeURIComponent(JSON.stringify([{ field: 'ci_id', op: 'eq', value: ids.db }]));
    assert.equal((await agent.get(`/api/incidents?filters=${filters}`)).body.total, 1);
  });

  await t.test('un CI inexistant sur un incident → 400', async () => {
    const res = await agent.post('/api/incidents', { title: 'x', ci_id: 99999 });
    assert.equal(res.status, 400);
  });
});
