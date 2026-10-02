import { h, mount, initials, loading } from './dom.js';
import { api } from '../api.js';
import { toastError } from './feedback.js';
import { formatRelative, formatDateTime } from '../format.js';

const FIELD_LABELS = {
  state: 'État',
  title: 'Titre',
  description: 'Description',
  impact: 'Impact',
  urgency: 'Urgence',
  priority: 'Priorité',
  requester_id: 'Demandeur',
  assignment_group_id: 'Groupe',
  assigned_to_id: 'Assigné à',
  category_id: 'Catégorie',
  ci_id: 'CI',
  on_hold_reason: 'Motif d’attente',
  resolution_code: 'Code de résolution',
  resolution_notes: 'Notes de résolution',
  contact_type: 'Canal',
  approval_state: 'Approbation',
  change_type: 'Type',
  risk: 'Risque',
  planned_start: 'Début prévu',
  planned_end: 'Fin prévue',
  justification: 'Justification',
  implementation_plan: 'Plan de mise en œuvre',
  backout_plan: 'Plan de retour arrière',
  test_plan: 'Plan de test',
  close_code: 'Code de clôture',
  requested_for_id: 'Bénéficiaire'
};

const EVENT_LABELS = {
  _created: (c) => `a créé le ticket${c.to ? ` (${c.to})` : ''}`,
  _link: (c) => `a ajouté un lien : ${c.to}`,
  _approval: (c) => c.to,
  _sla: (c) => c.to,
  _ci: (c) => c.to
};

function auditItem(item) {
  const events = item.changes.filter((c) => c.field.startsWith('_'));
  const fields = item.changes.filter((c) => !c.field.startsWith('_'));
  const long = new Set(['description', 'resolution_notes', 'justification', 'implementation_plan', 'backout_plan', 'test_plan']);
  return h('li', { class: 'audit' },
    h('span', { class: 'dot' }),
    h('div', { class: 'meta' },
      h('strong', {}, item.author_name || 'Système'), ' ',
      events.length ? events.map((e) => (EVENT_LABELS[e.field] || ((c) => c.to || e.field))(e)).join(' · ') : 'a modifié',
      ' · ', h('span', { title: formatDateTime(item.at) }, formatRelative(item.at))
    ),
    fields.length
      ? h('ul', { class: 'changes' },
          fields.map((c) =>
            h('li', {},
              h('span', {}, `${FIELD_LABELS[c.field] || c.field} : `),
              long.has(c.field)
                ? h('em', {}, c.to ? 'modifié' : 'effacé')
                : [c.from ? h('del', {}, c.from) : null, c.from ? ' → ' : '', h('strong', {}, c.to ?? '—')]
            )
          )
        )
      : null
  );
}

function journalItem(item) {
  return h('li', { class: item.type },
    h('span', { class: 'dot' }),
    h('div', { class: 'meta' },
      h('span', { class: 'avatar small', style: { marginRight: '6px' } }, initials(item.author_name || 'S')),
      h('strong', {}, item.author_name || 'Système'),
      item.type === 'work_note' ? h('span', { class: 'badge warn', style: { marginLeft: '6px' } }, 'Note interne') : null,
      ' · ', h('span', { title: formatDateTime(item.at) }, formatRelative(item.at))
    ),
    h('div', { class: 'bubble' }, item.body)
  );
}

/**
 * Fil d'activité + zone de saisie.
 *   activityPanel({ ticketId, canWorkNote, onPosted, compact })
 */
export function activityPanel({ ticketId, canWorkNote = false, onPosted = () => {}, onLoaded = () => {}, placeholder }) {
  let kind = 'comment';
  const textarea = h('textarea', { class: 'input', rows: 3, placeholder: placeholder || 'Écrire un commentaire visible du demandeur…' });
  const composer = h('div', { class: 'composer' });
  const switchEl = h('div', { class: 'switch', role: 'tablist' });
  const timeline = h('ol', { class: 'timeline' }, loading());

  const setKind = (k) => {
    kind = k;
    composer.classList.toggle('work-note', k === 'work_note');
    textarea.placeholder = k === 'work_note' ? 'Note interne, invisible du demandeur…' : placeholder || 'Écrire un commentaire visible du demandeur…';
    for (const b of switchEl.children) b.classList.toggle('active', b.dataset.kind === k);
  };

  if (canWorkNote) {
    for (const [k, label] of [['comment', 'Commentaire public'], ['work_note', 'Note interne']]) {
      const b = h('button', { type: 'button', onclick: () => setKind(k) }, label);
      b.dataset.kind = k;
      switchEl.append(b);
    }
  }

  const post = h('button', { class: 'btn primary', type: 'button' }, 'Publier');
  post.addEventListener('click', async () => {
    const body = textarea.value.trim();
    if (!body) return textarea.focus();
    post.disabled = true;
    try {
      await api.post(`/api/tickets/${ticketId}/journal`, { kind, body });
      textarea.value = '';
      await load();
      onPosted();
    } catch (err) {
      toastError(err);
    } finally {
      post.disabled = false;
    }
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) post.click();
  });

  mount(composer, canWorkNote ? switchEl : null, textarea, h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '8px' } }, h('span', { class: 'small faint grow' }, 'Ctrl + Entrée pour publier'), post));
  setKind('comment');

  async function load() {
    try {
      const { items } = await api.get(`/api/tickets/${ticketId}/activity`);
      mount(timeline, items.length ? items.map((item) => (item.type === 'audit' ? auditItem(item) : journalItem(item))) : h('li', { class: 'muted' }, 'Aucune activité.'));
      onLoaded(items);
    } catch (err) {
      mount(timeline, h('li', {}, err.message));
    }
  }

  const el = h('div', {}, composer, timeline);
  el.reload = load;
  load();
  return el;
}
