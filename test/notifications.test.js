'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb, startTestApp, addUser, addGroup } = require('./helpers/app');
const { createTicket, updateTicket } = require('../tickets/service');
const { addEntry } = require('../tickets/journal');

function setup(db) {
  const a1 = addUser(db, { email: 'a1@x.test', role: 'agent' });
  const a2 = addUser(db, { email: 'a2@x.test', role: 'agent' });
  const mgr = addUser(db, { email: 'm@x.test', role: 'manager' });
  const u = addUser(db, { email: 'u@x.test', role: 'user' });
  const g = addGroup(db, 'SD', [a1, a2], mgr);
  const row = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return { a1: row(a1), a2: row(a2), mgr: row(mgr), u: row(u), g };
}

const notes = (db, userId) => db.prepare('SELECT type, title FROM notifications WHERE user_id = ? ORDER BY id').all(userId);

test('routage des notifications', async (t) => {
  const db = createTestDb();
  const { a1, a2, mgr, u, g } = setup(db);
  const ctx = (user) => ({ db, user, now: new Date() });

  const inc = createTicket(ctx(u), 'incident', { title: 'Écran', impact: 1, urgency: 2, assignment_group_id: g });

  await t.test('ticket sans agent : la file du groupe est prévenue, le manager si P1/P2', () => {
    assert.equal(notes(db, a1.id)[0].type, 'queue');
    assert.equal(notes(db, a2.id)[0].type, 'queue');
    assert.equal(notes(db, mgr.id).length, 1);
    assert.equal(notes(db, u.id).length, 0, 'le demandeur ne se notifie pas lui-même');
  });

  await t.test('assignation : seul l’agent assigné, jamais celui qui s’assigne', () => {
    updateTicket(ctx(a2), inc.id, { assigned_to_id: a1.id });
    assert.equal(notes(db, a1.id).at(-1).type, 'assigned');
    const before = notes(db, a2.id).length;
    updateTicket(ctx(a2), inc.id, { assigned_to_id: a2.id });
    assert.equal(notes(db, a2.id).length, before);
  });

  await t.test('commentaires : support → demandeur, demandeur → agent ; note interne → agent', () => {
    addEntry(ctx(a1), inc.id, { kind: 'comment', body: 'Bonjour' });
    assert.match(notes(db, u.id).at(-1).title, /message du support/);
    addEntry(ctx(u), inc.id, { kind: 'comment', body: 'Merci' });
    assert.match(notes(db, a2.id).at(-1).title, /Réponse du demandeur/);
    const userCount = notes(db, u.id).length;
    addEntry(ctx(a1), inc.id, { kind: 'work_note', body: 'interne' });
    assert.equal(notes(db, u.id).length, userCount, 'une note interne ne part jamais au demandeur');
    assert.match(notes(db, a2.id).at(-1).title, /Note interne/);
  });

  await t.test('résolution : le demandeur est prévenu', () => {
    updateTicket(ctx(a2), inc.id, { state: 'resolved', resolution_code: 'permanent_fix', resolution_notes: 'Câble' });
    assert.match(notes(db, u.id).at(-1).title, /est résolu/);
  });
});

test('API notifications : chacun ne voit que les siennes', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const { a1, u, g } = setup(app.db);
  createTicket({ db: app.db, user: u, now: new Date() }, 'incident', { title: 'x', assignment_group_id: g });
  const agent = app.client();
  await agent.login('a1@x.test');
  const user = app.client();
  await user.login('u@x.test');

  const list = await agent.get('/api/notifications');
  assert.equal(list.body.unread, 1);
  const id = list.body.items[0].id;
  assert.equal((await user.post(`/api/notifications/${id}/read`)).status, 404, 'notification d’un autre compte');
  assert.equal((await agent.post(`/api/notifications/${id}/read`)).body.unread, 0);
  assert.equal((await agent.get('/api/notifications/unread-count')).body.unread, 0);
  void a1;
});
