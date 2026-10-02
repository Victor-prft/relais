import { h, mount, loading } from '../../ui/dom.js';
import { icons } from '../../ui/icons.js';
import { api } from '../../api.js';
import { toast, toastError, modal } from '../../ui/feedback.js';
import { field, textInput, textArea, selectInput, referenceInput, numberOrNull } from '../../ui/fields.js';
import { renderForm } from '../../ui/form-renderer.js';
import { tabbed, keyValues, sideCard } from '../../ui/record.js';
import { ciGraph, graphLegend } from '../../ui/ci-graph.js';
import { stateBadge, priorityBadge, ticketPath } from '../../ui/badges.js';
import { formatDateTime, formatRelative } from '../../format.js';
import { navigate } from '../../router.js';
import { getGroups } from '../../state.js';
import { setTitle } from '../../app.js';
import { getCmdbMeta, ciStatusBadge, criticalityBadge } from './list.js';

const FIELD_LABELS = {
  _created: 'Création',
  _ci: 'Relation',
  name: 'Nom',
  status: 'État',
  environment: 'Environnement',
  criticality: 'Criticité',
  owner_id: 'Responsable',
  support_group_id: 'Groupe de support',
  location: 'Emplacement',
  description: 'Description',
  attributes: 'Attributs'
};

/** Fiche d'un élément de configuration. */
export async function ciFormView(el, { id }) {
  mount(el, loading());
  const isNew = id === 'new';
  const [meta, groups, ci] = await Promise.all([getCmdbMeta(), getGroups(), isNew ? null : api.get(`/api/cis/${id}`)]);
  render(el, { meta, groups, ci });
}

