'use strict';

const { hashPassword } = require('./passwords');
const { conflict, notFound, badRequest } = require('../lib/http-errors');
const { PUBLIC_USER_COLUMNS } = require('./middleware');

/** Comptes : création, mise à jour, lecture. Le hash ne sort jamais d'ici. */

function toPublic(row) {
  if (!row) return null;
  const { password_hash: _hash, ...rest } = row;
  return { ...rest, preferences: JSON.parse(rest.preferences || '{}') };
}

function getUser(db, id) {
  return toPublic(db.prepare(`SELECT ${PUBLIC_USER_COLUMNS}, last_login_at, created_at FROM users WHERE id = ?`).get(id));
}

function listUsers(db, { q = null, role = null, activeOnly = false } = {}) {
  const where = [];
  const args = [];
  if (q) {
    where.push('(u.full_name LIKE ? OR u.email LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }
  if (role) {
    where.push('u.role = ?');
    args.push(role);
  }
  if (activeOnly) where.push('u.is_active = 1');
  return db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.role, u.department, u.phone, u.is_active, u.manager_id,
              m.full_name AS manager_name, u.last_login_at
         FROM users u LEFT JOIN users m ON m.id = u.manager_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY u.full_name`
    )
    .all(...args);
}

async function createUser(db, input, now = new Date()) {
  const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(input.email);
  if (exists) throw conflict('Un compte existe déjà avec cet email');
  const hash = await hashPassword(input.password);
  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, full_name, role, manager_id, department, phone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.email,
      hash,
      input.full_name,
      input.role || 'user',
      input.manager_id ?? null,
      input.department ?? null,
      input.phone ?? null,
      now.toISOString(),
      now.toISOString()
    );
  return getUser(db, info.lastInsertRowid);
}

const UPDATABLE = ['email', 'full_name', 'role', 'manager_id', 'department', 'phone', 'is_active'];

async function updateUser(db, id, patch, now = new Date()) {
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!current) throw notFound('Utilisateur introuvable');
  if (patch.manager_id === id) throw badRequest('Un utilisateur ne peut pas être son propre manager');

  const sets = [];
  const args = [];
  for (const field of UPDATABLE) {
    if (patch[field] === undefined) continue;
    sets.push(`${field} = ?`);
    args.push(typeof patch[field] === 'boolean' ? Number(patch[field]) : patch[field]);
  }
  if (patch.password) {
    sets.push('password_hash = ?');
    args.push(await hashPassword(patch.password));
  }
  if (!sets.length) return getUser(db, id);

  if (current.role === 'admin' && (patch.role && patch.role !== 'admin' || patch.is_active === false)) {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1").get().n;
    if (admins <= 1) throw conflict('Impossible de retirer le dernier administrateur actif');
  }

  sets.push('updated_at = ?');
  args.push(now.toISOString(), id);
  try {
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw conflict('Un compte existe déjà avec cet email');
    throw err;
  }
  return getUser(db, id);
}

function setPreferences(db, id, prefs) {
  const row = db.prepare('SELECT preferences FROM users WHERE id = ?').get(id);
  const merged = { ...JSON.parse(row?.preferences || '{}'), ...prefs };
  db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(JSON.stringify(merged), id);
  return merged;
}

module.exports = { getUser, listUsers, createUser, updateUser, setPreferences, toPublic };
