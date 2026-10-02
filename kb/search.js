'use strict';

/**
 * Recherche plein texte (FTS5). La saisie n'est jamais passée telle quelle à
 * MATCH — la syntaxe FTS (guillemets, NEAR, opérateurs) ferait une injection de
 * requête : on extrait les mots, on les cite, on ajoute le préfixe *.
 */

// Mots vides français : ils diluent une recherche « l'un ou l'autre ».
const STOPWORDS = new Set(
  'le la les un une des de du au aux et ou a à en dans sur pour par avec sans ne pas plus mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs je tu il elle on nous vous ils elles ce cet cette ces qui que quoi dont est sont suis ai as avons avez ont été être fait faire peux peut plus très bien aussi depuis mais donc car si y'
    .split(' ')
);

function terms(text, { dropStopwords = false } = {}) {
  const words = (String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length >= 2);
  const kept = dropStopwords ? words.filter((w) => !STOPWORDS.has(w)) : words;
  return [...new Set(kept)].slice(0, 12);
}

/** Requête FTS sûre. mode 'and' : tous les mots ; 'or' : au moins un (suggestions). */
function buildFtsQuery(text, { mode = 'and' } = {}) {
  const list = terms(text, { dropStopwords: mode === 'or' || terms(text).length > 3 });
  if (!list.length) return null;
  return list.map((w) => `"${w.replace(/"/g, '')}"*`).join(mode === 'or' ? ' OR ' : ' ');
}

/**
 * Articles correspondants, les plus pertinents d'abord (bm25, le titre pèse
 * cinq fois plus que le corps). `excerpt` : extrait avec [[ ]] autour des mots trouvés.
 */
function searchArticles(db, text, { mode = 'and', limit = 20, publishedOnly = true } = {}) {
  const match = buildFtsQuery(text, { mode });
  if (!match) return [];
  return db
    .prepare(
      `SELECT a.id, a.number, a.title, a.status, a.category_id, c.name AS category_name, a.view_count, a.updated_at,
              snippet(kb_fts, 1, '[[', ']]', '…', 18) AS excerpt,
              bm25(kb_fts, 5.0, 1.0) AS rank
         FROM kb_fts JOIN kb_articles a ON a.id = kb_fts.rowid
         LEFT JOIN categories c ON c.id = a.category_id
        WHERE kb_fts MATCH ? ${publishedOnly ? "AND a.status = 'published'" : ''}
        ORDER BY rank LIMIT ?`
    )
    .all(match, limit);
}

module.exports = { buildFtsQuery, searchArticles, terms };
