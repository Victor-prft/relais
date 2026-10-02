import { h, mount } from '../../ui/dom.js';
import { icons } from '../../ui/icons.js';
import { api } from '../../api.js';
import { session } from '../../state.js';
import { navigate } from '../../router.js';
import { stateBadge, TYPE_LABELS } from '../../ui/badges.js';
import { formatRelative } from '../../format.js';

export const PORTAL_TILES = [
  { href: '#/portal/incident/new', icon: 'alert', title: 'Signaler un problème', text: 'Quelque chose ne fonctionne pas : poste, application, réseau, accès.' },
  { href: '#/portal/catalog', icon: 'package', title: 'Faire une demande', text: 'Matériel, logiciel, accès : le catalogue des services.' },
  { href: '#/portal/kb', icon: 'book', title: 'Trouver une réponse', text: 'Les solutions aux problèmes courants, rédigées par le support.' },
  { href: '#/portal/tickets', icon: 'inbox', title: 'Suivre mes tickets', text: 'Où en sont mes incidents et mes demandes.' }
];

export async function portalHomeView(el) {
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Décrivez votre problème ou cherchez une solution…', 'aria-label': 'Rechercher une solution' });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && search.value.trim()) navigate(`/portal/kb?q=${encodeURIComponent(search.value.trim())}`);
  });
  const recent = h('div', { class: 'stack' });

  mount(el,
    h('section', { class: 'hero' },
      h('h1', {}, `Bonjour ${session.user.full_name.split(' ')[0]}, comment pouvons-nous aider ?`),
      h('p', {}, 'Signalez un problème, demandez un équipement ou un accès, suivez vos demandes.'),
      search
    ),
    h('div', { class: 'tiles' },
      PORTAL_TILES.map((tile) =>
        h('a', { class: 'card tile', href: tile.href }, h('div', { class: 'icon' }, icons[tile.icon]()), h('strong', {}, tile.title), h('span', { class: 'small muted' }, tile.text))
      )
    ),
    h('h2', { style: { marginTop: '32px' } }, 'Mes tickets en cours'),
    recent
  );

  try {
    const { items } = await api.get('/api/portal/tickets', { open: '1', pageSize: 5 });
    mount(recent,
      items.length
        ? items.map((t) => ticketRow(t))
        : h('div', { class: 'card card-body muted' }, 'Aucun ticket en cours. Tout va bien !')
    );
  } catch {
    mount(recent);
  }
}

export function ticketRow(t) {
  return h('a', { class: 'card card-body row', href: `#/portal/tickets/${t.id}`, style: { color: 'inherit', textDecoration: 'none' } },
    h('div', { class: 'grow' },
      h('div', { class: 'row small muted' }, h('span', { class: 'number' }, t.number), TYPE_LABELS[t.type], '·', formatRelative(t.updated_at)),
      h('strong', {}, t.title)
    ),
    stateBadge(t.state)
  );
}
