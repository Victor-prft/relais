import { h, mount, loading, debounce } from '../../ui/dom.js';
import { icons } from '../../ui/icons.js';
import { api } from '../../api.js';
import { toast, toastError } from '../../ui/feedback.js';
import { field, textInput, textArea, selectInput, numberOrNull } from '../../ui/fields.js';
import { renderForm } from '../../ui/form-renderer.js';
import { getGroups, getCategories, invalidate } from '../../state.js';
import { navigate } from '../../router.js';

const EXAMPLE = [
  { name: 'motif', label: 'Pourquoi en avez-vous besoin ?', type: 'textarea', required: true },
  { name: 'date', label: 'Pour quand ?', type: 'date' }
];

/** Liste des articles du catalogue (admin). */
export async function adminCatalogView(el) {
  mount(el, loading());
  const { items } = await api.get('/api/catalog/admin/items');
  mount(el,
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Catalogue de services'), h('div', { class: 'sub' }, 'Articles, formulaires et tâches de réalisation')),
      h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/admin/catalog/new' }, icons.plus(), 'Nouvel article'))
    ),
    h('div', { class: 'card table-wrap' },
      h('table', { class: 'table responsive' },
        h('thead', {}, h('tr', {}, ['Article', 'Catégorie', 'Approbation', 'Champs', 'Tâches', 'État'].map((t) => h('th', {}, t)))),
        h('tbody', {}, items.map((i) =>
          h('tr', { class: 'clickable', onclick: () => navigate(`/admin/catalog/${i.id}`) },
            h('td', { 'data-label': 'Article' }, h('strong', {}, i.name), h('div', { class: 'small muted' }, i.short_description)),
            h('td', { 'data-label': 'Catégorie' }, i.category_name || '—'),
            h('td', { 'data-label': 'Approbation' }, i.requires_approval ? 'Manager' : '—'),
            h('td', { 'data-label': 'Champs' }, String(i.form_schema.length)),
            h('td', { 'data-label': 'Tâches' }, String(i.tasks.length)),
            h('td', { 'data-label': 'État' }, i.is_active ? h('span', { class: 'badge ok dot' }, 'Publié') : h('span', { class: 'badge' }, 'Masqué'))
          )
        ))
      )
    )
  );
}

