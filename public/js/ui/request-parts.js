import { h } from './dom.js';
import { stateBadge } from './badges.js';
import { formatDateTime } from '../format.js';

/** Briques communes à la fiche demande (console et portail). */

function display(field, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (field?.type === 'checkbox') return value ? 'Oui' : 'Non';
  if (field?.type === 'date') return new Date(`${value}T12:00:00`).toLocaleDateString('fr-FR');
  return String(value);
}

/** Réponses au formulaire du catalogue, avec les libellés de l'article. */
export function variablesBlock(ticket) {
  const schema = ticket.catalog_item?.form_schema || [];
  const values = ticket.variables || {};
  if (!schema.length && !Object.keys(values).length) return null;
  const rows = schema.length ? schema.map((f) => [f.label, display(f, values[f.name])]) : Object.entries(values).map(([k, v]) => [k, display(null, v)]);
  return h('dl', { class: 'kv' }, rows.map(([k, v]) => [h('dt', {}, k), h('dd', { style: { whiteSpace: 'pre-wrap' } }, v)]));
}

const APPROVAL_TONES = { requested: 'warn', approved: 'ok', rejected: 'danger', canceled: '' };
const APPROVAL_LABELS = { requested: 'En attente', approved: 'Approuvé', rejected: 'Refusé', canceled: 'Annulé' };

export function approvalsBlock(approvals = []) {
  if (!approvals.length) return h('p', { class: 'small muted' }, 'Aucune approbation requise.');
  return h('ul', { class: 'stack', style: { listStyle: 'none', padding: 0, margin: 0 } },
    approvals.map((a) =>
      h('li', {},
        h('div', { class: 'row' }, h('strong', { class: 'grow' }, a.approver_name), h('span', { class: `badge dot ${APPROVAL_TONES[a.state]}` }, APPROVAL_LABELS[a.state])),
        a.decided_at ? h('div', { class: 'small muted' }, formatDateTime(a.decided_at)) : h('div', { class: 'small muted' }, `Demandé le ${formatDateTime(a.requested_at)}`),
        a.comment ? h('div', { class: 'small', style: { fontStyle: 'italic' } }, `« ${a.comment} »`) : null
      )
    )
  );
}

/** Avancement des tâches, par étape (séquence). */
export function tasksBlock(tasks = [], { link = null } = {}) {
  if (!tasks.length) return h('p', { class: 'small muted' }, 'Les tâches seront créées après approbation.');
  const done = tasks.filter((t) => ['closed_complete', 'closed_incomplete', 'canceled'].includes(t.state)).length;
  const bySeq = new Map();
  for (const t of tasks) {
    if (!bySeq.has(t.sequence)) bySeq.set(t.sequence, []);
    bySeq.get(t.sequence).push(t);
  }
  return h('div', { class: 'stack' },
    h('div', { class: 'sla' }, h('div', { class: 'bar' }, h('span', { style: { width: `${Math.round((done / tasks.length) * 100)}%` } })), h('span', { class: 'small muted' }, `${done} / ${tasks.length} tâche(s) terminée(s)`)),
    [...bySeq.entries()].map(([seq, list]) =>
      h('div', {},
        h('div', { class: 'small faint' }, `Étape ${seq}`),
        list.map((t) =>
          h('div', { class: 'row', style: { justifyContent: 'space-between', padding: '4px 0' } },
            link ? h('a', { href: `#${link(t)}` }, h('span', { class: 'number' }, t.number), ' ', t.title) : h('span', {}, t.title),
            h('span', { class: 'row', style: { gap: '6px' } }, t.assigned_to_name ? h('span', { class: 'small muted' }, t.assigned_to_name) : null, stateBadge(t.state, t.state_label))
          )
        )
      )
    )
  );
}
