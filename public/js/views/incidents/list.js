import { h, mount } from '../../ui/dom.js';
import { icons } from '../../ui/icons.js';
import { listView } from '../../ui/list-view.js';
import { stateBadge, priorityBadge, personCell, STATE_LABELS } from '../../ui/badges.js';
import { formatRelative, formatDateTime, PRIORITY_LABELS } from '../../format.js';
import { navigate } from '../../router.js';
import { getGroups, getCategories, categoryOptions } from '../../state.js';
import { slaCell } from '../../ui/sla.js';

const INCIDENT_STATES = ['new', 'assigned', 'in_progress', 'on_hold', 'resolved', 'closed', 'canceled'];

export const INCIDENT_COLUMNS = [
  { key: 'number', label: 'Numéro', render: (r) => h('span', { class: 'number' }, r.number) },
  { key: 'title', label: 'Titre', className: 'title-cell', render: (r) => h('span', { title: r.title }, r.title) },
  { key: 'priority', label: 'Priorité', render: (r) => priorityBadge(r.priority) },
  { key: 'state', label: 'État', render: (r) => stateBadge(r.state) },
  { key: 'sla', label: 'SLA', defaultDir: 'desc', render: (r) => slaCell(r) },
  { key: 'sla_due', label: 'Échéance SLA', render: (r) => (r.sla_due ? h('span', { title: formatDateTime(r.sla_due) }, formatRelative(r.sla_due)) : '—') },
  { key: 'assigned_to', label: 'Assigné à', render: (r) => personCell(r.assigned_to) },
  { key: 'assignment_group', label: 'Groupe' },
  { key: 'requester', label: 'Demandeur' },
  { key: 'category', label: 'Catégorie' },
  { key: 'ci', label: 'CI' },
  { key: 'impact', label: 'Impact' },
  { key: 'urgency', label: 'Urgence' },
  { key: 'contact_type', label: 'Canal' },
  { key: 'opened_at', label: 'Ouvert', defaultDir: 'desc', render: (r) => h('span', { title: formatDateTime(r.opened_at) }, formatRelative(r.opened_at)) },
  { key: 'updated_at', label: 'Mis à jour', defaultDir: 'desc', render: (r) => h('span', { title: formatDateTime(r.updated_at) }, formatRelative(r.updated_at)) },
  { key: 'resolved_at', label: 'Résolu', defaultDir: 'desc', render: (r) => (r.resolved_at ? formatDateTime(r.resolved_at) : '—') }
];

export async function incidentFilterFields() {
  const [groups, categories] = await Promise.all([getGroups(), getCategories('incident')]);
  return [
    { key: 'state', label: 'État', type: 'enum', options: INCIDENT_STATES.map((s) => ({ value: s, label: STATE_LABELS[s] })) },
    { key: 'priority', label: 'Priorité', type: 'number', options: [1, 2, 3, 4, 5].map((p) => ({ value: p, label: PRIORITY_LABELS[p] })) },
    { key: 'assigned_to_id', label: 'Assigné à', type: 'user' },
    { key: 'assignment_group_id', label: 'Groupe', type: 'group', options: groups.map((g) => ({ value: g.id, label: g.name })) },
    { key: 'requester_id', label: 'Demandeur', type: 'ref', endpoint: '/api/users', params: {} },
    { key: 'category_root_id', label: 'Catégorie', type: 'number', options: categories.filter((c) => !c.parent_id).map((c) => ({ value: c.id, label: c.name })) },
    { key: 'category_id', label: 'Sous-catégorie', type: 'number', options: categoryOptions(categories, { leavesOnly: true }) },
    { key: 'ci_id', label: 'CI', type: 'ref', endpoint: '/api/cis', params: {} },
    { key: 'opened_at', label: 'Date d’ouverture', type: 'date' },
    { key: 'resolved_at', label: 'Date de résolution', type: 'date' },
    { key: 'title', label: 'Titre', type: 'text' },
    { key: 'sla_breached', label: 'SLA dépassé', type: 'bool' },
    { key: 'active', label: 'Ouvert', type: 'bool' }
  ];
}

const ACTIVE = { field: 'active', op: 'eq', value: true, label: 'oui' };

export const INCIDENT_PRESETS = [
  { id: 'open', label: 'Incidents ouverts', filters: [ACTIVE] },
  { id: 'mine', label: 'Assignés à moi', filters: [ACTIVE, { field: 'assigned_to_id', op: 'eq', value: '@me', label: 'moi' }] },
  { id: 'groups', label: 'File de mes groupes', filters: [ACTIVE, { field: 'assignment_group_id', op: 'in', value: '@mygroups', label: 'mes groupes' }] },
  { id: 'unassigned', label: 'Non assignés', filters: [ACTIVE, { field: 'assigned_to_id', op: 'empty', value: null }] },
  { id: 'critical', label: 'P1 et P2 ouverts', filters: [ACTIVE, { field: 'priority', op: 'in', value: [1, 2], label: 'P1, P2' }] },
  { id: 'sla', label: 'SLA à risque ou dépassés', filters: [ACTIVE, { field: 'sla', op: 'gte', value: 0.75, label: '75 %' }], sort: 'sla', dir: 'desc' },
  { id: 'resolved', label: 'Résolus (7 jours)', filters: [{ field: 'resolved_at', op: 'gte', value: '@days:-7', label: '7 derniers jours' }], sort: 'resolved_at', dir: 'desc' },
  { id: 'all', label: 'Tous les incidents', filters: [] }
];

export async function incidentListView(el) {
  const filterFields = await incidentFilterFields();
  mount(el,
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Incidents'), h('div', { class: 'sub' }, 'Interruptions et dégradations de service')),
      h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/incidents/new' }, icons.plus(), 'Nouvel incident'))
    ),
    listView({
      key: 'incidents',
      endpoint: '/api/incidents',
      columns: INCIDENT_COLUMNS,
      defaultColumns: ['number', 'title', 'priority', 'state', 'sla', 'assigned_to', 'assignment_group', 'opened_at'],
      filterFields,
      presets: INCIDENT_PRESETS,
      onOpen: (row) => navigate(`/incidents/${row.id}`)
    })
  );
}
