import { h, mount, loading } from '../../ui/dom.js';
import { icons } from '../../ui/icons.js';
import { api } from '../../api.js';
import { toast, toastError, confirmDialog } from '../../ui/feedback.js';
import { field, selectInput, referenceInput, numberOrNull } from '../../ui/fields.js';
import { listView } from '../../ui/list-view.js';
import { workflowBar, tabbed, keyValues, sideCard } from '../../ui/record.js';
import { activityPanel } from '../../ui/activity.js';
import { relationsPanel } from '../../ui/relations.js';
import { slaPanel, slaCell } from '../../ui/sla.js';
import { stateBadge, priorityBadge, personCell } from '../../ui/badges.js';
import { variablesBlock, approvalsBlock, tasksBlock } from '../../ui/request-parts.js';
import { formatRelative, formatDateTime, LEVEL_LABELS } from '../../format.js';
import { navigate } from '../../router.js';
import { getGroups, cached } from '../../state.js';
import { setTitle } from '../../app.js';

const getMeta = () => cached('request-meta', () => api.get('/api/requests/meta'));
const levelOptions = [1, 2, 3].map((v) => ({ value: v, label: LEVEL_LABELS[v] }));
const relative = (iso) => h('span', { title: formatDateTime(iso) }, formatRelative(iso));

// ---------------------------------------------------------------- Listes

export async function requestListView(el) {
  const [meta, groups] = await Promise.all([getMeta(), getGroups()]);
  const active = { field: 'active', op: 'eq', value: true, label: 'oui' };
  mount(el,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Demandes de service'), h('div', { class: 'sub' }, 'Commandes passées dans le catalogue'))),
    listView({
      key: 'requests',
      endpoint: '/api/requests',
      columns: [
        { key: 'number', label: 'Numéro', render: (r) => h('span', { class: 'number' }, r.number) },
        { key: 'title', label: 'Titre', className: 'title-cell' },
        { key: 'item', label: 'Article' },
        { key: 'state', label: 'État', render: (r) => stateBadge(r.state, meta.states[r.state]) },
        { key: 'approval_state', label: 'Approbation', render: (r) => meta.approval_states[r.approval_state] },
        { key: 'tasks_total', label: 'Tâches', sortable: false, render: (r) => (r.tasks_total ? `${r.tasks_done} / ${r.tasks_total}` : '—') },
        { key: 'sla', label: 'SLA', defaultDir: 'desc', render: (r) => slaCell(r) },
        { key: 'priority', label: 'Priorité', render: (r) => priorityBadge(r.priority) },
        { key: 'requester', label: 'Demandeur' },
        { key: 'requested_for', label: 'Bénéficiaire' },
        { key: 'assignment_group', label: 'Groupe' },
        { key: 'opened_at', label: 'Ouverte', defaultDir: 'desc', render: (r) => relative(r.opened_at) }
      ],
      defaultColumns: ['number', 'title', 'state', 'approval_state', 'tasks_total', 'sla', 'requested_for', 'opened_at'],
      filterFields: [
        { key: 'state', label: 'État', type: 'enum', options: Object.entries(meta.states).map(([value, label]) => ({ value, label })) },
        { key: 'approval_state', label: 'Approbation', type: 'enum', options: Object.entries(meta.approval_states).map(([value, label]) => ({ value, label })) },
        { key: 'assignment_group_id', label: 'Groupe', type: 'group', options: groups.map((g) => ({ value: g.id, label: g.name })) },
        { key: 'requester_id', label: 'Demandeur', type: 'ref', endpoint: '/api/users', params: {} },
        { key: 'opened_at', label: 'Date d’ouverture', type: 'date' },
        { key: 'active', label: 'Ouverte', type: 'bool' }
      ],
      presets: [
        { id: 'open', label: 'Demandes ouvertes', filters: [active] },
        { id: 'approval', label: 'En approbation', filters: [{ field: 'state', op: 'in', value: ['pending_approval'], label: 'En approbation' }] },
        { id: 'all', label: 'Toutes les demandes', filters: [] }
      ],
      onOpen: (row) => navigate(`/requests/${row.id}`)
    })
  );
}

