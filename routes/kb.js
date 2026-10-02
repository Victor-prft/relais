'use strict';

const express = require('express');
const { z, body, params, query, idParam, text, optionalId } = require('../lib/validate');
const { requireAuth, requireRole } = require('../auth/middleware');
const { notFound } = require('../lib/http-errors');
const { isStaff } = require('../auth/roles');
const { searchArticles } = require('../kb/search');
const kb = require('../kb/service');
const { listAudit } = require('../tickets/audit');

/** Base de connaissances : lecture des articles publiés pour tous, rédaction pour le support. */
module.exports = function kbRoutes({ db }) {
  const router = express.Router();
  router.use(requireAuth);

  router.get(
    '/',
    query(z.object({ q: z.string().trim().max(200).optional(), category_id: z.coerce.number().int().positive().optional(), status: z.enum(['draft', 'published', 'retired', 'all']).optional() })),
    (req, res) => {
      const { q, category_id: categoryId, status } = req.validQuery;
      const staff = isStaff(req.user);
      // Un utilisateur ne voit que le publié, quoi qu'il demande.
      const wanted = staff ? status || 'published' : 'published';
      if (q) {
        let items = searchArticles(db, q, { publishedOnly: wanted === 'published', limit: 30 });
        if (wanted !== 'all' && wanted !== 'published') items = items.filter((a) => a.status === wanted);
        if (categoryId) items = items.filter((a) => a.category_id === categoryId);
        return res.json({ items });
      }
      const items = db
        .prepare(
          `SELECT a.id, a.number, a.title, a.status, a.category_id, c.name AS category_name, a.view_count, a.updated_at,
                  substr(a.body, 1, 220) AS excerpt, u.full_name AS author_name
             FROM kb_articles a LEFT JOIN categories c ON c.id = a.category_id LEFT JOIN users u ON u.id = a.author_id
            WHERE (@status = 'all' OR a.status = @status) AND (@cat IS NULL OR a.category_id = @cat)
            ORDER BY ${wanted === 'published' ? 'a.view_count DESC,' : ''} a.updated_at DESC LIMIT 100`
        )
        .all({ status: wanted, cat: categoryId ?? null });
      res.json({ items });
    }
  );

  router.get('/draft-from-ticket/:id', requireRole('agent'), params(idParam), (req, res) => {
    res.json(kb.draftFromTicket(db, req.validParams.id));
  });

  router.get('/:id', params(idParam), (req, res) => {
    const article = kb.loadArticle(db, req.validParams.id);
    if (!article || (!isStaff(req.user) && article.status !== 'published')) throw notFound('Article introuvable');
    if (article.status === 'published' && article.author_id !== req.user.id) {
      db.prepare('UPDATE kb_articles SET view_count = view_count + 1 WHERE id = ?').run(article.id);
    }
    res.json(article);
  });

  router.get('/:id/history', requireRole('agent'), params(idParam), (req, res) => {
    res.json({ items: listAudit(db, 'kb_article', req.validParams.id).reverse() });
  });

  const articleSchema = z.object({
    title: text(200),
    body: z.string().max(50000),
    category_id: optionalId,
    status: z.enum(['draft', 'published', 'retired'])
  });

  router.post('/', requireRole('agent'), body(articleSchema.extend({ status: articleSchema.shape.status.default('draft'), source_ticket_id: optionalId })), (req, res) => {
    res.status(201).json(kb.createArticle(req.ctx, req.body));
  });

  router.patch('/:id', requireRole('agent'), params(idParam), body(articleSchema.partial().strict()), (req, res) => {
    res.json(kb.updateArticle(req.ctx, req.validParams.id, req.body));
  });

  return router;
};
