'use strict';

const { z } = require('zod');
const { badRequest } = require('./http-errors');

/**
 * Formulaires dynamiques décrits en JSON (catalogue de services, attributs
 * des classes de CI). Un schéma est une liste de champs :
 *
 *   [{ name, label, type, required?, options?, min?, max?, help? }]
 *
 * type : text | textarea | number | date | select | checkbox | user | ci.
 * Le même schéma sert au rendu (public/js/ui/form-renderer.js) et à la
 * validation serveur ci-dessous : un client ne peut rien envoyer d'autre.
 */

const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'user', 'ci'];

const fieldDefinition = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'nom de champ : minuscules, chiffres, _'),
    label: z.string().trim().min(1).max(120),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().optional(),
    options: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    help: z.string().max(300).optional()
  })
  .refine((f) => f.type !== 'select' || (f.options && f.options.length > 0), { message: 'un champ « select » exige des options' });

const formSchemaDefinition = z
  .array(fieldDefinition)
  .max(40)
  .refine((fields) => new Set(fields.map((f) => f.name)).size === fields.length, { message: 'noms de champs en double' });

/** Vérifie qu'un schéma de formulaire est bien formé (édition admin). */
function parseFormSchema(schema) {
  const result = formSchemaDefinition.safeParse(schema);
  if (!result.success) {
    throw badRequest('Schéma de formulaire invalide', result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return result.data;
}

function isEmpty(v) {
  return v === undefined || v === null || v === '' || (typeof v === 'string' && !v.trim());
}

/**
 * Valide des valeurs saisies contre un schéma. Renvoie un objet nettoyé
 * (champs inconnus retirés, types normalisés) ou lève une 400 détaillée.
 * `exists` : { user(id), ci(id) } pour vérifier les références.
 */
function validateValues(schema, values = {}, exists = {}) {
  const out = {};
  const errors = [];
  const fail = (name, message) => errors.push({ path: name, message });

  for (const field of schema) {
    const raw = values?.[field.name];
    if (field.type === 'checkbox') {
      if (!isEmpty(raw) && typeof raw !== 'boolean') fail(field.name, 'oui / non attendu');
      else out[field.name] = raw === true;
      if (field.required && raw !== true) fail(field.name, 'Obligatoire');
      continue;
    }
    if (isEmpty(raw)) {
      if (field.required) fail(field.name, 'Obligatoire');
      continue;
    }
    switch (field.type) {
      case 'text':
      case 'textarea': {
        const s = String(raw).trim();
        if (s.length > (field.type === 'text' ? 300 : 5000)) fail(field.name, 'Trop long');
        else out[field.name] = s;
        break;
      }
      case 'number': {
        const n = Number(raw);
        if (!Number.isFinite(n)) fail(field.name, 'Nombre attendu');
        else if (field.min !== undefined && n < field.min) fail(field.name, `Minimum ${field.min}`);
        else if (field.max !== undefined && n > field.max) fail(field.name, `Maximum ${field.max}`);
        else out[field.name] = n;
        break;
      }
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw)) || Number.isNaN(Date.parse(raw))) fail(field.name, 'Date AAAA-MM-JJ attendue');
        else out[field.name] = String(raw);
        break;
      case 'select':
        if (!field.options.includes(String(raw))) fail(field.name, 'Valeur hors liste');
        else out[field.name] = String(raw);
        break;
      case 'user':
      case 'ci': {
        const id = Number(raw);
        if (!Number.isInteger(id) || id <= 0 || (exists[field.type] && !exists[field.type](id))) fail(field.name, 'Référence inconnue');
        else out[field.name] = id;
        break;
      }
      default:
        fail(field.name, 'Type inconnu');
    }
  }
  if (errors.length) throw badRequest('Formulaire incomplet ou invalide', errors);
  return out;
}

/** Vérificateurs de référence adossés à la base. */
function referenceCheckers(db) {
  return {
    user: (id) => Boolean(db.prepare('SELECT 1 FROM users WHERE id = ? AND is_active = 1').get(id)),
    ci: (id) => Boolean(db.prepare("SELECT 1 FROM cis WHERE id = ? AND status <> 'retired'").get(id))
  };
}

module.exports = { parseFormSchema, validateValues, referenceCheckers, FIELD_TYPES };
