import { h, mount, loading } from '../../ui/dom.js';
import { icons } from '../../ui/icons.js';
import { api } from '../../api.js';
import { modal, toast, toastError, confirmDialog } from '../../ui/feedback.js';
import { field, textInput, textArea, selectInput, referenceInput, numberOrNull } from '../../ui/fields.js';
import { workflowBar, tabbed, keyValues, sideCard } from '../../ui/record.js';
import { activityPanel } from '../../ui/activity.js';
import { stateBadge, priorityBadge } from '../../ui/badges.js';
import { relationsPanel } from '../../ui/relations.js';
import { formatDateTime, LEVEL_LABELS, PRIORITY_LABELS } from '../../format.js';
import { navigate } from '../../router.js';
import { getGroups, getCategories, categoryOptions, cached } from '../../state.js';
import { setTitle } from '../../app.js';
import { incidentExtras } from './extras.js';

const getMeta = () => cached('incident-meta', () => api.get('/api/incidents/meta'));
const levelOptions = [1, 2, 3].map((v) => ({ value: v, label: LEVEL_LABELS[v] }));
const computePriority = (impact, urgency) => Number(impact) + Number(urgency) - 1;

/** Libellé du bouton d'une transition, selon l'état de départ. */
function transitionLabel(from, to) {
  if (to === 'in_progress') return from === 'resolved' ? 'Rouvrir' : from === 'on_hold' ? 'Reprendre' : 'Prendre en charge';
  return { on_hold: 'Mettre en attente', resolved: 'Résoudre', closed: 'Clore', canceled: 'Annuler l’incident' }[to] || null;
}

/** Fiche incident de la console (création et édition). */
export async function incidentFormView(el, { id }) {
  mount(el, loading());
  const isNew = id === 'new';
  const [meta, groups, categories, ticket] = await Promise.all([
    getMeta(),
    getGroups(),
    getCategories('incident'),
    isNew ? Promise.resolve(null) : api.get(`/api/incidents/${id}`)
  ]);
  render(el, { meta, groups, categories, ticket });
}

