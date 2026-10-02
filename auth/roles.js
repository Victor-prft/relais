'use strict';

/** Les rôles sont cumulatifs : chaque rôle a les droits de ceux qui le précèdent. */
const ROLES = ['user', 'agent', 'manager', 'admin'];
const RANK = Object.fromEntries(ROLES.map((role, index) => [role, index]));

const hasRole = (user, minimum) => Boolean(user) && RANK[user.role] >= RANK[minimum];
const isStaff = (user) => hasRole(user, 'agent');

module.exports = { ROLES, hasRole, isStaff };