function render(el, { meta, groups, ci }) {
  const isNew = !ci;
  const c0 = ci || { status: 'in_service', environment: 'prod', criticality: 2, class_id: meta.classes[0].id, attributes: {} };
  setTitle(isNew ? 'Nouveau CI' : ci.name);

  const c = {
    name: textInput({ value: c0.name, maxlength: 80 }),
    class_id: selectInput(meta.classes.map((k) => ({ value: k.id, label: k.label })), { value: c0.class_id, disabled: !isNew }),
    status: selectInput(Object.entries(meta.statuses).map(([value, label]) => ({ value, label })), { value: c0.status }),
    environment: selectInput(Object.entries(meta.environments).map(([value, label]) => ({ value, label })), { value: c0.environment }),
    criticality: selectInput(Object.entries(meta.criticality).map(([value, label]) => ({ value, label })), { value: c0.criticality }),
    support_group_id: selectInput(groups.map((g) => ({ value: g.id, label: g.name })), { value: c0.support_group_id, empty: '— Aucun —' }),
    owner_id: referenceInput({ endpoint: '/api/users', value: c0.owner_id ? { id: c0.owner_id, label: c0.owner_name } : null }),
    location: textInput({ value: c0.location }),
    description: textArea({ value: c0.description, rows: 3 })
  };
  const attrsHost = h('div');
  let attrsForm;
  const renderAttrs = () => {
    const cls = meta.classes.find((k) => String(k.id) === String(c.class_id.value));
    attrsForm = renderForm(cls.attributes_schema, c0.attributes);
    mount(attrsHost, attrsForm.el);
  };
  c.class_id.addEventListener('change', renderAttrs);
  renderAttrs();

  async function save() {
    const payload = {
      name: c.name.value.trim(),
      class_id: Number(c.class_id.value),
      status: c.status.value,
      environment: c.environment.value,
      criticality: Number(c.criticality.value),
      support_group_id: numberOrNull(c.support_group_id.value),
      owner_id: c.owner_id.getValue(),
      location: c.location.value.trim() || null,
      description: c.description.value.trim() || null,
      attributes: attrsForm.getValues()
    };
    try {
      if (isNew) {
        const created = await api.post('/api/cis', payload);
        toast(`${created.name} créé`);
        navigate(`/cmdb/${created.id}`);
      } else {
        const { class_id: _ignored, ...patch } = payload;
        await api.patch(`/api/cis/${ci.id}`, patch);
        toast('CI enregistré');
        ciFormView(el, { id: ci.id });
      }
    } catch (err) {
      attrsForm.markErrors(err.details);
      toastError(err);
    }
  }

  const details = (panel) =>
    mount(panel,
      h('div', { class: 'grid-2' },
        field('Nom', c.name, { required: true }),
        field('Classe', c.class_id, { hint: isNew ? null : 'La classe ne change pas après création' }),
        field('État', c.status),
        field('Environnement', c.environment),
        field('Criticité', c.criticality),
        field('Groupe de support', c.support_group_id),
        field('Responsable', c.owner_id),
        field('Emplacement', c.location),
        field('Description', c.description, { className: 'span-2' })
      ),
      h('h4', { style: { marginTop: '24px' } }, 'Attributs de la classe'),
      attrsHost
    );

  const head = h('div', { class: 'record-head' },
    h('div', { class: 'grow' },
      h('div', { class: 'row' }, isNew ? h('span', { class: 'number' }, 'Nouvel élément') : [h('span', { class: 'badge' }, ci.class_label), ciStatusBadge(ci.status, meta.statuses[ci.status]), criticalityBadge(ci.criticality, meta.criticality)]),
      h('h1', {}, isNew ? 'Nouvel élément de configuration' : ci.name)
    ),
    h('div', { class: 'btn-group' },
      !isNew ? h('a', { class: 'btn', href: `#/incidents/new?ci=${ci.id}` }, icons.alert({ size: 16 }), 'Déclarer un incident') : null,
      h('button', { class: 'btn primary', type: 'button', onclick: save }, icons.save({ size: 16 }), isNew ? 'Créer' : 'Enregistrer')
    )
  );

  if (isNew) {
    mount(el, head, h('div', { class: 'card' }, tabbed([{ id: 'details', label: 'Détails', render: details }])));
    return;
  }

  const tabs = tabbed([
    { id: 'details', label: 'Détails', render: details },
    { id: 'relations', label: 'Relations', count: ci.relations.length, render: (panel) => relationsTab(panel, { ci, meta, reload: () => ciFormView(el, { id: ci.id }) }) },
    { id: 'incidents', label: 'Incidents', render: (panel) => ticketsTab(panel, ci.id, 'incident') },
    { id: 'changes', label: 'Changements', render: (panel) => ticketsTab(panel, ci.id, 'change') },
    { id: 'history', label: 'Historique', render: (panel) => historyTab(panel, ci.id) }
  ]);

  const impactHost = h('div', {}, loading());
  api.get(`/api/cis/${ci.id}/impact`).then(({ items }) => {
    mount(impactHost,
      items.length
        ? [
            h('p', { class: 'small muted' }, `Si ${ci.name} tombe, ${items.length} élément${items.length > 1 ? 's sont touchés' : ' est touché'} :`),
            h('ul', { class: 'stack', style: { listStyle: 'none', padding: 0, margin: 0 } },
              items.slice(0, 12).map((i) => h('li', { class: 'row', style: { gap: '6px' } }, h('a', { href: `#/cmdb/${i.id}` }, i.name), h('span', { class: 'small faint' }, `${i.class_label} · niveau ${i.depth}`)))),
            items.length > 12 ? h('p', { class: 'small faint' }, `… et ${items.length - 12} autres`) : null
          ]
        : h('p', { class: 'small muted' }, 'Aucun autre élément ne dépend de celui-ci.')
    );
  }).catch(() => mount(impactHost));

  mount(el,
    head,
    h('div', { class: 'record' },
      h('div', { class: 'card' }, tabs),
      h('aside', { class: 'record-aside' },
        sideCard('Analyse d’impact', impactHost),
        sideCard('Fiche', keyValues([
          ['Classe', ci.class_label],
          ['Groupe', ci.support_group_name],
          ['Responsable', ci.owner_name],
          ['Créé', formatDateTime(ci.created_at)],
          ['Mis à jour', formatRelative(ci.updated_at)]
        ]))
      )
    )
  );
}

