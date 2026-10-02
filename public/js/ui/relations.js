import { h, mount, loading } from './dom.js';
import { api } from '../api.js';
import { toast, toastError } from './feedback.js';
import { selectInput } from './fields.js';
import { stateBadge, priorityBadge, TYPE_LABELS, ticketPath } from './badges.js';

const KIND_LABELS = {
  related: { out: 'Lié à', in: 'Lié à' },
  duplicate_of: { out: 'Doublon de', in: 'A pour doublon' },
  caused_by: { out: 'Causé par', in: 'A causé' },
  child: { out: 'Sous-ticket', in: 'Parent' }
};

/** Onglet « Liens » : tickets liés, enfants (tâches), ajout d'un lien par numéro. */
export function relationsPanel({ ticketId, canEdit }) {
  const list = h('div', {}, loading());

  async function load() {
    try {
      const { items } = await api.get(`/api/tickets/${ticketId}/relations`);
      if (!items.length) return mount(list, h('p', { class: 'muted' }, 'Aucun ticket lié.'));
      mount(list,
        h('table', { class: 'table responsive' },
          h('tbody', {}, items.map((r) =>
            h('tr', {},
              h('td', { 'data-label': 'Lien' }, KIND_LABELS[r.kind]?.[r.direction] || r.kind),
              h('td', { 'data-label': 'Ticket' }, h('a', { href: `#${ticketPath(r.type, r.id)}`, class: 'number' }, r.number), ' ', h('span', { class: 'faint small' }, TYPE_LABELS[r.type])),
              h('td', { 'data-label': 'Titre', class: 'title-cell' }, r.title),
              h('td', { 'data-label': 'Priorité' }, priorityBadge(r.priority, { short: true })),
              h('td', { 'data-label': 'État' }, stateBadge(r.state)),
              canEdit && r.direction === 'out' && r.kind !== 'child'
                ? h('td', {}, h('button', {
                    class: 'btn ghost small',
                    type: 'button',
                    onclick: async () => {
                      await api.del(`/api/tickets/${ticketId}/relations/${r.id}/${r.kind}`).catch(toastError);
                      load();
                    }
                  }, 'Retirer'))
                : h('td')
            )
          ))
        )
      );
    } catch (err) {
      mount(list, h('p', {}, err.message));
    }
  }

  let form = null;
  if (canEdit) {
    const number = h('input', { class: 'input', placeholder: 'INC0001001', style: { maxWidth: '180px' } });
    const kind = selectInput([{ value: 'related', label: 'Lié à' }, { value: 'duplicate_of', label: 'Doublon de' }, { value: 'caused_by', label: 'Causé par' }]);
    kind.style.width = 'auto';
    form = h('div', { class: 'row', style: { marginBottom: '12px' } },
      kind, number,
      h('button', {
        class: 'btn',
        type: 'button',
        onclick: async () => {
          if (!number.value.trim()) return;
          try {
            await api.post(`/api/tickets/${ticketId}/relations`, { number: number.value.trim(), kind: kind.value });
            number.value = '';
            toast('Lien ajouté');
            load();
          } catch (err) {
            toastError(err);
          }
        }
      }, 'Lier')
    );
  }
  load();
  return h('div', {}, form, list);
}
