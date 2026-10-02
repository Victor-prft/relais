'use strict';

/**
 * Parcours de la CMDB.
 *
 * - `neighborhood` : voisinage d'un CI jusqu'à `depth` sauts, dans les deux
 *   sens (vue graphe).
 * - `impactOf` : ce qui tombe si ce CI tombe. Une panne se propage selon le
 *   type de relation (ci_relation_types.impact) : si B tombe et que « A dépend
 *   de B », A est touché ; si A tombe et que « A héberge B », B l'est.
 *   CTE récursive, profondeur bornée (une boucle de dépendances ne fait pas
 *   tourner la requête indéfiniment : UNION dédoublonne, la borne arrête).
 */

const MAX_DEPTH = 6;

function neighborhood(db, rootId, depth = 2) {
  const d = Math.max(1, Math.min(4, depth));
  const rows = db
    .prepare(
      `WITH RECURSIVE walk(id, depth) AS (
         SELECT @root, 0
         UNION
         SELECT CASE WHEN r.source_ci_id = w.id THEN r.target_ci_id ELSE r.source_ci_id END, w.depth + 1
           FROM walk w JOIN ci_relations r ON r.source_ci_id = w.id OR r.target_ci_id = w.id
          WHERE w.depth < @depth
       )
       SELECT c.id, c.name, c.status, c.criticality, cl.code AS class_code, cl.label AS class_label, MIN(w.depth) AS depth
         FROM walk w JOIN cis c ON c.id = w.id JOIN ci_classes cl ON cl.id = c.class_id
        GROUP BY c.id`
    )
    .all({ root: rootId, depth: d });

  const ids = rows.map((r) => r.id);
  if (!ids.length) return { nodes: [], edges: [] };
  const placeholders = ids.map(() => '?').join(', ');
  const edges = db
    .prepare(
      `SELECT r.id, r.source_ci_id AS source, r.target_ci_id AS target, r.type, t.label
         FROM ci_relations r JOIN ci_relation_types t ON t.code = r.type
        WHERE r.source_ci_id IN (${placeholders}) AND r.target_ci_id IN (${placeholders})`
    )
    .all(...ids, ...ids);

  return { nodes: rows.map((r) => ({ ...r, root: r.id === rootId })), edges };
}

function impactOf(db, ciId) {
  return db
    .prepare(
      `WITH RECURSIVE hit(id, depth, via) AS (
         SELECT @id, 0, NULL
         UNION
         SELECT r.source_ci_id, h.depth + 1, h.id
           FROM hit h JOIN ci_relations r ON r.target_ci_id = h.id
           JOIN ci_relation_types t ON t.code = r.type AND t.impact = 'to_source'
          WHERE h.depth < @max
         UNION
         SELECT r.target_ci_id, h.depth + 1, h.id
           FROM hit h JOIN ci_relations r ON r.source_ci_id = h.id
           JOIN ci_relation_types t ON t.code = r.type AND t.impact = 'to_target'
          WHERE h.depth < @max
       )
       SELECT c.id, c.name, c.criticality, cl.code AS class_code, cl.label AS class_label, MIN(h.depth) AS depth
         FROM hit h JOIN cis c ON c.id = h.id JOIN ci_classes cl ON cl.id = c.class_id
        WHERE h.id <> @id AND c.status <> 'retired'
        GROUP BY c.id
        ORDER BY depth, c.criticality, c.name`
    )
    .all({ id: ciId, max: MAX_DEPTH });
}

module.exports = { neighborhood, impactOf, MAX_DEPTH };