export async function taskListView(el) {
  const [meta, groups] = await Promise.all([getMeta(), getGroups()]);
  const active = { field: 'active', op: 'eq', value: true, label: 'oui' };
  mount(el,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Tâches'), h('div', { class: 'sub' }, 'Ce qu’il reste à faire pour livrer les demandes'))),
    listView({
      key: 'tasks',
      endpoint: '/api/tasks',
      columns: [
        { key: 'number', label: 'Numéro', render: (r) => h('span', { class: 'number' }, r.number) },
        { key: 'title', label: 'Tâche', className: 'title-cell' },
        { key: 'parent_number', label: 'Demande', render: (r) => h('span', { class: 'number' }, r.parent_number) },
        { key: 'parent_title', label: 'Objet de la demande', className: 'title-cell' },
        { key: 'state', label: 'État', render: (r) => stateBadge(r.state, meta.task_states[r.state]) },
        { key: 'sequence', label: 'Étape' },
        { key: 'assigned_to', label: 'Assignée à', render: (r) => personCell(r.assigned_to) },
        { key: 'assignment_group', label: 'Groupe' },
        { key: 'priority', label: 'Priorité', render: (r) => priorityBadge(r.priority) },
        { key: 'opened_at', label: 'Créée', defaultDir: 'desc', render: (r) => relative(r.opened_at) }
      ],
      defaultColumns: ['number', 'title', 'parent_number', 'state', 'assigned_to', 'assignment_group', 'opened_at'],
      filterFields: [
        { key: 'state', label: 'État', type: 'enum', options: Object.entries(meta.task_states).map(([value, label]) => ({ value, label })) },
        { key: 'assigned_to_id', label: 'Assignée à', type: 'user' },
        { key: 'assignment_group_id', label: 'Groupe', type: 'group', options: groups.map((g) => ({ value: g.id, label: g.name })) },
        { key: 'active', label: 'À faire', type: 'bool' }
      ],
      presets: [
        { id: 'groups', label: 'File de mes groupes', filters: [active, { field: 'assignment_group_id', op: 'in', value: '@mygroups', label: 'mes groupes' }] },
        { id: 'mine', label: 'Mes tâches', filters: [active, { field: 'assigned_to_id', op: 'eq', value: '@me', label: 'moi' }] },
        { id: 'open', label: 'Tâches à faire', filters: [active] },
        { id: 'all', label: 'Toutes les tâches', filters: [] }
      ],
      onOpen: (row) => navigate(`/tasks/${row.id}`)
    })
  );
}

// ---------------------------------------------------------------- Fiches

/** Contrôles d'assignation communs (groupe + agent du groupe). */
function assignmentControls(t, editable) {
  return getGroups().then((groups) => {
    const group = selectInput(groups.filter((g) => g.is_active).map((g) => ({ value: g.id, label: g.name })), { value: t.assignment_group_id, empty: '— Aucun —', disabled: !editable });
    const agent = referenceInput({ endpoint: '/api/users', params: { staff: '1', group_id: t.assignment_group_id || undefined }, value: t.assigned_to_id ? { id: t.assigned_to_id, label: t.assigned_to_name } : null, disabled: !editable });
    group.addEventListener('change', () => agent.setParams({ group_id: group.value || undefined }));
    return { group, agent };
  });
}

function header(t, actions) {
  return h('div', { class: 'record-head' },
    h('div', { class: 'grow' },
      h('div', { class: 'row' }, h('span', { class: 'number' }, t.number), stateBadge(t.state, t.state_label), priorityBadge(t.priority)),
      h('h1', {}, t.title)
    ),
    h('div', { class: 'btn-group' }, actions)
  );
}

async function patchWith(url, t, payload, reload) {
  try {
    await api.patch(url, { ...payload, version: t.version });
    toast('Enregistré');
    reload();
  } catch (err) {
    toastError(err);
    if (err.status === 409) reload();
  }
}

export async function requestFormView(el, { id }) {
  mount(el, loading());
  const t = await api.get(`/api/requests/${id}`);
  setTitle(`${t.number} · ${t.title}`);
  const reload = () => requestFormView(el, { id });
  const editable = t.permissions.edit;
  const { group, agent } = await assignmentControls(t, editable);
  const impact = selectInput(levelOptions, { value: t.impact, disabled: !editable });
  const urgency = selectInput(levelOptions, { value: t.urgency, disabled: !editable });

  const save = h('button', { class: 'btn primary', type: 'button', onclick: () => patchWith(`/api/requests/${t.id}`, t, {
    assignment_group_id: numberOrNull(group.value), assigned_to_id: agent.getValue(), impact: Number(impact.value), urgency: Number(urgency.value)
  }, reload) }, icons.save({ size: 16 }), 'Enregistrer');

  const LABELS = { fulfilled: 'Marquer traitée', closed: 'Clore', canceled: 'Annuler la demande' };
  const actions = t.allowed_transitions.filter((tr) => LABELS[tr.state]).map((tr) =>
    h('button', {
      class: `btn ${tr.state === 'canceled' ? 'danger' : ''}`,
      type: 'button',
      onclick: async () => {
        if (tr.state === 'canceled' && !(await confirmDialog('Annuler cette demande et ses tâches en cours ?', { danger: true, confirmLabel: 'Annuler la demande' }))) return;
        patchWith(`/api/requests/${t.id}`, t, { state: tr.state }, reload);
      }
    }, LABELS[tr.state])
  );

  const tabs = tabbed([
    {
      id: 'details',
      label: 'Détails',
      render: (panel) => mount(panel,
        h('div', { class: 'grid-2' },
          field('Groupe de suivi', group),
          field('Agent', agent),
          h('div', { class: 'grid-3 span-2' }, field('Impact', impact), field('Urgence', urgency), field('Priorité', h('div', { class: 'input', style: { display: 'flex', alignItems: 'center' } }, priorityBadge(t.priority))))
        ),
        h('h4', { style: { marginTop: '24px' } }, `Formulaire : ${t.catalog_item?.name || '—'}`),
        variablesBlock(t) || h('p', { class: 'muted' }, 'Aucune réponse.')
      )
    },
    { id: 'tasks', label: 'Tâches', count: t.tasks.length, render: (panel) => panel.append(tasksBlock(t.tasks, { link: (task) => `/tasks/${task.id}` })) },
    { id: 'activity', label: 'Activité', render: (panel) => panel.append(activityPanel({ ticketId: t.id, canWorkNote: t.permissions.work_notes })) },
    { id: 'links', label: 'Liens', render: (panel) => panel.append(relationsPanel({ ticketId: t.id, canEdit: t.permissions.work_notes })) },
    { id: 'sla', label: 'SLA', render: (panel) => panel.append(slaPanel(t.id)) }
  ]);

  mount(el,
    header(t, [actions, editable ? save : null]),
    ['canceled', 'rejected'].includes(t.state) ? null : workflowBar(t.workflow_steps, t.workflow_step),
    h('div', { class: 'record' },
      h('div', { class: 'card' }, tabs),
      h('aside', { class: 'record-aside' },
        sideCard('Demande', keyValues([['Demandeur', t.requester_name], ['Bénéficiaire', t.requested_for_name], ['Article', t.catalog_item?.name], ['Ouverte', formatDateTime(t.opened_at)], ['Traitée', formatDateTime(t.resolved_at)]])),
        sideCard('Approbation', approvalsBlock(t.approvals))
      )
    )
  );
}

