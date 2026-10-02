import { h, mount, loading } from '../ui/dom.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { stateBadge, priorityBadge, TYPE_LABELS, ticketPath } from '../ui/badges.js';
import { formatRelative } from '../format.js';
import { searchExtras } from './search-extras.js';

/** #/go/INC0001001 : ouvre la fiche du ticket portant ce numéro. */
export async function goView(el, { number }) {
  mount(el, loading('Recherche du ticket…'));
  try {
    const { id, type } = await api.get(`/api/tickets/by-number/${encodeURIComponent(number)}`);
    navigate(ticketPath(type, id));
  } catch (err) {
    mount(el, h('div', { class: 'empty' }, h('h2', {}, `${number} introuvable`), h('p', {}, err.message)));
  }
}

/** Recherche globale : tickets (+ articles et CI à partir des phases 3 et 8). */
export async function searchView(el, _params, { q = '' }) {
  mount(el, h('div', { class: 'page-head' }, h('h1', {}, `Recherche : « ${q} »`)), loading());
  const [tickets, extras] = await Promise.all([api.get('/api/tickets/search', { q }), searchExtras(q)]);
  mount(el,
    h('div', { class: 'page-head' }, h('h1', {}, `Recherche : « ${q} »`)),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Tickets'), h('span', { class: 'badge' }, String(tickets.items.length))),
      tickets.items.length
        ? h('table', { class: 'table responsive' }, h('tbody', {}, tickets.items.map((t) =>
            h('tr', { class: 'clickable', onclick: () => navigate(ticketPath(t.type, t.id)) },
              h('td', { 'data-label': 'Numéro' }, h('span', { class: 'number' }, t.number)),
              h('td', { 'data-label': 'Type' }, TYPE_LABELS[t.type]),
              h('td', { 'data-label': 'Titre', class: 'title-cell' }, t.title),
              h('td', { 'data-label': 'Priorité' }, priorityBadge(t.priority, { short: true })),
              h('td', { 'data-label': 'État' }, stateBadge(t.state)),
              h('td', { 'data-label': 'Ouvert' }, formatRelative(t.opened_at))
            )
          )))
        : h('div', { class: 'empty' }, 'Aucun ticket.')
    ),
    extras
  );
}
