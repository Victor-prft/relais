'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, addUser } = require('./helpers/app');

test('authentification et contrôle des rôles', async (t) => {
  const ctx = await startTestApp();
  t.after(() => ctx.close());
  addUser(ctx.db, { email: 'admin@x.test', role: 'admin' });
  addUser(ctx.db, { email: 'agent@x.test', role: 'agent' });
  addUser(ctx.db, { email: 'user@x.test', role: 'user' });

  await t.test('sans session, /api/auth/me répond 401', async () => {
    const res = await ctx.client().get('/api/auth/me');
    assert.equal(res.status, 401);
  });

  await t.test('mauvais mot de passe et compte inconnu : même réponse', async () => {
    const c = ctx.client();
    const wrong = await c.post('/api/auth/login', { email: 'agent@x.test', password: 'faux' });
    const unknown = await c.post('/api/auth/login', { email: 'personne@x.test', password: 'faux' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error.message, unknown.body.error.message);
  });

  await t.test('une requête qui modifie sans X-Requested-With est refusée', async () => {
    const res = await fetch(`${ctx.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'agent@x.test', password: 'x' })
    });
    assert.equal(res.status, 403);
  });

  await t.test('connexion puis /me ne renvoie jamais le hash', async () => {
    const c = ctx.client();
    await c.login('agent@x.test');
    const me = await c.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.role, 'agent');
    assert.equal(me.body.user.password_hash, undefined);
  });

  await t.test('rôles : admin réservé aux administrateurs', async () => {
    const user = ctx.client();
    await user.login('user@x.test');
    const agent = ctx.client();
    await agent.login('agent@x.test');
    const admin = ctx.client();
    await admin.login('admin@x.test');

    assert.equal((await user.get('/api/admin/users')).status, 403);
    assert.equal((await agent.get('/api/admin/users')).status, 403);
    assert.equal((await admin.get('/api/admin/users')).status, 200);
    assert.equal((await user.get('/api/groups')).status, 403);
    assert.equal((await agent.get('/api/groups')).status, 200);
  });

  await t.test('un utilisateur simple ne voit pas les emails des autres', async () => {
    const user = ctx.client();
    await user.login('user@x.test');
    const res = await user.get('/api/users?q=agent');
    assert.equal(res.status, 200);
    assert.ok(res.body.items.length >= 1);
    assert.equal(res.body.items[0].email, undefined);
  });

  await t.test('validation : un rôle inconnu est refusé', async () => {
    const admin = ctx.client();
    await admin.login('admin@x.test');
    const res = await admin.post('/api/admin/users', { email: 'n@x.test', full_name: 'N', password: '12345678', role: 'root' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.details.some((d) => d.path === 'role'));
  });

  await t.test('le dernier administrateur ne peut pas être rétrogradé', async () => {
    const admin = ctx.client();
    const me = await admin.login('admin@x.test');
    const res = await admin.patch(`/api/admin/users/${me.id}`, { role: 'agent' });
    assert.equal(res.status, 409);
  });

  await t.test('désactiver un compte coupe sa session', async () => {
    const victim = ctx.client();
    const v = await victim.login('agent@x.test');
    const admin = ctx.client();
    await admin.login('admin@x.test');
    assert.equal((await admin.patch(`/api/admin/users/${v.id}`, { is_active: false })).status, 200);
    assert.equal((await victim.get('/api/auth/me')).status, 401);
  });

  await t.test('healthcheck lit la base', async () => {
    const res = await ctx.client().get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });
});