/** Édition d'un article : formulaire en JSON avec aperçu en direct, tâches par étape. */
export async function adminCatalogItemView(el, { id }) {
  mount(el, loading());
  const isNew = id === 'new';
  const [item, groups, categories] = await Promise.all([
    isNew ? null : api.get(`/api/catalog/items/${id}`),
    getGroups(),
    getCategories('catalog')
  ]);
  const i = item || { name: '', short_description: '', icon: 'package', form_schema: EXAMPLE, requires_approval: false, is_active: true, tasks: [] };
  const groupOptions = groups.map((g) => ({ value: g.id, label: g.name }));

  const c = {
    name: textInput({ value: i.name }),
    short_description: textInput({ value: i.short_description }),
    description: textArea({ value: i.description, rows: 3 }),
    category_id: selectInput(categories.map((k) => ({ value: k.id, label: k.name })), { value: i.category_id, empty: '—' }),
    icon: selectInput(['package', 'laptop', 'key', 'phone', 'app', 'network', 'mail', 'users', 'database'].map((v) => ({ value: v, label: v })), { value: i.icon }),
    fulfillment_group_id: selectInput(groupOptions, { value: i.fulfillment_group_id, empty: '—' }),
    delivery_days: textInput({ type: 'number', value: i.delivery_days ?? '' }),
    requires_approval: h('input', { type: 'checkbox', checked: i.requires_approval }),
    is_active: h('input', { type: 'checkbox', checked: i.is_active }),
    schema: h('textarea', { class: 'input mono', rows: 16, spellcheck: 'false', value: JSON.stringify(i.form_schema, null, 2) })
  };

  const preview = h('div');
  const schemaError = h('div', { class: 'error small' });
  const renderPreview = () => {
    try {
      const schema = JSON.parse(c.schema.value || '[]');
      if (!Array.isArray(schema)) throw new Error('Le formulaire doit être une liste de champs');
      mount(preview, schema.length ? renderForm(schema, {}).el : h('p', { class: 'muted small' }, 'Aucun champ.'));
      schemaError.textContent = '';
      c.schema.classList.remove('invalid');
    } catch (err) {
      schemaError.textContent = `JSON invalide : ${err.message}`;
      c.schema.classList.add('invalid');
    }
  };
  c.schema.addEventListener('input', debounce(renderPreview, 250));
  renderPreview();

  const taskRows = h('div', { class: 'stack' });
  const addTaskRow = (t = { sequence: 1, title: '', assignment_group_id: null }) => {
    const seq = h('input', { class: 'input', type: 'number', min: 1, max: 20, value: t.sequence, style: { width: '70px' } });
    const title = h('input', { class: 'input', value: t.title, placeholder: 'Ex. : Préparer le poste' });
    const group = selectInput(groupOptions, { value: t.assignment_group_id, empty: '— Groupe —' });
    const row = h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, seq, h('div', { class: 'grow' }, title), group,
      h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': 'Retirer', onclick: () => row.remove() }, icons.trash({ size: 16 })));
    row.read = () => ({ sequence: Number(seq.value) || 1, title: title.value.trim(), assignment_group_id: numberOrNull(group.value) });
    taskRows.append(row);
  };
  i.tasks.forEach(addTaskRow);

  const save = async () => {
    let schema;
    try {
      schema = JSON.parse(c.schema.value || '[]');
    } catch {
      return toastError({ message: 'Le formulaire n’est pas un JSON valide' });
    }
    const payload = {
      name: c.name.value.trim(),
      short_description: c.short_description.value.trim(),
      description: c.description.value.trim() || null,
      category_id: numberOrNull(c.category_id.value),
      icon: c.icon.value,
      fulfillment_group_id: numberOrNull(c.fulfillment_group_id.value),
      delivery_days: c.delivery_days.value === '' ? null : Number(c.delivery_days.value),
      requires_approval: c.requires_approval.checked,
      is_active: c.is_active.checked,
      form_schema: schema,
      tasks: [...taskRows.children].map((r) => r.read()).filter((t) => t.title)
    };
    try {
      const saved = isNew ? await api.post('/api/catalog/admin/items', payload) : await api.put(`/api/catalog/admin/items/${i.id}`, payload);
      invalidate('catalog');
      toast('Article enregistré');
      navigate(`/admin/catalog/${saved.id}`);
    } catch (err) {
      toastError(err);
    }
  };

  mount(el,
    h('p', {}, h('a', { href: '#/admin/catalog' }, '← Catalogue')),
    h('div', { class: 'record-head' }, h('h1', { class: 'grow' }, isNew ? 'Nouvel article' : i.name), h('button', { class: 'btn primary', type: 'button', onclick: save }, icons.save({ size: 16 }), 'Enregistrer')),
    h('div', { class: 'stack' },
      h('section', { class: 'card card-body grid-2' },
        field('Nom', c.name, { required: true }),
        field('Résumé', c.short_description, { required: true }),
        field('Description', c.description, { className: 'span-2' }),
        field('Catégorie', c.category_id),
        field('Icône', c.icon),
        field('Groupe de suivi', c.fulfillment_group_id),
        field('Délai habituel (jours)', c.delivery_days),
        h('label', { class: 'checkbox' }, c.requires_approval, 'Approbation du manager du bénéficiaire'),
        h('label', { class: 'checkbox' }, c.is_active, 'Publié dans le catalogue')
      ),
      h('section', { class: 'card card-body grid-2' },
        h('div', { class: 'field' },
          h('span', { class: 'label' }, 'Formulaire (JSON)'),
          c.schema,
          schemaError,
          h('div', { class: 'hint' }, 'Champs : name, label, type (text, textarea, number, date, select, checkbox, user, ci), required, options (select), min, max, help.')
        ),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Aperçu'), h('div', { class: 'card card-body', style: { background: 'var(--surface-2)' } }, preview))
      ),
      h('section', { class: 'card card-body stack' },
        h('div', { class: 'row' }, h('h3', { class: 'grow', style: { margin: 0 } }, 'Tâches de réalisation'), h('button', { class: 'btn small', type: 'button', onclick: () => addTaskRow() }, icons.plus({ size: 15 }), 'Tâche')),
        h('p', { class: 'small muted', style: { margin: 0 } }, 'Les tâches d’une même étape démarrent ensemble ; l’étape suivante commence quand toutes sont closes.'),
        taskRows
      )
    )
  );
}
