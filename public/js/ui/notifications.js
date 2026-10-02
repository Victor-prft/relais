import { h, mount } from './dom.js';
import { icons } from './icons.js';
import { api } from '../api.js';
import { popover } from './feedback.js';
import { navigate } from '../router.js';
import { formatRelative } from '../format.js';
import { hasRole } from '../state.js';
import { ticketPath } from './badges.js';

const POLL_MS = 30000;
const TYPE_ICONS = {
  assigned: 'user',
  queue: 'inbox',
  comment: 'mail',
  state_changed: 'refresh',
  sla_at_risk: 'clock',
  sla_breached: 'alert',
  approval_requested: 'approve',
  approval_decided: 'approve'
};

function target(n) {
  if (!n.ticket_id) return null;
  return hasRole('agent') ? ticketPath(n.ticket_type, n.ticket_id) : `/portal/tickets/${n.ticket_id}`;
}

/** Cloche des notifications : compteur rafraîchi toutes les 30 s quand l'onglet est visible. */
export function mountBell() {
  const count = h('span', { class: 'count hidden' });
  const button = h('button', { class: 'btn ghost icon bell', type: 'button', 'aria-label': 'Notifications' }, icons.bell(), count);

  const paint = (unread) => {
    count.textContent = unread > 99 ? '99+' : String(unread);
    count.classList.toggle('hidden', !unread);
    button.setAttribute('aria-label', unread ? `Notifications (${unread} non lues)` : 'Notifications');
  };

  const poll = async () => {
    if (document.hidden || !button.isConnected) return;
    try {
      paint((await api.get('/api/notifications/unread-count')).unread);
    } catch {
      /* hors ligne : on réessaiera */
    }
  };
  const timer = setInterval(() => {
    if (!button.isConnected) return clearInterval(timer);
    poll();
  }, POLL_MS);
  document.addEventListener('visibilitychange', poll);
  setTimeout(poll, 0);

  button.addEventListener('click', () =>
    popover(button, async (pop, close) => {
      pop.classList.add('notif-panel');
      const list = h('div', {}, h('div', { class: 'loading' }, 'Chargement…'));
      const readAll = h('button', {
        class: 'btn ghost small',
        type: 'button',
        onclick: async () => {
          paint((await api.post('/api/notifications/read-all')).unread);
          list.querySelectorAll('.notif.unread').forEach((n) => n.classList.remove('unread'));
        }
      }, 'Tout marquer comme lu');
      pop.append(h('div', { class: 'head' }, h('strong', { class: 'grow' }, 'Notifications'), readAll), list);
      try {
        const { items, unread } = await api.get('/api/notifications');
        paint(unread);
        if (!items.length) return mount(list, h('div', { class: 'empty' }, 'Rien de neuf.'));
        mount(list,
          items.map((n) => {
            const link = target(n);
            return h('a', {
              class: `notif ${n.read_at ? '' : 'unread'}`,
              href: link ? `#${link}` : '#',
              onclick: async (e) => {
                e.preventDefault();
                close();
                if (!n.read_at) api.post(`/api/notifications/${n.id}/read`).then((r) => paint(r.unread)).catch(() => {});
                if (link) navigate(link);
              }
            },
              h('div', { class: 'row', style: { flexWrap: 'nowrap', alignItems: 'flex-start' } },
                h('span', { class: 'faint', style: { marginTop: '2px' } }, (icons[TYPE_ICONS[n.type]] || icons.bell)({ size: 16 })),
                h('div', { class: 'grow' },
                  h('div', { style: { fontWeight: n.read_at ? 500 : 650 } }, n.title),
                  n.body ? h('div', { class: 'small muted' }, n.body) : null,
                  h('div', { class: 'when' }, formatRelative(n.created_at))
                )
              )
            );
          })
        );
      } catch (err) {
        mount(list, h('div', { class: 'empty' }, err.message));
      }
    })
  );

  return button;
}
