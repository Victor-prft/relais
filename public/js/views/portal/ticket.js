import { h, mount, loading } from '../../ui/dom.js';
import { api } from '../../api.js';
import { toast, toastError, confirmDialog } from '../../ui/feedback.js';
import { workflowBar, keyValues, sideCard } from '../../ui/record.js';
import { activityPanel } from '../../ui/activity.js';
import { stateBadge, priorityBadge, TYPE_LABELS } from '../../ui/badges.js';
import { formatDateTime } from '../../format.js';
import { setTitle } from '../../app.js';
import { portalTicketExtras } from './ticket-extras.js';

const REQUESTER_ACTIONS = {
  closed: { label: 'Confirmer la résolution', class: 'primary', confirm: null },
  in_progress: { label: 'Le problème persiste', class: '', confirm: 'Rouvrir ce ticket ? Le support sera prévenu.' },
  canceled: { label: 'Annuler ma demande', class: 'danger', confirm: 'Annuler ce ticket ?' }
};

/** Fiche d'un ticket vue du demandeur. */
export async function portalTicketView(el, { id }) {
  mount(el, loading());
  const t = await api.get(`/api/tickets/${id}`);
  setTitle(`${t.number} · ${t.title}`);

  const act = async (state) => {
    const action = REQUESTER_ACTIONS[state];
    if (action.confirm && !(await confirmDialog(action.confirm))) return;
    try {
      const endpoint = t.type === 'incident' ? `/api/incidents/${t.id}` : `/api/requests/${t.id}`;
      await api.patch(endpoint, { state, version: t.version });
      toast('C’est noté, merci.');
      portalTicketView(el, { id });
    } catch (err) {
      toastError(err);
    }
  };

  const actions = t.allowed_transitions
    .filter((tr) => REQUESTER_ACTIONS[tr.state])
    .map((tr) => h('button', { class: `btn ${REQUESTER_ACTIONS[tr.state].class}`, type: 'button', onclick: () => act(tr.state) }, REQUESTER_ACTIONS[tr.state].label));

  mount(el,
    h('p', {}, h('a', { href: '#/portal/tickets' }, '← Mes tickets')),
    h('div', { class: 'record-head' },
      h('div', { class: 'grow' },
        h('div', { class: 'row' }, h('span', { class: 'number' }, t.number), h('span', { class: 'badge' }, TYPE_LABELS[t.type]), stateBadge(t.state, t.state_label)),
        h('h1', {}, t.title)
      ),
      h('div', { class: 'btn-group' }, actions)
    ),
    t.state === 'canceled' || t.state === 'rejected' ? null : workflowBar(t.workflow_steps, t.workflow_step),
    t.state === 'resolved'
      ? h('div', { class: 'callout ai', style: { marginBottom: '16px' } },
          h('strong', {}, 'Le support pense avoir résolu votre problème.'),
          t.resolution_notes ? h('p', { style: { whiteSpace: 'pre-wrap', margin: '6px 0 0' } }, t.resolution_notes) : null,
          h('p', { class: 'small muted', style: { margin: '6px 0 0' } }, 'Confirmez la résolution, ou indiquez que le problème persiste. Sans réponse, le ticket sera clos automatiquement.')
        )
      : null,
    t.state === 'on_hold' && t.on_hold_reason === 'awaiting_user'
      ? h('div', { class: 'callout warn', style: { marginBottom: '16px' } }, 'Le support attend votre réponse : répondez par un commentaire ci-dessous.')
      : null,
    h('div', { class: 'record' },
      h('div', { class: 'stack' },
        h('section', { class: 'card card-body' }, h('h3', {}, 'Description'), h('p', { style: { whiteSpace: 'pre-wrap' } }, t.description || '—'), portalTicketExtras(t)),
        h('section', { class: 'card card-body' },
          h('h3', {}, 'Échanges avec le support'),
          activityPanel({ ticketId: t.id, canWorkNote: false, placeholder: 'Écrire au support…', onPosted: () => portalTicketView(el, { id }) })
        )
      ),
      h('aside', { class: 'record-aside' },
        sideCard('Résumé', keyValues([
          ['Priorité', priorityBadge(t.priority)],
          ['Catégorie', t.category_label],
          ['Pris en charge par', t.assigned_to_name || 'En attente d’affectation'],
          ['Groupe', t.assignment_group_name],
          ['Ouvert le', formatDateTime(t.opened_at)],
          ['Résolu le', t.resolved_at ? formatDateTime(t.resolved_at) : null]
        ]))
      )
    )
  );
}
