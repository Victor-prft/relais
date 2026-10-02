import { h, initials } from './dom.js';
import { PRIORITY_LABELS } from '../format.js';

const STATE_TONES = {
  new: 'info',
  assigned: 'accent',
  in_progress: 'accent',
  on_hold: 'warn',
  resolved: 'ok',
  closed: '',
  canceled: '',
  // demandes et tâches
  pending_approval: 'warn',
  approved: 'accent',
  fulfilled: 'ok',
  rejected: 'danger',
  pending: '',
  open: 'info',
  closed_complete: 'ok',
  closed_incomplete: 'danger',
  // changements
  draft: '',
  assess: 'warn',
  authorized: 'accent',
  scheduled: 'info',
  implement: 'accent',
  review: 'info'
};

export const STATE_LABELS = {
  new: 'Nouveau',
  assigned: 'Assigné',
  in_progress: 'En cours',
  on_hold: 'En attente',
  resolved: 'Résolu',
  closed: 'Clos',
  canceled: 'Annulé',
  pending_approval: 'En approbation',
  approved: 'Approuvée',
  fulfilled: 'Traitée',
  rejected: 'Rejetée',
  pending: 'En attente',
  open: 'À traiter',
  closed_complete: 'Terminée',
  closed_incomplete: 'Non réalisée',
  draft: 'Brouillon',
  assess: 'Évaluation CAB',
  authorized: 'Autorisé',
  scheduled: 'Planifié',
  implement: 'Mise en œuvre',
  review: 'Revue'
};

export function stateBadge(state, label = STATE_LABELS[state] || state) {
  return h('span', { class: `badge dot ${STATE_TONES[state] ?? ''}` }, label);
}

export function priorityBadge(priority, { short = false } = {}) {
  if (!priority) return '—';
  return h('span', { class: `prio prio-${priority}`, title: PRIORITY_LABELS[priority] }, short ? `P${priority}` : PRIORITY_LABELS[priority]);
}

export function personCell(name) {
  if (!name) return h('span', { class: 'faint' }, 'Non assigné');
  return h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } }, h('span', { class: 'avatar small' }, initials(name)), name);
}

export const TYPE_LABELS = { incident: 'Incident', request: 'Demande', request_task: 'Tâche', change: 'Changement', kb_article: 'Article' };

/** Route de la fiche d'un ticket selon son type (console). */
export function ticketPath(type, id) {
  return {
    incident: `/incidents/${id}`,
    request: `/requests/${id}`,
    request_task: `/tasks/${id}`,
    change: `/changes/${id}`,
    kb_article: `/kb/${id}`
  }[type];
}
