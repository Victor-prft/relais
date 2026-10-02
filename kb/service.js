'use strict';

const { nextNumber } = require('../tickets/numbering');
const { recordChanges, recordEvent } = require('../tickets/audit');
const { loadTicket } = require('../tickets/service');
const { notFound, unprocessable } = require('../lib/http-errors');

/** Articles de la base de connaissances : rédaction, publication, retrait, audit. */

const STATUSES = { draft: 'Brouillon', published: 'Publié', retired: 'Retiré' };
const TRACKED = {
  title: { kind: 'text' },
  body: { kind: 'text' },
  category_id: { kind: 'category' },
  status: { kind: 'enum', labels: STATUSES }
};

function loadArticle(db, id) {
  return db
    .prepare(
      `SELECT a.*, c.name AS category_name, u.full_name AS author_name, t.number AS source_ticket_number, t.type AS source_ticket_type
         FROM kb_articles a LEFT JOIN categories c ON c.id = a.category_id
         LEFT JOIN users u ON u.id = a.author_id LEFT JOIN tickets t ON t.id = a.source_ticket_id
        WHERE a.id = ?`
    )
    .get(id);
}

function requireArticle(db, id) {
  const article = loadArticle(db, id);
  if (!article) throw notFound('Article introuvable');
  return article;
}

function createArticle(ctx, input) {
  const { db } = ctx;
  const now = ctx.now.toISOString();
  return db.transaction(() => {
    const status = input.status || 'draft';
    const info = db
      .prepare(
        `INSERT INTO kb_articles (number, title, body, category_id, status, author_id, source_ticket_id, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(nextNumber(db, 'KB'), input.title, input.body || '', input.category_id ?? null, status, ctx.user?.id ?? null, input.source_ticket_id ?? null, status === 'published' ? now : null, now, now);
    const id = Number(info.lastInsertRowid);
    recordEvent(db, { entity: 'kb_article', entityId: id, event: 'created', display: STATUSES[status], userId: ctx.user?.id, at: now });
    return loadArticle(db, id);
  })();
}

function updateArticle(ctx, id, patch) {
  const { db } = ctx;
  const before = requireArticle(db, id);
  const after = { ...before, ...patch };
  const now = ctx.now.toISOString();
  if (after.status === 'published' && !after.body.trim()) throw unprocessable('Un article publié doit avoir un contenu');
  return db.transaction(() => {
    const publishing = after.status === 'published' && before.status !== 'published';
    db.prepare(
      'UPDATE kb_articles SET title = ?, body = ?, category_id = ?, status = ?, published_at = ?, updated_at = ? WHERE id = ?'
    ).run(after.title, after.body, after.category_id ?? null, after.status, publishing ? now : before.published_at, now, id);
    recordChanges(db, { entity: 'kb_article', entityId: id, before, after, tracked: TRACKED, userId: ctx.user?.id, at: now });
    return loadArticle(db, id);
  })();
}

/**
 * Brouillon prérempli depuis un incident résolu : symptômes (description),
 * résolution (notes), catégorie de même nom côté base de connaissances.
 */
function draftFromTicket(db, ticketId) {
  const ticket = loadTicket(db, ticketId);
  if (!ticket) throw notFound('Ticket introuvable');
  if (!['resolved', 'closed'].includes(ticket.state) || !ticket.resolution_notes) {
    throw unprocessable('Seul un incident résolu, avec des notes de résolution, peut devenir un article');
  }
  const category = ticket.category_id
    ? db.prepare(
        `SELECT k.id FROM categories k JOIN categories i ON i.id = ? LEFT JOIN categories ip ON ip.id = i.parent_id
          WHERE k.scope = 'kb' AND (k.name = i.name OR k.name = ip.name) ORDER BY k.name = i.name DESC LIMIT 1`
      ).get(ticket.category_id)
    : null;
  const ci = ticket.ci_id ? db.prepare('SELECT name FROM cis WHERE id = ?').get(ticket.ci_id)?.name : null;
  const body = [
    '## Symptômes',
    '',
    ticket.description || ticket.title,
    '',
    ci ? `Élément concerné : **${ci}**.\n` : null,
    '## Cause',
    '',
    '_À compléter : ce qui a provoqué le problème._',
    '',
    '## Résolution',
    '',
    ticket.resolution_notes,
    '',
    '## Pour éviter que ça se reproduise',
    '',
    '- _À compléter_',
    '',
    `_Article rédigé à partir de ${ticket.number}._`
  ]
    .filter((line) => line !== null)
    .join('\n');
  return { title: ticket.title, body, category_id: category?.id ?? null, source_ticket_id: ticket.id, source_ticket_number: ticket.number };
}

module.exports = { STATUSES, loadArticle, requireArticle, createArticle, updateArticle, draftFromTicket };
