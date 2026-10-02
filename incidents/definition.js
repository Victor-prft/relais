'use strict';

const { workflow, ON_HOLD_REASONS, RESOLUTION_CODES, CONTACT_TYPES } = require('./workflow');
const { badRequest } = require('../lib/http-errors');

/**
 * Définition du type « incident » pour le service commun des tickets :
 * champs de la table d'extension, champs suivis par l'audit, règles du cycle de vie.
 */
module.exports = {
  type: 'incident',
  prefix: 'INC',
  label: 'Incident',
  extTable: 'incidents',
  extFields: ['contact_type', 'on_hold_reason', 'resolution_code', 'resolution_notes', 'reopen_count'],
  workflow,
  initialState: 'new',
  tracked: {
    on_hold_reason: { kind: 'enum', labels: ON_HOLD_REASONS },
    resolution_code: { kind: 'enum', labels: RESOLUTION_CODES },
    resolution_notes: { kind: 'text' },
    contact_type: { kind: 'enum', labels: CONTACT_TYPES }
  },

  /** Libellés propres aux incidents, ajoutés à la vue envoyée au front. */
  decorate(_ctx, view) {
    view.on_hold_reason_label = ON_HOLD_REASONS[view.on_hold_reason] || null;
    view.resolution_code_label = RESOLUTION_CODES[view.resolution_code] || null;
    view.contact_type_label = CONTACT_TYPES[view.contact_type] || null;
  },

  prepareCreate(_ctx, record) {
    record.contact_type ||= 'portal';
    record.reopen_count = 0;
    // Un incident créé déjà assigné à un agent démarre « Assigné ».
    if (record.assigned_to_id && record.state === 'new') record.state = 'assigned';
  },

  /**
   * Règles appliquées à chaque mise à jour, après la vérification de la
   * transition demandée. `after` est modifié en place.
   */
  beforeUpdate(ctx, before, after, patch) {
    const now = ctx.now.toISOString();

    // Affecter un agent à un incident nouveau le fait passer « Assigné ».
    if (before.state === 'new' && after.state === 'new' && after.assigned_to_id) after.state = 'assigned';

    // Prise en charge sans agent : l'agent qui agit se l'attribue (s'il est du groupe).
    if (['in_progress', 'on_hold', 'resolved'].includes(after.state) && after.state !== before.state) {
      require('../tickets/service').autoAssignActor(ctx, after);
    }
    if (after.state === 'assigned' && !after.assigned_to_id) {
      throw badRequest('Un incident « Assigné » doit avoir un agent', [{ path: 'assigned_to_id', message: 'Obligatoire' }]);
    }

    if (after.state === 'on_hold') {
      if (!after.on_hold_reason) {
        throw badRequest('Indiquez le motif de mise en attente', [{ path: 'on_hold_reason', message: 'Obligatoire' }]);
      }
    } else {
      after.on_hold_reason = null;
    }

    if (after.state === 'resolved' && before.state !== 'resolved') {
      const missing = ['resolution_code', 'resolution_notes'].filter((f) => !after[f]);
      if (missing.length) {
        throw badRequest('Code et notes de résolution obligatoires', missing.map((path) => ({ path, message: 'Obligatoire' })));
      }
      after.resolved_at = now;
    }

    // Réouverture par le demandeur ou un agent.
    if (before.state === 'resolved' && after.state === 'in_progress') {
      after.resolved_at = null;
      after.reopen_count = (before.reopen_count || 0) + 1;
    }

    // Première prise en charge effective.
    if (!after.first_response_at && ['in_progress', 'resolved'].includes(after.state)) after.first_response_at = now;

    if (after.state === 'closed' && before.state !== 'closed') after.closed_at = now;
    if (after.state === 'canceled' && before.state !== 'canceled') after.closed_at = now;

    void patch;
  }
};