export async function taskFormView(el, { id }) {
  mount(el, loading());
  const t = await api.get(`/api/tasks/${id}`);
  setTitle(`${t.number} · ${t.title}`);
  const reload = () => taskFormView(el, { id });
  const editable = t.permissions.edit;
  const { group, agent } = await assignmentControls(t, editable);
  const LABELS = { in_progress: 'Prendre en charge', open: 'Remettre à traiter', closed_complete: 'Terminer', closed_incomplete: 'Non réalisable', canceled: 'Annuler' };
  const actions = t.allowed_transitions.filter((tr) => LABELS[tr.state]).map((tr) =>
    h('button', {
      class: `btn ${tr.state === 'closed_complete' ? 'primary' : tr.state === 'canceled' ? 'danger' : ''}`,
      type: 'button',
      onclick: async () => {
        if (tr.state === 'closed_incomplete' && !(await confirmDialog('Clore la tâche comme non réalisée ? Pensez à expliquer pourquoi dans une note.', { confirmLabel: 'Clore' }))) return;
        patchWith(`/api/tasks/${t.id}`, t, { state: tr.state }, reload);
      }
    }, LABELS[tr.state])
  );
  const save = h('button', { class: 'btn', type: 'button', onclick: () => patchWith(`/api/tasks/${t.id}`, t, { assignment_group_id: numberOrNull(group.value), assigned_to_id: agent.getValue() }, reload) }, icons.save({ size: 16 }), 'Enregistrer');

  const parent = t.parent;
  mount(el,
    header(t, [actions, editable ? save : null]),
    t.state === 'canceled' ? null : workflowBar(t.workflow_steps, t.workflow_step),
    t.state === 'pending' ? h('div', { class: 'callout', style: { marginBottom: '16px' } }, 'Cette tâche attend la fin de l’étape précédente de la demande.') : null,
    h('div', { class: 'record' },
      h('div', { class: 'stack' },
        h('section', { class: 'card card-body' },
          h('div', { class: 'grid-2' }, field('Groupe', group), field('Assignée à', agent)),
          t.description ? h('p', { style: { marginTop: '16px', whiteSpace: 'pre-wrap' } }, t.description) : null
        ),
        parent ? h('section', { class: 'card card-body' }, h('h3', {}, 'Ce qui est demandé'), variablesBlock(parent) || h('p', { class: 'muted' }, '—')) : null,
        h('section', { class: 'card card-body' }, h('h3', {}, 'Activité'), activityPanel({ ticketId: t.id, canWorkNote: true }))
      ),
      h('aside', { class: 'record-aside' },
        parent ? sideCard('Demande', keyValues([
          ['Numéro', h('a', { href: `#/requests/${parent.id}` }, parent.number)],
          ['Objet', parent.title],
          ['Bénéficiaire', parent.requested_for_name],
          ['État', stateBadge(parent.state, parent.state_label)]
        ])) : null,
        sideCard('Étapes de la demande', h('ul', { class: 'stack', style: { listStyle: 'none', padding: 0, margin: 0 } },
          t.siblings.map((s) => h('li', { class: 'row', style: { justifyContent: 'space-between' } }, s.id === t.id ? h('strong', {}, `${s.sequence}. ${s.title}`) : h('a', { href: `#/tasks/${s.id}` }, `${s.sequence}. ${s.title}`), stateBadge(s.state)))
        ))
      )
    )
  );
}
