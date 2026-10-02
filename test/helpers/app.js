'use strict';

/**
 * Application de test : base en mémoire migrée, serveur sur un port libre,
 * client HTTP qui garde son cookie de session.
 */

process.env.NODE_ENV = 'test';

const { openDatabase } = require('../../db/index');
const { createApp } = require('../../server');
const { hashPasswordSync } = require('../../auth/passwords');

const PASSWORD = 'motdepasse-test';
let hash;

function createTestDb() {
  return openDatabase(':memory:');
}

/** Insère un compte de test ; renvoie son id. */
function addUser(db, { email, role = 'user', full_name, manager_id = null }) {
  hash ||= hashPasswordSync(PASSWORD);
  return Number(
    db
      .prepare('INSERT INTO users (email, password_hash, full_name, role, manager_id) VALUES (?, ?, ?, ?, ?)')
      .run(email, hash, full_name || email.split('@')[0], role, manager_id).lastInsertRowid
  );
}

function addGroup(db, name, memberIds = [], managerId = null) {
  const id = Number(db.prepare('INSERT INTO support_groups (name, manager_id) VALUES (?, ?)').run(name, managerId).lastInsertRowid);
  for (const m of memberIds) db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(id, m);
  return id;
}

async function startTestApp(db = createTestDb(), { ai = null } = {}) {
  const appConfig = {
    env: 'test',
    isProd: false,
    isTest: true,
    sessionSecret: 'test-secret',
    demoMode: false,
    anthropicApiKey: null,
    anthropicModel: 'test-model'
  };
  const app = createApp({ db, appConfig, ai });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  function client() {
    let cookie = null;
    const call = async (method, url, body) => {
      const headers = { 'X-Requested-With': 'relais', Accept: 'application/json' };
      if (cookie) headers.Cookie = cookie;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      return { status: res.status, body: json, headers: res.headers };
    };
    return {
      get: (url) => call('GET', url),
      post: (url, body = {}) => call('POST', url, body),
      patch: (url, body = {}) => call('PATCH', url, body),
      put: (url, body = {}) => call('PUT', url, body),
      del: (url) => call('DELETE', url),
      raw: call,
      async login(email, password = PASSWORD) {
        const res = await call('POST', '/api/auth/login', { email, password });
        if (res.status !== 200) throw new Error(`login ${email} : ${res.status} ${JSON.stringify(res.body)}`);
        return res.body.user;
      }
    };
  }

  return {
    db,
    app,
    base,
    client,
    close: () =>
      new Promise((resolve) => {
        app.locals.deps.sessionStore.close();
        server.close(resolve);
      })
  };
}

module.exports = { createTestDb, startTestApp, addUser, addGroup, PASSWORD };
