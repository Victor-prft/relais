'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, addUser, addGroup, createTestDb } = require('./helpers/app');
const { createAiClient } = require('../ai/client');
const { createArticle } = require('../kb/service');
const { createTicket, updateTicket } = require('../tickets/service');
const { addEntry } = require('../tickets/journal');
const { createCi } = require('../cmdb/service');

/** Faux transport : renvoie la réponse programmée et garde les requêtes envoyées. */
function fakeTransport() {
  const calls = [];
  let next = () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 10, output_tokens: 5 } });
  const transport = async (params) => {
    calls.push(params);
    return next(params);
  };
  return {
    transport,
    calls,
    replyJson: (obj) => { next = () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 100, output_tokens: 50 } }); },
    replyRaw: (msg) => { next = () => msg; },
    fail: () => { next = () => { const e = new Error('boom'); e.status = 529; throw e; }; }
  };
}

test('fonctions IA', async (t) => {
  const fake = fakeTransport();
  const db = createTestDb();
  const ai = createAiClient({ model: 'claude-opus-5-5', transport: fake.transport });
  const app = await startTestApp(db, { ai });
  t.after(() => app.close());
  const agentId = addUser(db, { email: 'agent@x.test', role: 'agent' });
  addGroup(db, 'SD', [agentId]);
  addUser(db, { email: 'user@x.test', role: 'user' });
  const vpnCi = createCi({ db, user: null, now: new Date() }, { name: 'APP-VPN', class_id: db.prepare("SELECT id FROM ci_classes WHERE code = 'application'").get().id }).id;
  const user = app.client();
  await user.login('user@x.test');
  const agent = app.client();
  await agent.login('agent@x.test');
  const lastLog = () => db.prepare('SELECT * FROM ai_requests ORDER BY id DESC LIMIT 1').get();

  await t.test('tri : sortie structurée, repli serveur, saisie balisée comme donnée', async () => {
    fake.replyJson({ title: 'VPN refusé en télétravail', description: 'Connexion refusée', category_id: 11, impact: 3, urgency: 1, ci_id: vpnCi, confidence: 'high', rationale: 'Bloqué' });
    const res = await user.post('/api/ai/triage', { text: 'Mon VPN ne marche plus depuis ce matin, je suis bloquée chez moi' });
    assert.equal(res.body.available, true);
    assert.equal(res.body.suggestion.category_label, 'Réseau › VPN');
    assert.equal(res.body.suggestion.ci_name, 'APP-VPN');
    const sent = fake.calls.at(-1);
    assert.equal(sent.model, 'claude-opus-5-5');
    assert.equal(sent.fallbacks, 'default');
    assert.deepEqual(sent.betas, ['server-side-fallback-2026-07-01']);
    assert.equal(sent.output_config.format.type, 'json_schema');
    assert.equal(sent.output_config.effort, 'low');
    assert.match(sent.messages[0].content, /<saisie>\nMon VPN ne marche plus/);
    assert.equal(sent.tool_choice, undefined, 'pas de tool_choice forcé (refusé par Opus 5.5)');
    assert.equal(lastLog().status, 'ok');
    assert.equal(lastLog().input_tokens, 100);
  });

  await t.test('tri : un id inventé par le modèle est écarté', async () => {
    fake.replyJson({ title: 'Panne', description: 'x', category_id: 9999, impact: 2, urgency: 2, ci_id: 4242, confidence: 'low', rationale: '?' });
    const s = (await user.post('/api/ai/triage', { text: 'Quelque chose ne va pas du tout ici' })).body.suggestion;
    assert.equal(s.category_id, null);
    assert.equal(s.ci_id, null);
  });

  await t.test('tri : réponse hors schéma, refus, panne → indisponible, jamais une erreur', async () => {
    fake.replyJson({ title: 'x', impact: 7 });
    let res = await user.post('/api/ai/triage', { text: 'Le poste ne démarre plus du tout' });
    assert.equal(res.status, 200);
    assert.equal(res.body.available, false);
    assert.equal(lastLog().status, 'invalid');
    fake.replyRaw({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [], usage: {} });
    res = await user.post('/api/ai/triage', { text: 'Le poste ne démarre plus du tout' });
    assert.equal(res.body.available, false);
    assert.equal(lastLog().status, 'refused');
    fake.replyRaw({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'pas du JSON' }], usage: {} });
    assert.equal((await user.post('/api/ai/triage', { text: 'Le poste ne démarre plus du tout' })).body.available, false);
    fake.fail();
    res = await user.post('/api/ai/triage', { text: 'Le poste ne démarre plus du tout' });
    assert.equal(res.body.available, false);
    assert.equal(lastLog().status, 'error');
    assert.equal((await user.post('/api/ai/triage', { text: 'court' })).status, 400);
  });

  await t.test('suggestions : le modèle filtre les candidats de la recherche', async () => {
    const ctx = { db, user: null, now: new Date() };
    const a = createArticle(ctx, { title: 'VPN : connexion refusée', body: 'Certificat expiré', status: 'published' }).id;
    const b = createArticle(ctx, { title: 'VPN lent', body: 'Changer de serveur VPN', status: 'published' }).id;
    fake.replyJson({ article_ids: [b, 9999] });
    const res = await user.post('/api/ai/kb-suggest', { text: 'VPN connexion refusée' });
    assert.equal(res.body.source, 'ai');
    assert.deepEqual(res.body.items.map((i) => i.id), [b], 'id inconnu écarté');
    fake.fail();
    const fallback = await user.post('/api/ai/kb-suggest', { text: 'VPN connexion refusée' });
    assert.equal(fallback.body.source, 'search');
    assert.equal(fallback.body.items[0].id, a);
  });

  await t.test('résumé : réservé au support, fil long requis, mis en cache tant que le fil ne bouge pas', async () => {
    const agentRow = db.prepare('SELECT * FROM users WHERE id = ?').get(agentId);
    const ctx = { db, user: agentRow, now: new Date() };
    const inc = createTicket(ctx, 'incident', { title: 'Imprimante' });
    assert.equal((await agent.post(`/api/ai/tickets/${inc.id}/summary`)).status, 422);
    updateTicket(ctx, inc.id, { assigned_to_id: agentId, state: 'in_progress' });
    for (const body of ['Bonjour', 'Pilote réinstallé', 'Toujours en panne', 'Je regarde le câble']) addEntry(ctx, inc.id, { kind: 'comment', body });
    assert.equal((await user.post(`/api/ai/tickets/${inc.id}/summary`)).status, 403);
    fake.replyJson({ situation: 'En cours', done: ['Pilote réinstallé'], next_steps: ['Changer le câble'], waiting_on: 'support' });
    const before = fake.calls.length;
    const first = await agent.post(`/api/ai/tickets/${inc.id}/summary`);
    assert.equal(first.body.summary.cached, false);
    assert.match(fake.calls.at(-1).messages[0].content, /Pilote réinstallé/);
    const second = await agent.post(`/api/ai/tickets/${inc.id}/summary`);
    assert.equal(second.body.summary.cached, true);
    assert.equal(fake.calls.length, before + 1, 'pas de second appel');
    addEntry(ctx, inc.id, { kind: 'work_note', body: 'Câble changé' });
    assert.equal((await agent.post(`/api/ai/tickets/${inc.id}/summary`)).body.summary.cached, false);
  });
});

test('sans clé : IA désactivée proprement', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  addUser(app.db, { email: 'u@x.test', role: 'user' });
  const c = app.client();
  await c.login('u@x.test');
  assert.deepEqual((await c.get('/api/ai/status')).body, { enabled: false, model: null });
  const res = await c.post('/api/ai/triage', { text: 'Mon écran reste noir au démarrage' });
  assert.equal(res.body.available, false);
  assert.equal(app.db.prepare('SELECT status FROM ai_requests').get().status, 'disabled');
  assert.equal((await c.post('/api/ai/kb-suggest', { text: 'écran noir' })).body.source, 'search');
});
