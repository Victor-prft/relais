'use strict';

const { HttpError } = require('./http-errors');

/**
 * Limiteur en mémoire à fenêtre fixe. Suffisant pour une seule instance
 * (Railway, numReplicas = 1) ; à remplacer si l'on passe à plusieurs.
 */
function rateLimit({ windowMs, max, key = (req) => req.ip, message = 'Trop de tentatives, réessayez plus tard' }) {
  const hits = new Map();

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of hits) if (entry.resetAt <= now) hits.delete(k);
  }, windowMs);
  timer.unref();

  const middleware = (req, res, next) => {
    const now = Date.now();
    const k = key(req);
    let entry = hits.get(k);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(k, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return next(new HttpError(429, 'rate_limited', message));
    }
    next();
  };
  middleware.reset = () => hits.clear();
  return middleware;
}

module.exports = { rateLimit };
