import { h, mount } from '../../ui/dom.js';
import { icons } from '../../ui/icons.js';
import { api } from '../../api.js';
import { listView } from '../../ui/list-view.js';
import { navigate } from '../../router.js';
import { cached, getGroups } from '../../state.js';
import { formatRelative } from '../../format.js';

export const getCmdbMeta = () => cached('cmdb-meta', () => api.get('/api/cis/meta'));

const STATUS_TONES = { in_service: 'ok', maintenance: 'warn', planned: 'info', retired: '' };
export const ciStatusBadge = (status, label) => h('span', { class: `badge dot ${STATUS_TONES[status] ?? ''}` }, label);
export const criticalityBadge = (c, labels) => h('span', { class: `prio prio-${c === 1 ? 1 : c === 2 ? 3 : 5}` }, labels[c]);

export async function cmdbListView(el) {
  const [meta, groups] = await Promise.all([getCmdbMeta(), getGroups()]);
  const columns = [
    { key: 'name', label: 'Nom', render: (r) => h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: '8px' } }, (icons[r.class_icon] || icons.server)({ size: 16 }), h('strong', {}, r.name)) },
    { key: 'class_label', label: 'Classe' },
    { key: 'status', label: 'État', render: (r) => ciStatusBadge(r.status, meta.statuses[r.status]) },
    { key: 'environment', label: 'Environnement', render: (r) => meta.environments[r.environment] },
    { key: 'criticality', label: 'Criticité', render: (r) => criticalityBadge(r.criticality, meta.criticality) },
    { key: 'support_group', label: 'Groupe de support' },
    { key: 'owner', label: 'Responsable' },
    { key: 'location', label: 'Emplacement' },
    { key: 'open_incidents', label: 'Incidents ouverts', defaultDir: 'desc', render: (r) => (r.open_incidents ? h('span', { class: 'badge danger' }, String(r.open_incidents)) : h('span', { class: 'faint' }, '0')) },
    { key: 'relation_count', label: 'Relations', defaultDir: 'desc' },
    { key: 'updated_at', label: 'Mis à jour', defaultDir: 'desc', render: (r) => formatRelative(r.updated_at) }
  ];
  const filterFields = [
    { key: 'class_code', label: 'Classe', type: 'enum', options: meta.classes.map((c) => ({ value: c.code, label: c.label })) },
    { key: 'status', label: 'État', type: 'enum', options: Object.entries(meta.statuses).map(([value, label]) => ({ value, label })) },
    { key: 'environment', label: 'Environnement', type: 'enum', options: Object.entries(meta.environments).map(([value, label]) => ({ value, label })) },
    { key: 'criticality', label: 'Criticité', type: 'number', options: Object.entries(meta.criticality).map(([value, label]) => ({ value: Number(value), label })) },
    { key: 'support_group_id', label: 'Groupe de support', type: 'group', options: groups.map((g) => ({ value: g.id, label: g.name })) },
    { key: 'owner_id', label: 'Responsable', type: 'user' },
    { key: 'open_incidents', label: 'Incidents ouverts', type: 'number', options: [] },
    { key: 'location', label: 'Emplacement', type: 'text' }
  ];
  const presets = [
    { id: 'all', label: 'Tous les CI', filters: [{ field: 'status', op: 'nin', value: ['retired'], label: 'Retiré' }] },
    ...meta.classes.map((c) => ({ id: c.code, label: c.label, filters: [{ field: 'class_code', op: 'in', value: [c.code], label: c.label }] })),
    { id: 'incidents', label: 'Avec incidents ouverts', filters: [{ field: 'open_incidents', op: 'gte', value: 1, label: '1' }], sort: 'open_incidents', dir: 'desc' },
    { id: 'retired', label: 'Retirés', filters: [{ field: 'status', op: 'in', value: ['retired'], label: 'Retiré' }] }
  ];

  mount(el,
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'CMDB'), h('div', { class: 'sub' }, 'Éléments de configuration et leurs dépendances')),
      h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/cmdb/new' }, icons.plus(), 'Nouveau CI'))
    ),
    listView({
      key: 'cmdb',
      endpoint: '/api/cis',
      columns,
      defaultColumns: ['name', 'class_label', 'status', 'environment', 'criticality', 'support_group', 'open_incidents'],
      filterFields,
      presets,
      onOpen: (row) => navigate(`/cmdb/${row.id}`)
    })
  );
}
