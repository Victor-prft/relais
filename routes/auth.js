'use strict';

const express = require('express');
const { z, body } = require('../lib/validate');
const { unauthorized, badRequest } = require('../lib/http-errors');
const { verifyPassword } = require('../auth/passwords');
const { requireAuth } = require('../auth/middleware');
const { getUser, setPreferences, updateUser } = require('../auth/users');
const { rateLimit } = require('../lib/rate-limit');

module.exports = function authRoutes({ db, config }) {
  const router = express.Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.isTest ? 1000 : 10,
    key: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`
  });

  const findByEmail = db.prepare('SELECT id, password_hash, is_active FROM users WHERE email = ?');
  const touchLogin = db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?');

  router.post(
    '/login',
    loginLimiter,
    body(z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) })),
    async (req, res, next) => {
      try {
        const row = findByEmail.get(req.body.email);
        const ok = await verifyPassword(req.body.password, row?.password_hash);
        // Même message que le compte existe ou non : pas d'énumération.
        if (!row || !ok || !row.is_active) throw unauthorized('Email ou mot de passe incorrect');

        req.session.regenerate((err) => {
          if (err) return next(err);
          req.session.userId = row.id;
          touchLogin.run(new Date().toISOString(), row.id);
          res.json({ user: getUser(db, row.id) });
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post('/logout', (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('relais.sid');
      res.json({ ok: true });
    });
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: getUser(db, req.user.id) });
  });

  router.patch(
    '/me/preferences',
    requireAuth,
    body(z.object({ theme: z.enum(['light', 'dark', 'system']).optional() }).strict()),
    (req, res) => {
      res.json({ preferences: setPreferences(db, req.user.id, req.body) });
    }
  );

  router.post(
    '/me/password',
    requireAuth,
    body(z.object({ current: z.string().min(1).max(200), password: z.string().min(8).max(200) })),
    async (req, res, next) => {
      try {
        const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
        if (!(await verifyPassword(req.body.current, row.password_hash))) {
          throw badRequest('Mot de passe actuel incorrect');
        }
        await updateUser(db, req.user.id, { password: req.body.password });
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    }
  );

  // Comptes de démo affichés sur la page de connexion quand DEMO_MODE est actif.
  router.get('/demo-accounts', (_req, res) => {
    if (!config.demoMode) return res.json({ accounts: [] });
    const accounts = db
      .prepare(
        `SELECT email, full_name, role FROM users
          WHERE is_active = 1 AND email LIKE '%@relais.test'
          ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 WHEN 'agent' THEN 2 ELSE 3 END, full_name`
      )
      .all();
    res.json({ accounts, password: accounts.length ? 'relais2026' : null });
  });

  return router;
};
