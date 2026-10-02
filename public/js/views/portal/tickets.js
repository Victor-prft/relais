import { h, mount, loading } from '../../ui/dom.js';
import { api } from '../../api.js';
import { ticketRow } from './home.js';

/** « Mes tickets » : incidents et demandes du compte, ouverts puis récents. */
export async function portalTicketsView(el, _params, query) {
  const showClosed = query.closed === '1';
  const list = h('div', { class: 'stack' }, loading());
  mount(el,
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Mes tickets'), h('div', { class: 'sub' }, 'Incidents et demandes que vous avez ouverts')),
      h('div', { class: 'actions btn-group' },
        h('a', { class: `btn ${showClosed ? '' : 'primary'}`, href: '#/portal/tickets' }, 'En cours'),
        h('a', { class: `btn ${showClosed ? 'primary' : ''}`, href: '#/portal/tickets?closed=1' }, 'Terminés')
      )
    ),
    list
  );
  const { items } = await api.get('/api/portal/tickets', { open: showClosed ? '0' : '1', pageSize: 100 });
  mount(list, items.length ? items.map(ticketRow) : h('div', { class: 'card card-body muted' }, showClosed ? 'Aucun ticket terminé.' : 'Aucun ticket en cours.'));
}
