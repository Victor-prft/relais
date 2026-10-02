'use strict';

const { unauthorized, forbidden, HttpError } = require('../lib/http-errors');
const { hasRole } = require('./roles');

const PUBLIC_USER_COLUMNS = 'id, email, full_name, role, manager_id, department, phone, preferences, is_active';

/**
 * Charge le compte de la session et pose le contexte de requête `req.ctx`
 * ({ db, user, now }) que reçoivent tous les services métier.
 */
function loadUser(db) {
  const stmt = db.prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ? AND is_active = 1`);
  return (req, _res, next) => {
    let user = null;
    if (req.session?.userId) {
      const row = stmt.get(req.session.userId);
      if (row) user = { ...row, preferences: JSON.parse(row.preferences || '{}') };
      else req.session.userId = null;
    }
    req.user = user;
    req.ctx = { db, user, now: new Date() };
    next();
  };
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

/** Rôle minimal exigé. Toute route /api hors auth déclare le sien. */
function requireRole(minimum) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!hasRole(req.user, minimum)) return next(forbidden());
    next();
  };
}

/**
 * Parade CSRF : toute requête qui modifie quelque chose doit porter l'en-tête
 * X-Requested-With, qu'un formulaire d'un autre site ne peut pas poser sans
 * déclencher un preflight CORS (que l'on ne sert pas).
 */
function requireAjaxHeader(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'relais') {
    return next(new HttpError(403, 'csrf', 'En-tête X-Requested-With manquant'));
  }
  next();
}

module.exports = { loadUser, requireAuth, requireRole, requireAjaxHeader, PUBLIC_USER_COLUMNS };
