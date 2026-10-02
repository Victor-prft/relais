'use strict';

const { workflow, CHANGE_TYPES, RISKS, CLOSE_CODES, CONTENT_FIELDS } = require('./workflow');
const { badRequest, unprocessable } = require('../lib/http-errors');

/** Type « change » (CHG) pour le service commun des tickets. */

const required = (after, fields) => {
  const missing = fields.filter((f) => !after[f] || !String(after[f]).trim());
  if (missing.length) throw badRequest('Champs obligatoires manquants', missing.map((path) => ({ path, message: 'Obligatoire' })));
};

function assertWindow(after) {
  required(after, ['planned_start', 'planned_end']);
  if (after.planned_end <= after.planned_start) {
    throw badRequest('La fin de la fenêtre doit suivre son début', [{ path: 'planned_end', message: 'Avant le début' }]);
  }
}

module.exports = {
  type: 'change',
  prefix: 'CHG',
  label: 'Changement',
  extTable: 'changes',
  extFields: [
    'change_type',
    'risk',
    'justification',
    'implementation_plan',
    'backout_plan',
    'test_plan',
    'planned_start',
    'planned_end',
    'actual_start',
    'actual_end',
    'close_code',
    'close_notes',
    'standard_template_id'
  ],
  workflow,
  initialState: 'draft',
  tracked: {
    change_type: { kind: 'enum', labels: CHANGE_TYPES },
    risk: { kind: 'enum', labels: RISKS },
    justification: { kind: 'text' },
    implementation_plan: { kind: 'text' },
    backout_plan: { kind: 'text' },
    test_plan: { kind: 'text' },
    planned_start: { kind: 'date' },
    planned_end: { kind: 'date' },
    close_code: { kind: 'enum', labels: CLOSE_CODES }
  },

  decorate(ctx, view) {
    view.change_type_label = CHANGE_TYPES[view.change_type];
    view.risk_label = RISKS[view.risk];
    view.close_code_label = CLOSE_CODES[view.close_code] || null;
    view.cis = ctx.db
      .prepare(
        `SELECT ci.id, ci.name, ci.criticality, cl.label AS class_label FROM ticket_cis tc
           JOIN cis ci ON ci.id = tc.ci_id JOIN ci_classes cl ON cl.id = ci.class_id
          WHERE tc.ticket_id = ? ORDER BY ci.name`
      )
      .all(view.id);
  },

  beforeUpdate(ctx, before, after) {
    const now = ctx.now.toISOString();
    const moving = after.state !== before.state;

    // Le contenu se fige à la soumission (on y revient en repassant en brouillon).
    if (before.state !== 'draft' && !(moving && after.state === 'draft')) {
      const touched = CONTENT_FIELDS.filter((f) => String(before[f] ?? '') !== String(after[f] ?? ''));
      if (touched.length) throw unprocessable('Le contenu d’un changement soumis est figé : repassez-le en brouillon pour le modifier', { fields: touched });
    }
    if (['implement', 'review', 'closed'].includes(before.state) && (before.planned_start !== after.planned_start || before.planned_end !== after.planned_end)) {
      throw unprocessable('La fenêtre ne se modifie plus une fois la mise en œuvre commencée');
    }
    if (!moving) return;

    if (after.state === 'assess') {
      if (after.change_type === 'standard') throw unprocessable('Un changement standard est pré-autorisé : planifiez-le directement');
      required(after, ['justification', 'implementation_plan', 'backout_plan']);
      assertWindow(after);
    }
    if (after.state === 'scheduled') {
      if (before.state === 'draft' && after.change_type !== 'standard') {
        throw unprocessable('Un changement normal ou urgent passe d’abord par le CAB');
      }
      required(after, ['implementation_plan', 'backout_plan']);
      assertWindow(after);
    }
    if (after.state === 'implement') after.actual_start = now;
    if (after.state === 'review') after.actual_end = now;
    if (after.state === 'closed') {
      required(after, ['close_code']);
      after.closed_at = now;
      after.resolved_at = after.actual_end || now;
    }
    if (after.state === 'canceled') after.closed_at = now;
  }
};
