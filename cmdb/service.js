'use strict';

const { notFound, conflict, badRequest } = require('../lib/http-errors');
const { validateValues, referenceCheckers } = require('../lib/form-schema');
const { recordChanges, recordEvent } = require('../tickets/audit');

/** CMDB : éléments de configuration et relations, avec audit. */

const STATUSES = { planned: 'Planifié', in_service: 'En service', maintenance: 'En maintenance', retired: 'Retiré' };
const ENVIRONMENTS = { prod: 'Production', preprod: 'Préproduction', test: 'Test', dev: 'Développement' };
const CRITICALITY = { 1: 'Critique', 2: 'Importante', 3: 'Faible' };

const TRACKED = {
  name: { kind: 'text' },
  status: { kind: 'enum', labels: STATUSES },
  environment: { kind: 'enum', labels: ENVIRONMENTS },
  criticality: { kind: 'enum', labels: CRITICALITY },
  owner_id: { kind: 'user' },
  support_group_id: { kind: 'group' },
  location: { kind: 'text' },
  description: { kind: 'text' },
  attributes: { kind: 'text' }
};

const FIELDS = ['name', 'class_id', 'status', 'environment', 'criticality', 'owner_id', 'support_group_id', 'location', 'description', 'attributes'];

function getClass(db, id) {
  const cls = db.prepare('SELECT * FROM ci_classes WHERE id = ?').get(id);
  if (!cls) throw badRequest('Classe de CI inconnue', [{ path: 'class_id', message: 'Inconnue' }]);
  return { ...cls, attributes_schema: JSON.parse(cls.attributes_schema) };
}

function listClasses(db) {
  return db
    .prepare('SELECT c.*, (SELECT COUNT(*) FROM cis WHERE class_id = c.id) AS ci_count FROM ci_classes c ORDER BY c.label')
    .all()
    .map((c) => ({ ...c, attributes_schema: JSON.parse(c.attributes_schema) }));
}

function loadCi(db, id) {
  const ci = db
    .prepare(
      `SELECT ci.*, cl.code AS class_code, cl.label AS class_label, cl.icon AS class_icon,
              u.full_name AS owner_name, g.name AS support_group_name
         FROM cis ci JOIN ci_classes cl ON cl.id = ci.class_id
         LEFT JOIN users u ON u.id = ci.owner_id
         LEFT JOIN support_groups g ON g.id = ci.support_group_id
        WHERE ci.id = ?`
    )
    .get(id);
  if (!ci) return null;
  return { ...ci, attributes: JSON.parse(ci.attributes || '{}') };
}

function requireCi(db, id) {
  const ci = loadCi(db, id);
  if (!ci) throw notFound('Élément de configuration introuvable');
  return ci;
}

function uniqueName(fn) {
  try {
    return fn();
  } catch (err) {
    if (String(err.message).includes('UNIQUE') && String(err.message).includes('cis.name')) {
      throw conflict('Un CI porte déjà ce nom');
    }
    throw err;
  }
}

