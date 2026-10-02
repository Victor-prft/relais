import { h, mount, loading } from '../ui/dom.js';
import { api } from '../api.js';
import { toast, toastError, promptDialog } from '../ui/feedback.js';
import { priorityBadge, ticketPath, TYPE_LABELS } from '../ui/badges.js';
import { formatRelative, formatDateTime } from '../format.js';

/** Mes approbations : en attente (avec décision en un clic) et historique. */
export async function approvalsView(el, _params, query) {
  const decided = query.tab === 'decided';
  const list = h('div', { class: 'stack' }, loading());
  mount(el,
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Approbations'), h('div', { class: 'sub' }, 'Demandes de service et changements qui attendent votre avis')),
      h('div', { class: 'actions btn-group' },
        h('a', { class: `btn ${decided ? '' : 'primary'}`, href: '#/approvals' }, 'En attente'),
        h('a', { class: `btn ${decided ? 'primary' : ''}`, href: '#/approvals?tab=decided' }, 'Déjà traitées')
      )
    ),
    list
  );

  const load = async () => {
    const { items } = await api.get('/api/approvals', { state: decided ? 'decided' : 'requested' });
    if (!items.length) return mount(list, h('div', { class: 'card card-body muted' }, decided ? 'Aucune décision pour l’instant.' : 'Rien à approuver. Tout est à jour.'));
    mount(list, items.map((a) => card(a)));
  };

  const decide = async (a, decision) => {
    let comment = null;
    if (decision === 'rejected') {
      comment = await promptDialog({ title: `Refuser ${a.number}`, label: 'Motif du refus (transmis au demandeur)' });
      if (!comment) return;
    }
    try {
      await api.post(`/api/approvals/${a.id}/decision`, { decision, comment });
      toast(decision === 'approved' ? `${a.number} approuvé` : `${a.number} refusé`);
      load();
    } catch (err) {
      toastError(err);
    }
  };

  const card = (a) =>
    h('section', { class: 'card card-body' },
      h('div', { class: 'row' },
        h('div', { class: 'grow' },
          h('div', { class: 'row small muted' }, h('a', { class: 'number', href: `#${ticketPath(a.type, a.ticket_id)}` }, a.number), h('span', { class: 'badge' }, TYPE_LABELS[a.type]), priorityBadge(a.priority, { short: true }), `demandé ${formatRelative(a.requested_at)}`),
          h('h3', { style: { margin: '4px 0' } }, a.title),
          h('div', { class: 'small muted' }, [a.requester ? `Par ${a.requester}` : null, a.requested_for && a.requested_for !== a.requester ? `pour ${a.requested_for}` : null].filter(Boolean).join(' ')),
          a.planned_start ? h('div', { class: 'small' }, `Fenêtre : ${formatDateTime(a.planned_start)} → ${formatDateTime(a.planned_end)} · risque ${a.risk}`) : null
        ),
        decided
          ? h('span', { class: `badge dot ${a.state === 'approved' ? 'ok' : 'danger'}` }, a.state === 'approved' ? 'Approuvé' : 'Refusé')
          : h('div', { class: 'btn-group' },
              h('button', { class: 'btn danger', type: 'button', onclick: () => decide(a, 'rejected') }, 'Refuser'),
              h('button', { class: 'btn primary', type: 'button', onclick: () => decide(a, 'approved') }, 'Approuver')
            )
      ),
      a.answers?.length
        ? h('dl', { class: 'kv', style: { marginTop: '10px' } }, a.answers.map(({ label, value }) => [h('dt', {}, label), h('dd', { style: { whiteSpace: 'pre-wrap' } }, typeof value === 'boolean' ? (value ? 'Oui' : 'Non') : String(value))]))
        : null,
      a.comment ? h('p', { class: 'small', style: { fontStyle: 'italic', margin: '8px 0 0' } }, `« ${a.comment} »`) : null
    );

  await load();
}
