'use strict';

const { z } = require('zod');
const { badRequest } = require('./http-errors');

/** Valide `data` contre un schéma zod ; lève une 400 détaillée sinon. */
function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message
    }));
    throw badRequest('Données invalides', details);
  }
  return result.data;
}

/** Middlewares : remplacent req.body / req.params, posent req.validQuery. */
const body = (schema) => (req, _res, next) => {
  req.body = parse(schema, req.body ?? {});
  next();
};
const params = (schema) => (req, _res, next) => {
  req.validParams = parse(schema, req.params);
  next();
};
const query = (schema) => (req, _res, next) => {
  req.validQuery = parse(schema, req.query);
  next();
};

// Briques réutilisées par les routes.
const id = z.coerce.number().int().positive();
const idParam = z.object({ id });
const optionalId = z.union([id, z.null()]).optional();
const text = (max = 200) => z.string().trim().min(1).max(max);
const optionalText = (max = 5000) => z.union([z.string().trim().max(max), z.null()]).optional();
const level = z.coerce.number().int().min(1).max(3);
const isoDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString());

module.exports = { z, parse, body, params, query, id, idParam, optionalId, text, optionalText, level, isoDate };