function createCi(ctx, input) {
  const { db } = ctx;
  const cls = getClass(db, input.class_id);
  const attributes = validateValues(cls.attributes_schema, input.attributes || {}, referenceCheckers(db));
  const now = ctx.now.toISOString();
  return uniqueName(() =>
    db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO cis (name, class_id, status, environment, criticality, owner_id, support_group_id, location, description, attributes, created_at, updated_at)
           VALUES (@name, @class_id, @status, @environment, @criticality, @owner_id, @support_group_id, @location, @description, @attributes, @now, @now)`
        )
        .run({
          name: input.name,
          class_id: input.class_id,
          status: input.status || 'in_service',
          environment: input.environment || 'prod',
          criticality: input.criticality || 2,
          owner_id: input.owner_id ?? null,
          support_group_id: input.support_group_id ?? null,
          location: input.location ?? null,
          description: input.description ?? null,
          attributes: JSON.stringify(attributes),
          now
        });
      const id = Number(info.lastInsertRowid);
      recordEvent(db, { entity: 'ci', entityId: id, event: 'created', display: cls.label, userId: ctx.user?.id, at: now });
      return loadCi(db, id);
    })()
  );
}

function updateCi(ctx, id, patch) {
  const { db } = ctx;
  const before = requireCi(db, id);
  const after = { ...before, ...patch };
  const cls = getClass(db, after.class_id);
  if (patch.attributes !== undefined || patch.class_id !== undefined) {
    after.attributes = validateValues(cls.attributes_schema, after.attributes || {}, referenceCheckers(db));
  }
  const now = ctx.now.toISOString();
  return uniqueName(() =>
    db.transaction(() => {
      const row = { ...after, attributes: JSON.stringify(after.attributes) };
      db.prepare(`UPDATE cis SET ${FIELDS.map((f) => `${f} = @${f}`).join(', ')}, updated_at = @now WHERE id = @id`).run({
        ...Object.fromEntries(FIELDS.map((f) => [f, row[f] ?? null])),
        now,
        id
      });
      recordChanges(db, {
        entity: 'ci',
        entityId: id,
        before: { ...before, attributes: JSON.stringify(before.attributes) },
        after: row,
        tracked: TRACKED,
        userId: ctx.user?.id,
        at: now
      });
      return loadCi(db, id);
    })()
  );
}

/** Relations d'un CI dans les deux sens, avec le libellé lisible dans chaque sens. */
function listRelations(db, ciId) {
  return db
    .prepare(
      `SELECT r.id, r.type, 'out' AS direction, t.label AS label, c.id AS ci_id, c.name, cl.label AS class_label, cl.code AS class_code, c.status
         FROM ci_relations r JOIN ci_relation_types t ON t.code = r.type
         JOIN cis c ON c.id = r.target_ci_id JOIN ci_classes cl ON cl.id = c.class_id
        WHERE r.source_ci_id = @id
       UNION ALL
       SELECT r.id, r.type, 'in' AS direction, t.reverse_label AS label, c.id AS ci_id, c.name, cl.label, cl.code, c.status
         FROM ci_relations r JOIN ci_relation_types t ON t.code = r.type
         JOIN cis c ON c.id = r.source_ci_id JOIN ci_classes cl ON cl.id = c.class_id
        WHERE r.target_ci_id = @id
       ORDER BY 4, 6`
    )
    .all({ id: ciId });
}

function addRelation(ctx, sourceId, targetId, type) {
  const { db } = ctx;
  if (sourceId === targetId) throw badRequest('Un CI ne peut pas être relié à lui-même');
  const source = requireCi(db, sourceId);
  const target = requireCi(db, targetId);
  const relType = db.prepare('SELECT * FROM ci_relation_types WHERE code = ?').get(type);
  if (!relType) throw badRequest('Type de relation inconnu');
  // « A héberge B » et « B héberge A » en même temps n'a pas de sens physique.
  if (type === 'hosts' && db.prepare("SELECT 1 FROM ci_relations WHERE source_ci_id = ? AND target_ci_id = ? AND type = 'hosts'").get(targetId, sourceId)) {
    throw conflict(`${target.name} héberge déjà ${source.name}`);
  }
  const now = ctx.now.toISOString();
  return db.transaction(() => {
    const info = db
      .prepare('INSERT OR IGNORE INTO ci_relations (source_ci_id, target_ci_id, type, created_at) VALUES (?, ?, ?, ?)')
      .run(sourceId, targetId, type, now);
    if (!info.changes) throw conflict('Cette relation existe déjà');
    recordEvent(db, { entity: 'ci', entityId: sourceId, event: 'ci', display: `Relation ajoutée : ${relType.label} ${target.name}`, userId: ctx.user?.id, at: now });
    return Number(info.lastInsertRowid);
  })();
}

function removeRelation(ctx, relationId) {
  const { db } = ctx;
  const rel = db
    .prepare(
      `SELECT r.*, t.label, c.name AS target_name FROM ci_relations r
         JOIN ci_relation_types t ON t.code = r.type JOIN cis c ON c.id = r.target_ci_id WHERE r.id = ?`
    )
    .get(relationId);
  if (!rel) throw notFound('Relation introuvable');
  db.transaction(() => {
    db.prepare('DELETE FROM ci_relations WHERE id = ?').run(relationId);
    recordEvent(db, {
      entity: 'ci',
      entityId: rel.source_ci_id,
      event: 'ci',
      display: `Relation retirée : ${rel.label} ${rel.target_name}`,
      userId: ctx.user?.id,
      at: ctx.now.toISOString()
    });
  })();
}

module.exports = {
  STATUSES,
  ENVIRONMENTS,
  CRITICALITY,
  listClasses,
  loadCi,
  requireCi,
  createCi,
  updateCi,
  listRelations,
  addRelation,
  removeRelation
};
