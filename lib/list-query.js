'use strict';

const { z } = require('zod');
const { badRequest } = require('./http-errors');

/**
 * Requêtes des vues « liste » : tri, filtres combinables, recherche, pagination.
 *
 * Une liste est décrite par une définition :
 *   {
 *     from: 'FROM tickets t JOIN … ',          // jointures figées, écrites par nous
 *     where: "t.type = 'incident'",            // restriction fixe (facultative)
 *     columns: { number: { sql: 't.number', sortable: true, filter: 'text' }, … },
 *     search: ['t.number', 't.title'],
 *     defaultSort: { key: 'opened_at', dir: 'desc' }
 *   }
 *
 * Sécurité : un nom de champ, d'opérateur ou de tri qui vient du client n'est
 * jamais concaténé ; il sert de clé dans la définition (liste blanche). Les
 * valeurs passent toutes en paramètres nommés.
 */

const OPS_BY_TYPE = {
  text: ['eq', 'neq', 'contains', 'empty', 'notempty'],
  enum: ['eq', 'neq', 'in', 'nin', 'empty', 'notempty'],
  id: ['eq', 'neq', 'in', 'nin', 'empty', 'notempty'],
  number: ['eq', 'neq', 'in', 'nin', 'gte', 'lte', 'empty', 'notempty'],
  date: ['gte', 'lte', 'empty', 'notempty'],
  bool: ['eq']
};

const filterSchema = z.object({
  field: z.string().max(50),
  op: z.enum(['eq', 'neq', 'in', 'nin', 'contains', 'gte', 'lte', 'empty', 'notempty']),
  value: z
    .union([z.string().max(200), z.number(), z.boolean(), z.null(), z.array(z.union([z.string().max(100), z.number()])).max(50)])
    .optional()
});

const jsonArray = z
  .string()
  .max(5000)
  .transform((s, ctx) => {
    try {
      return JSON.parse(s);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'JSON invalide' });
      return z.NEVER;
    }
  })
  .pipe(z.array(filterSchema).max(20));

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  sort: z.string().max(50).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  filters: jsonArray.optional()
});

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Valeurs symboliques : '@me' (l'utilisateur courant), '@mygroups' (ses
 * groupes), '@days:-7' (maintenant − 7 jours, pour les dates).
 */
function resolveValue(value, ctx) {
  if (value === '@me') return ctx.user.id;
  if (value === '@mygroups') {
    return ctx.db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').all(ctx.user.id).map((r) => r.group_id);
  }
  if (typeof value === 'string') {
    const days = value.match(/^@days:(-?\d{1,4})$/);
    if (days) return new Date(ctx.now.getTime() + Number(days[1]) * 86400000).toISOString();
  }
  return value;
}

function buildWhere(def, input, ctx, scope) {
  const params = { ...(scope?.params || {}) };
  const where = [];
  if (scope?.sql) where.push(scope.sql);
  if (def.where) where.push(def.where);
  let n = 0;
  const p = (value) => {
    const key = `p${n++}`;
    params[key] = typeof value === 'boolean' ? Number(value) : value;
    return `@${key}`;
  };

  if (input.q) {
    const like = p(`%${escapeLike(input.q)}%`);
    where.push(`(${def.search.map((s) => `${s} LIKE ${like} ESCAPE '\\'`).join(' OR ')})`);
  }

  for (const filter of input.filters || []) {
    const col = def.columns[filter.field];
    if (!col?.filter) throw badRequest(`Filtre inconnu : ${filter.field}`);
    if (!OPS_BY_TYPE[col.filter].includes(filter.op)) {
      throw badRequest(`Opérateur « ${filter.op} » non permis sur ${filter.field}`);
    }
    const sql = col.filterSql || col.sql;
    let value = resolveValue(filter.value, ctx);

    switch (filter.op) {
      case 'eq':
        where.push(value === null ? `${sql} IS NULL` : `${sql} = ${p(value)}`);
        break;
      case 'neq':
        where.push(`(${sql} IS NULL OR ${sql} <> ${p(value)})`);
        break;
      case 'in':
      case 'nin': {
        if (!Array.isArray(value)) value = [value];
        if (!value.length) {
          where.push(filter.op === 'in' ? '0' : '1');
          break;
        }
        const list = value.map((v) => p(v)).join(', ');
        where.push(filter.op === 'in' ? `${sql} IN (${list})` : `(${sql} IS NULL OR ${sql} NOT IN (${list}))`);
        break;
      }
      case 'contains':
        where.push(`${sql} LIKE ${p(`%${escapeLike(String(value ?? ''))}%`)} ESCAPE '\\'`);
        break;
      case 'gte':
        where.push(`${sql} >= ${p(value)}`);
        break;
      case 'lte':
        where.push(`${sql} <= ${p(value)}`);
        break;
      case 'empty':
        where.push(`(${sql} IS NULL OR ${sql} = '')`);
        break;
      case 'notempty':
        where.push(`(${sql} IS NOT NULL AND ${sql} <> '')`);
        break;
      default:
        throw badRequest('Opérateur inconnu');
    }
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function runListQuery(db, def, input, ctx, scope) {
  const { sql: whereSql, params } = buildWhere(def, input, ctx, scope);

  const sortKey = input.sort && def.columns[input.sort]?.sortable ? input.sort : def.defaultSort.key;
  const dir = (input.sort && input.dir) || (input.sort ? 'asc' : def.defaultSort.dir);
  const sortCol = def.columns[sortKey];
  const orderBy = `${sortCol.sortSql || sortCol.sql} ${dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, ${def.tieBreaker || 't.id DESC'}`;

  const select = Object.entries(def.columns)
    .map(([key, col]) => `${col.sql} AS ${key}`)
    .concat(def.extraSelect || [])
    .join(', ');

  const total = db.prepare(`SELECT COUNT(*) AS n ${def.from} ${whereSql}`).get(params).n;
  const offset = (input.page - 1) * input.pageSize;
  const rows = db
    .prepare(`SELECT ${select} ${def.from} ${whereSql} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: input.pageSize, offset });

  return { items: rows, total, page: input.page, pageSize: input.pageSize, sort: sortKey, dir };
}

module.exports = { runListQuery, buildWhere, listQuerySchema, OPS_BY_TYPE, escapeLike };