function render(el, { meta, groups, categories, ticket }) {
  const isNew = !ticket;
  const t = ticket || { impact: 3, urgency: 3, contact_type: 'phone', state: 'new', permissions: { edit: true, work_notes: true } };
  const editable = isNew || t.permissions.edit;
  setTitle(isNew ? 'Nouvel incident' : `${t.number} · ${t.title}`);

  // --- Contrôles --------------------------------------------------------
  const c = {
    requester_id: referenceInput({ endpoint: '/api/users', value: t.requester_id ? { id: t.requester_id, label: t.requester_name } : null, disabled: !editable }),
    contact_type: selectInput(Object.entries(meta.contact_types).map(([value, label]) => ({ value, label })), { value: t.contact_type, disabled: !editable }),
    category_id: selectInput(categoryOptions(categories), { value: t.category_id, empty: '— Choisir —', disabled: !editable }),
    impact: selectInput(levelOptions, { value: t.impact, disabled: !editable }),
    urgency: selectInput(levelOptions, { value: t.urgency, disabled: !editable }),
    assignment_group_id: selectInput(groups.filter((g) => g.is_active).map((g) => ({ value: g.id, label: g.name })), { value: t.assignment_group_id, empty: '— Aucun —', disabled: !editable }),
    assigned_to_id: referenceInput({
      endpoint: '/api/users',
      params: { staff: '1', group_id: t.assignment_group_id || undefined },
      value: t.assigned_to_id ? { id: t.assigned_to_id, label: t.assigned_to_name } : null,
      placeholder: 'Agent du groupe…',
      disabled: !editable
    }),
    title: textInput({ value: t.title, maxlength: 160, readOnly: !editable }),
    description: textArea({ value: t.description, rows: 6, maxlength: 8000, readOnly: !editable })
  };
  const priorityOut = h('div', { class: 'input', style: { display: 'flex', alignItems: 'center' }, 'aria-live': 'polite' }, priorityBadge(t.priority || computePriority(t.impact, t.urgency)));

  const readers = {
    requester_id: () => c.requester_id.getValue(),
    contact_type: () => c.contact_type.value,
    category_id: () => numberOrNull(c.category_id.value),
    impact: () => Number(c.impact.value),
    urgency: () => Number(c.urgency.value),
    assignment_group_id: () => numberOrNull(c.assignment_group_id.value),
    assigned_to_id: () => c.assigned_to_id.getValue(),
    title: () => c.title.value.trim(),
    description: () => c.description.value.trim() || null
  };

  const saveButton = h('button', { class: 'btn primary', type: 'button', disabled: !isNew }, icons.save({ size: 16 }), isNew ? 'Créer l’incident' : 'Enregistrer');

  /** Champs modifiés par rapport au ticket chargé. */
  const changes = () => {
    const out = {};
    for (const [key, read] of Object.entries(readers)) {
      const value = read();
      if (isNew || String(value ?? '') !== String(t[key] ?? '')) out[key] = value;
    }
    return out;
  };
  const onEdit = () => {
    priorityOut.replaceChildren(priorityBadge(computePriority(c.impact.value, c.urgency.value)));
    if (!isNew) saveButton.disabled = !Object.keys(changes()).length;
  };
  for (const control of Object.values(c)) {
    control.addEventListener('input', onEdit);
    control.addEventListener('change', onEdit);
  }
  c.assignment_group_id.addEventListener('change', () => c.assigned_to_id.setParams({ group_id: c.assignment_group_id.value || undefined }));
  // Les champs référence signalent leur choix sans événement natif : on observe les suggestions.
  for (const ref of [c.requester_id, c.assigned_to_id]) ref.addEventListener('mousedown', () => setTimeout(onEdit, 0));

  async function submit(extra = {}) {
    const payload = { ...changes(), ...extra };
    try {
      if (isNew) {
        if (!payload.title) return toastError({ message: 'Le titre est obligatoire' });
        const created = await api.post('/api/incidents', payload);
        toast(`${created.number} créé`);
        navigate(`/incidents/${created.id}`);
        return;
      }
      const updated = await api.patch(`/api/incidents/${t.id}`, { ...payload, version: t.version });
      toast('Incident enregistré');
      render(el, { meta, groups, categories, ticket: updated });
    } catch (err) {
      toastError(err);
      if (err.status === 409) {
        const reload = await confirmDialog('Quelqu’un a modifié ce ticket pendant que vous l’éditiez. Recharger la dernière version ? Vos modifications non enregistrées seront perdues.', { title: 'Conflit de modification', confirmLabel: 'Recharger' });
        if (reload) incidentFormView(el, { id: t.id });
      }
    }
  }
  saveButton.addEventListener('click', () => submit());

  async function transition(to) {
    if (to === 'on_hold') {
      const reason = selectInput(Object.entries(meta.on_hold_reasons).map(([value, label]) => ({ value, label })));
      const ok = await modal({
        title: 'Mettre en attente',
        build: (body) => body.append(field('Motif', reason, { required: true, hint: '« En attente du demandeur » repasse En cours dès qu’il répond.' })),
        actions: [{ label: 'Annuler', onClick: (close) => close(false) }, { label: 'Mettre en attente', class: 'primary', onClick: (close) => close(true) }]
      });
      if (ok) submit({ state: 'on_hold', on_hold_reason: reason.value });
      return;
    }
    if (to === 'resolved') {
      const code = selectInput(Object.entries(meta.resolution_codes).map(([value, label]) => ({ value, label })), { value: t.resolution_code });
      const notes = textArea({ value: t.resolution_notes, rows: 5, placeholder: 'Cause identifiée et action menée…' });
      const ok = await modal({
        title: 'Résoudre l’incident',
        build: (body) => body.append(h('div', { class: 'stack' }, field('Code de résolution', code, { required: true }), field('Notes de résolution', notes, { required: true, hint: 'Visibles du demandeur ; elles nourrissent la base de connaissances.' }))),
        actions: [
          { label: 'Annuler', onClick: (close) => close(false) },
          { label: 'Résoudre', class: 'primary', onClick: (close) => { if (!notes.value.trim()) { notes.classList.add('invalid'); return; } close(true); } }
        ]
      });
      if (ok) submit({ state: 'resolved', resolution_code: code.value, resolution_notes: notes.value.trim() });
      return;
    }
    if (to === 'canceled' && !(await confirmDialog('Annuler cet incident ? Il ne pourra plus être modifié.', { danger: true, confirmLabel: 'Annuler l’incident' }))) return;
    submit({ state: to });
  }

  // --- En-tête ----------------------------------------------------------
  const actions = isNew
    ? []
    : t.allowed_transitions
        .map((tr) => ({ ...tr, verb: transitionLabel(t.state, tr.state) }))
        .filter((tr) => tr.verb)
        .map((tr) => h('button', { class: `btn ${tr.state === 'canceled' ? 'danger' : ''}`, type: 'button', onclick: () => transition(tr.state) }, tr.verb));

  const head = h('div', { class: 'record-head' },
    h('div', { class: 'grow' },
      h('div', { class: 'row' }, isNew ? h('span', { class: 'number' }, 'Nouvel incident') : h('span', { class: 'number' }, t.number), !isNew ? stateBadge(t.state, t.state_label) : null, !isNew ? priorityBadge(t.priority) : null),
      h('h1', {}, isNew ? 'Déclarer un incident' : t.title)
    ),
    h('div', { class: 'btn-group' }, actions, incidentExtras(t), editable ? saveButton : null)
  );

  // --- Onglets ----------------------------------------------------------
  const details = (panel) => {
    mount(panel,
      t.state === 'on_hold' && t.on_hold_reason_label ? h('div', { class: 'callout warn', style: { marginBottom: '16px' } }, `En attente : ${t.on_hold_reason_label}`) : null,
      ['resolved', 'closed'].includes(t.state) && t.resolution_notes
        ? h('div', { class: 'callout', style: { marginBottom: '16px' } }, h('strong', {}, t.resolution_code_label || 'Résolution'), h('div', { style: { whiteSpace: 'pre-wrap' } }, t.resolution_notes))
        : null,
      h('div', { class: 'grid-2' },
        field('Demandeur', c.requester_id, { required: true }),
        field('Canal', c.contact_type),
        field('Catégorie', c.category_id),
        h('div', { class: 'grid-3 span-2' }, field('Impact', c.impact), field('Urgence', c.urgency), field('Priorité (calculée)', priorityOut)),
        field('Groupe d’assignation', c.assignment_group_id),
        field('Assigné à', c.assigned_to_id),
        field('Titre', c.title, { required: true, className: 'span-2' }),
        field('Description', c.description, { className: 'span-2' })
      )
    );
  };

  const tabs = isNew
    ? [{ id: 'details', label: 'Détails', render: details }]
    : [
        { id: 'details', label: 'Détails', render: details },
        {
          id: 'activity',
          label: 'Activité',
          render: (panel) =>
            panel.append(activityPanel({
              ticketId: t.id,
              canWorkNote: t.permissions.work_notes,
              onLoaded: (items) => tabsEl.setCount('activity', items.filter((i) => i.type !== 'audit').length),
              onPosted: async () => {
                const fresh = await api.get(`/api/incidents/${t.id}`);
                if (fresh.state !== t.state) render(el, { meta, groups, categories, ticket: fresh });
              }
            }))
        },
        { id: 'links', label: 'Liens', render: (panel) => panel.append(relationsPanel({ ticketId: t.id, canEdit: t.permissions.work_notes })) },
      ];
  const tabsEl = tabbed(tabs);

  const aside = isNew
    ? h('aside', { class: 'record-aside' }, sideCard('Priorité ITIL', h('p', { class: 'small muted' }, 'La priorité découle de l’impact (combien de personnes ?) et de l’urgence (à quel point est-ce bloquant ?).'), matrix()))
    : h('aside', { class: 'record-aside' },
        sideCard('Demandeur', keyValues([['Nom', t.requester_name], ['Email', t.requester_email], ['Service', t.requester_department]])),
        sideCard('Dates', keyValues([
          ['Ouvert', formatDateTime(t.opened_at)],
          ['Par', t.opened_by_name],
          ['Prise en charge', formatDateTime(t.first_response_at)],
          ['Résolu', formatDateTime(t.resolved_at)],
          ['Clos', formatDateTime(t.closed_at)],
          ['Réouvertures', String(t.reopen_count || 0)]
        ]))
      );

  mount(el,
    head,
    isNew || ['canceled'].includes(t.state) ? null : workflowBar(t.workflow_steps, t.workflow_step),
    h('div', { class: 'record' }, h('div', { class: 'card' }, tabsEl), aside)
  );
}

function matrix() {
  const rows = [1, 2, 3].map((impact) =>
    h('tr', {}, h('th', {}, `Impact ${impact}`), [1, 2, 3].map((urgency) => h('td', {}, priorityBadge(impact + urgency - 1, { short: true }))))
  );
  return h('table', { class: 'table', style: { fontSize: '12px' } },
    h('thead', {}, h('tr', {}, h('th', {}, ''), [1, 2, 3].map((u) => h('th', {}, `Urg. ${u}`)))),
    h('tbody', {}, rows),
    h('caption', { class: 'small faint', style: { captionSide: 'bottom', paddingTop: '6px' } }, Object.values(PRIORITY_LABELS).join(' · '))
  );
}
