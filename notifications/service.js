'use strict';

const { createEmailChannel } = require('./channels/email');

/**
 * Notifications in-app. `notify` insère une ligne par destinataire (jamais
 * l'auteur de l'action, jamais un compte inactif) puis confie le message
 * aux canaux sortants (email, inactif pour l'instant).
 */

let channels = [createEmailChannel({ enabled: false })];

/** Remplace les canaux sortants (démarrage du serveur, tests). */
function configureChannels(list) {
  channels = list;
}

function linkFor(user, ticket) {
  if (!ticket) return null;
  if (user.role === 'user') return `/#/portal/tickets/${ticket.id}`;
  const path = { incident: 'incidents', request: 'requests', request_task: 'tasks', change: 'changes' }[ticket.type];
  return `/#/${path}/${ticket.id}`;
}

function notify(ctx, { userIds, type, title, body = null, ticket = null }) {
  const { db } = ctx;
  const actorId = ctx.user?.id ?? null;
  const unique = [...new Set(userIds.filter(Boolean))].filter((id) => id !== actorId);
  if (!unique.length) return [];
  const users = db
    .prepare(`SELECT id, email, role FROM users WHERE is_active = 1 AND id IN (${unique.map(() => '?').join(', ')})`)
    .all(...unique);
  const insert = db.prepare(
    'INSERT INTO notifications (user_id, type, title, body, ticket_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const now = ctx.now.toISOString();
  const created = [];
  for (const user of users) {
    const info = insert.run(user.id, type, title, body, ticket?.id ?? null, now);
    created.push(Number(info.lastInsertRowid));
    for (const channel of channels) {
      if (!channel.enabled) continue;
      const id = Number(info.lastInsertRowid);
      channel
        .send({ to: user.email, subject: title, text: body || title, link: linkFor(user, ticket) })
        .then((sent) => {
          if (sent) db.prepare('UPDATE notifications SET emailed_at = ? WHERE id = ?').run(new Date().toISOString(), id);
        })
        .catch(() => {});
    }
  }
  return created;
}

const groupMembers = (db, groupId) =>
  groupId ? db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(groupId).map((r) => r.user_id) : [];

const groupManager = (db, groupId) =>
  groupId ? db.prepare('SELECT manager_id FROM support_groups WHERE id = ?').get(groupId)?.manager_id ?? null : null;

function listFor(db, userId, { limit = 30 } = {}) {
  const items = db
    .prepare(
      `SELECT n.*, t.number AS ticket_number, t.type AS ticket_type FROM notifications n
         LEFT JOIN tickets t ON t.id = n.ticket_id
        WHERE n.user_id = ? ORDER BY n.created_at DESC, n.id DESC LIMIT ?`
    )
    .all(userId, limit);
  return { items, unread: unreadCount(db, userId) };
}

const unreadCount = (db, userId) => db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;

module.exports = { notify, configureChannels, groupMembers, groupManager, listFor, unreadCount, linkFor };