function relationsTab(panel, { ci, meta, reload }) {
  const depthSelect = selectInput([1, 2, 3].map((d) => ({ value: d, label: `${d} niveau${d > 1 ? 'x' : ''}` })), { value: 2 });
  depthSelect.style.width = 'auto';
  const graphHost = h('div', { class: 'card', style: { overflow: 'hidden' } }, loading());
  const drawGraph = async () => {
    const graph = await api.get(`/api/cis/${ci.id}/graph`, { depth: depthSelect.value });
    mount(graphHost, ciGraph(graph));
  };
  depthSelect.addEventListener('change', drawGraph);

  const addRelation = async () => {
    const types = [];
    for (const t of meta.relation_types) {
      types.push({ value: `out:${t.code}`, label: `${ci.name} ${t.label} …` });
      types.push({ value: `in:${t.code}`, label: `… ${t.label} ${ci.name}` });
    }
    const typeSelect = selectInput(types);
    const target = referenceInput({ endpoint: '/api/cis', labelOf: (x) => x.name, sublabelOf: (x) => x.class_label, placeholder: 'Autre CI…' });
    await modal({
      title: 'Ajouter une relation',
      build: (body) => body.append(h('div', { class: 'stack' }, field('Relation', typeSelect), field('Élément', target, { required: true }))),
      actions: [
        { label: 'Annuler', onClick: (close) => close() },
        {
          label: 'Ajouter',
          class: 'primary',
          onClick: async (close) => {
            const [direction, type] = typeSelect.value.split(':');
            if (!target.getValue()) return;
            try {
              await api.post(`/api/cis/${ci.id}/relations`, { target_id: target.getValue(), type, direction });
              close();
              toast('Relation ajoutée');
              reload();
            } catch (err) {
              toastError(err);
            }
          }
        }
      ]
    });
  };

  mount(panel,
    h('div', { class: 'row', style: { marginBottom: '12px' } }, h('strong', { class: 'grow' }, 'Graphe des dépendances'), depthSelect, h('button', { class: 'btn', type: 'button', onclick: addRelation }, icons.plus({ size: 16 }), 'Relation')),
    graphHost,
    h('div', { style: { margin: '8px 0 20px' } }, graphLegend()),
    ci.relations.length
      ? h('table', { class: 'table responsive' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Relation'), h('th', {}, 'Élément'), h('th', {}, 'Classe'), h('th', {}, ''))),
          h('tbody', {}, ci.relations.map((r) =>
            h('tr', {},
              h('td', { 'data-label': 'Relation' }, r.direction === 'out' ? `${ci.name} ${r.label}` : `${r.label}`),
              h('td', { 'data-label': 'Élément' }, h('a', { href: `#/cmdb/${r.ci_id}` }, r.name)),
              h('td', { 'data-label': 'Classe' }, r.class_label),
              h('td', {}, h('button', {
                class: 'btn ghost small',
                type: 'button',
                onclick: async () => {
                  await api.del(`/api/cis/relations/${r.id}`).catch(toastError);
                  reload();
                }
              }, 'Retirer'))
            )
          ))
        )
      : h('p', { class: 'muted' }, 'Aucune relation.')
  );
  drawGraph().catch((err) => mount(graphHost, h('div', { class: 'empty' }, err.message)));
}

async function ticketsTab(panel, ciId, type) {
  mount(panel, loading());
  const { items } = await api.get(`/api/cis/${ciId}/tickets`, { type });
  if (!items.length) return mount(panel, h('p', { class: 'muted' }, type === 'incident' ? 'Aucun incident sur ce CI.' : 'Aucun changement sur ce CI.'));
  mount(panel,
    h('table', { class: 'table responsive' },
      h('thead', {}, h('tr', {}, ['Numéro', 'Titre', 'Priorité', 'État', 'Assigné à', 'Ouvert'].map((t) => h('th', {}, t)))),
      h('tbody', {}, items.map((t) =>
        h('tr', { class: 'clickable', onclick: () => navigate(ticketPath(t.type, t.id)) },
          h('td', { 'data-label': 'Numéro' }, h('span', { class: 'number' }, t.number)),
          h('td', { 'data-label': 'Titre', class: 'title-cell' }, t.title),
          h('td', { 'data-label': 'Priorité' }, priorityBadge(t.priority, { short: true })),
          h('td', { 'data-label': 'État' }, stateBadge(t.state)),
          h('td', { 'data-label': 'Assigné à' }, t.assigned_to || '—'),
          h('td', { 'data-label': 'Ouvert' }, formatRelative(t.opened_at))
        )
      ))
    )
  );
}

async function historyTab(panel, ciId) {
  mount(panel, loading());
  const { items } = await api.get(`/api/cis/${ciId}/history`);
  mount(panel,
    h('ol', { class: 'timeline' },
      items.map((a) =>
        h('li', { class: 'audit' },
          h('span', { class: 'dot' }),
          h('div', { class: 'meta' }, h('strong', {}, a.user_name || 'Système'), ' · ', formatRelative(a.created_at)),
          h('div', { class: 'small' },
            a.field.startsWith('_')
              ? a.new_display || FIELD_LABELS[a.field]
              : [`${FIELD_LABELS[a.field] || a.field} : `, a.field === 'attributes' ? h('em', {}, 'modifiés') : [a.old_display ? h('del', {}, a.old_display) : null, ' → ', h('strong', {}, a.new_display ?? '—')]]
          )
        )
      )
    )
  );
}
