'use strict';

const session = require('express-session');

/**
 * Store express-session adossé à la table `sessions` de la base principale.
 * Une poignée de requêtes préparées suffit : pas besoin d'une dépendance de plus.
 */
class SqliteSessionStore extends session.Store {
  constructor(db, { ttlMs = 1000 * 60 * 60 * 24 * 7, cleanupIntervalMs = 1000 * 60 * 15 } = {}) {
    super();
    this.ttlMs = ttlMs;
    this.stmts = {
      get: db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires_at > ?'),
      set: db.prepare(
        `INSERT INTO sessions (sid, sess, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires_at = excluded.expires_at`
      ),
      touch: db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?'),
      destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      destroyUser: db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?"),
      cleanup: db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
    };
    this.timer = setInterval(() => this.stmts.cleanup.run(Date.now()), cleanupIntervalMs);
    this.timer.unref();
  }

  expiry(sess) {
    const cookieExpiry = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : null;
    return cookieExpiry || Date.now() + this.ttlMs;
  }

  get(sid, cb) {
    try {
      const row = this.stmts.get.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb = () => {}) {
    try {
      this.stmts.set.run(sid, JSON.stringify(sess), this.expiry(sess));
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  touch(sid, sess, cb = () => {}) {
    try {
      this.stmts.touch.run(this.expiry(sess), sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  destroy(sid, cb = () => {}) {
    try {
      this.stmts.destroy.run(sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  /** Coupe toutes les sessions d'un compte (désactivation, changement de rôle). */
  destroyUserSessions(userId) {
    this.stmts.destroyUser.run(userId);
  }

  close() {
    clearInterval(this.timer);
  }
}

module.exports = { SqliteSessionStore };
