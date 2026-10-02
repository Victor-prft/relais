'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb, startTestApp, addUser, addGroup } = require('./helpers/app');
const { createArticle, updateArticle, draftFromTicket } = require('../kb/service');
const { searchArticles, buildFtsQuery } = require('../kb/search');
const { createTicket, updateTicket } = require('../tickets/service');

function seedArticles(db) {
  const ctx = { db, user: null, now: new Date('2026-03-01T10:00:00Z') };
  const vpn = createArticle(ctx, { title: 'Le VPN refuse la connexion', body: 'Vérifiez le certificat et la sécurité du poste. Redémarrez le client VPN.', status: 'published' });
  const mail = createArticle(ctx, { title: 'Outlook ne synchronise plus', body: 'Recréez le profil de messagerie.', status: 'published' });
  const draft = createArticle(ctx, { title: 'Brouillon VPN interne', body: 'procédure interne', status: 'draft' });
  return { vpn, mail, draft, ctx };
}

test('recherche plein texte', async (t) => {
  const db = createTestDb();
  const { vpn, ctx } = seedArticles(db);

  await t.test('numérotation KB et indexation à la création', () => {
    assert.equal(vpn.number, 'KB0001001');
    assert.equal(searchArticles(db, 'connexion')[0].id, vpn.id);
  });

  await t.test('sans accents, préfixes, extrait surligné', () => {
    const hits = searchArticles(db, 'securite certif');
    assert.equal(hits[0].id, vpn.id);
    assert.match(hits[0].excerpt, /\[\[sécurité\]\]/);
  });

  await t.test('le brouillon n’apparaît pas dans la recherche publique', () => {
    assert.equal(searchArticles(db, 'interne').length, 0);
    assert.equal(searchArticles(db, 'interne', { publishedOnly: false }).length, 1);
  });

  await t.test('mode « ou » pour les suggestions, mots vides ignorés', () => {
    assert.equal(searchArticles(db, 'mon outlook et le vpn', { mode: 'and' }).length, 0);
    assert.equal(searchArticles(db, 'mon outlook et le vpn', { mode: 'or' }).length, 2);
  });

  await t.test('la syntaxe FTS de l’utilisateur est neutralisée', () => {
    for (const evil of ['"', 'vpn OR', 'NEAR(a b)', 'title:vpn', '*', 'a" OR "1', '-vpn', '()']) {
      assert.doesNotThrow(() => searchArticles(db, evil), evil);
    }
    assert.equal(buildFtsQuery('!!! ???'), null);
    assert.equal(buildFtsQuery('VPN cassé'), '"vpn"* "cassé"*');
  });

  await t.test('la modification réindexe', () => {
    updateArticle(ctx, vpn.id, { title: 'Accès distant impossible' });
    assert.equal(searchArticles(db, 'distant')[0].id, vpn.id);
    assert.equal(searchArticles(db, 'certificat').length, 1, 'le corps reste indexé');
    assert.equal(searchArticles(db, 'connexion refuse').length, 0, 'l’ancien titre est sorti de l’index');
  });

  await t.test('un article publié doit avoir un contenu', () => {
    const empty = createArticle(ctx, { title: 'Vide', body: '' });
    assert.throws(() => updateArticle(ctx, empty.id, { status: 'published' }), /contenu/);
  });
});

test('article depuis un incident résolu', () => {
  const db = createTestDb();
  const agentId = addUser(db, { email: 'a@x.test', role: 'agent' });
  addGroup(db, 'SD', [agentId]);
  const agent = db.prepare('SELECT * FROM users WHERE id = ?').get(agentId);
  db.prepare("INSERT INTO categories (name, scope) VALUES ('VPN', 'kb')").run();
  const ctx = { db, user: agent, now: new Date() };
  const inc = createTicket(ctx, 'incident', { title: 'VPN coupé', description: 'Coupure toutes les 10 minutes', category_id: 11 });
  assert.throws(() => draftFromTicket(db, inc.id), /résolu/);
  updateTicket(ctx, inc.id, { state: 'resolved', resolution_code: 'permanent_fix', resolution_notes: 'Délai d’inactivité corrigé' });
  const draft = draftFromTicket(db, inc.id);
  assert.equal(draft.title, 'VPN coupé');
  assert.match(draft.body, /## Symptômes\n\nCoupure toutes les 10 minutes/);
  assert.match(draft.body, /## Résolution\n\nDélai d’inactivité corrigé/);
  assert.ok(draft.category_id, 'catégorie KB de même nom que la sous-catégorie');
  assert.equal(draft.source_ticket_id, inc.id);
});

test('API base de connaissances', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const { draft } = seedArticles(app.db);
  addUser(app.db, { email: 'agent@x.test', role: 'agent' });
  addUser(app.db, { email: 'user@x.test', role: 'user' });
  const agent = app.client();
  await agent.login('agent@x.test');
  const user = app.client();
  await user.login('user@x.test');

  await t.test('un utilisateur ne lit que le publié, même en le demandant', async () => {
    assert.equal((await user.get(`/api/kb/${draft.id}`)).status, 404);
    assert.equal((await user.get('/api/kb?status=draft')).body.items.every((a) => a.status === 'published'), true);
    assert.equal((await agent.get(`/api/kb/${draft.id}`)).status, 200);
  });

  await t.test('lecture comptée, écriture réservée au support', async () => {
    const list = await user.get('/api/kb?q=outlook');
    const id = list.body.items[0].id;
    await user.get(`/api/kb/${id}`);
    assert.equal((await user.get(`/api/kb/${id}`)).body.view_count, 1);
    assert.equal((await user.post('/api/kb', { title: 'x', body: 'y' })).status, 403);
    const created = await agent.post('/api/kb', { title: 'Imprimante', body: 'Redémarrer le spouleur.', status: 'published' });
    assert.equal(created.status, 201);
    assert.equal((await user.get('/api/kb?q=spouleur')).body.items.length, 1);
  });
});
