import { h, mount, debounce, loading } from './dom.js';
import { icons } from './icons.js';
import { api } from '../api.js';
import { popover, promptDialog, toast, toastError } from './feedback.js';
import { referenceInput, selectInput } from './fields.js';

/**
 * Vue liste réutilisable : tri, filtres combinables, recherche, pagination,
 * colonnes choisies, vues enregistrées (par utilisateur, côté serveur).
 *
 *   listView({
 *     key: 'incidents',                     // clé des préférences et vues enregistrées
 *     endpoint: '/api/incidents',
 *     columns: [{ key, label, render?, sortable? }],
 *     defaultColumns: ['number', 'title', …],
 *     filterFields: [{ key, label, type: 'enum'|'user'|'group'|'date'|'text'|'number'|'bool', options? }],
 *     presets: [{ id, label, filters, sort?, dir? }],   // vues prédéfinies
 *     onOpen: (row) => …
 *   })
 */

const OP_LABELS = {
  eq: 'est',
  neq: 'n’est pas',
  in: 'parmi',
  nin: 'hors de',
  contains: 'contient',
  gte: 'depuis',
  lte: 'jusqu’au',
  empty: 'est vide',
  notempty: 'est renseigné'
};

const OPS_BY_TYPE = {
  enum: ['in', 'nin', 'empty', 'notempty'],
  number: ['in', 'nin', 'gte', 'lte'],
  user: ['eq', 'neq', 'empty', 'notempty'],
  group: ['in', 'nin', 'empty', 'notempty'],
  ref: ['eq', 'neq', 'empty', 'notempty'],
  text: ['contains', 'eq', 'empty', 'notempty'],
  date: ['gte', 'lte', 'empty', 'notempty'],
  bool: ['eq']
};

const SYMBOL_LABELS = { '@me': 'moi', '@mygroups': 'mes groupes' };

function storageGet(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}
function storageSet(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* navigation privée : l'état ne survit pas, sans gravité */
  }
}

export function listView(config) {
  const {
    key,
    endpoint,
    columns,
    defaultColumns,
    filterFields = [],
    presets = [],
    onOpen,
    emptyText = 'Aucun résultat',
    toolbarExtras = []
  } = config;

  const storeKey = `relais.list.${key}`;
  const saved = storageGet(storeKey);
  const state = {
    q: saved?.q || '',
    sort: saved?.sort || config.sort || null,
    dir: saved?.dir || config.dir || null,
    page: 1,
    pageSize: 25,
    filters: saved?.filters || presets[0]?.filters || [],
    view: saved?.view ?? presets[0]?.id ?? null,
    columns: defaultColumns
  };
  let savedViews = [];
  let lastResult = null;

  const root = h('div', { class: 'card list-view' });
  const search = h('input', { class: 'input search-input', type: 'search', placeholder: 'Rechercher…', value: state.q, 'aria-label': 'Rechercher' });
  const viewButton = h('button', { class: 'btn', type: 'button' });
  const chips = h('div', { class: 'chips' });
  const tableHost = h('div', { class: 'table-wrap' }, loading());
  const pager = h('div', { class: 'pager' });

  const persist = () => storageSet(storeKey, { q: state.q, sort: state.sort, dir: state.dir, filters: state.filters, view: state.view });

  const fieldLabel = (fieldKey) => filterFields.find((f) => f.key === fieldKey)?.label || fieldKey;

  function valueLabel(filter) {
    if (filter.label) return filter.label;
    const def = filterFields.find((f) => f.key === filter.field);
    const show = (v) => SYMBOL_LABELS[v] || def?.options?.find((o) => String(o.value) === String(v))?.label || String(v);
    if (filter.value === true) return 'oui';
    if (filter.value === false) return 'non';
    if (Array.isArray(filter.value)) return filter.value.map(show).join(', ');
    if (typeof filter.value === 'string' && filter.value.startsWith('@days:')) {
      const n = Number(filter.value.slice(6));
      return n === 0 ? 'aujourd’hui' : `${Math.abs(n)} j`;
    }
    return filter.value === undefined || filter.value === null ? '' : show(filter.value);
  }

  function renderChips() {
    mount(chips,
      state.filters.map((filter, index) =>
        h('span', { class: 'chip' },
          `${fieldLabel(filter.field)} ${OP_LABELS[filter.op]} ${valueLabel(filter)}`,
          h('button', {
            type: 'button',
            'aria-label': 'Retirer ce filtre',
            onclick: () => {
              state.filters.splice(index, 1);
              state.view = null;
              state.page = 1;
              refresh();
            }
          }, '×')
        )
      )
    );
  }

  function currentViewLabel() {
    const preset = presets.find((p) => p.id === state.view);
    if (preset) return preset.label;
    const sv = savedViews.find((v) => `saved:${v.id}` === state.view);
    if (sv) return sv.name;
    return state.filters.length ? 'Vue personnalisée' : 'Tous';
  }

  function applyView(view) {
    state.filters = structuredClone(view.filters || []);
    state.sort = view.sort || null;
    state.dir = view.dir || null;
    state.q = view.q || '';
    search.value = state.q;
    state.page = 1;
    refresh();
  }

  viewButton.addEventListener('click', () =>
    popover(viewButton, (pop, close) => {
      pop.classList.add('menu');
      for (const preset of presets) {
        pop.append(h('button', { type: 'button', onclick: () => { state.view = preset.id; applyView(preset); close(); } }, preset.label));
      }
      if (savedViews.length) {
        pop.append(h('div', { class: 'nav-section', style: { color: 'var(--text-faint)', padding: '8px 10px 2px' } }, 'Mes vues'));
        for (const sv of savedViews) {
          pop.append(
            h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '0' } },
              h('button', { type: 'button', onclick: () => { state.view = `saved:${sv.id}`; applyView(sv.query); close(); } }, sv.name),
              h('button', {
                type: 'button',
                class: 'btn ghost icon small',
                style: { width: '30px' },
                'aria-label': `Supprimer la vue ${sv.name}`,
                onclick: async () => {
                  await api.del(`/api/lists/filters/${sv.id}`).catch(toastError);
                  await loadPreferences();
                  close();
                }
              }, icons.trash({ size: 15 }))
            )
          );
        }
      }
      pop.append(
        h('hr', { style: { margin: '4px 0' } }),
        h('button', {
          type: 'button',
          onclick: async () => {
            close();
            const name = await promptDialog({ title: 'Enregistrer la vue', label: 'Nom de la vue', multiline: false });
            if (!name) return;
            try {
              const query = { q: state.q || undefined, sort: state.sort || undefined, dir: state.dir || undefined, filters: state.filters };
              const { id } = await api.post(`/api/lists/${key}/filters`, { name, query });
              await loadPreferences();
              state.view = `saved:${id}`;
              persist();
              renderToolbarState();
              toast('Vue enregistrée');
            } catch (err) {
              toastError(err);
            }
          }
        }, icons.save({ size: 16 }), 'Enregistrer la vue actuelle…')
      );
    })
  );

  /** Popover d'ajout d'un filtre : champ → opérateur → valeur. */
  function openFilterBuilder(anchor) {
    popover(anchor, (pop, close) => {
      pop.style.width = '320px';
      const fieldSelect = selectInput(filterFields.map((f) => ({ value: f.key, label: f.label })));
      const opHost = h('div');
      const valueHost = h('div');
      let opSelect;
      let valueControl;

      const renderValue = () => {
        const def = filterFields.find((f) => f.key === fieldSelect.value);
        const op = opSelect.value;
        valueControl = null;
        if (op === 'empty' || op === 'notempty') return mount(valueHost);
        if (def.type === 'enum' || def.type === 'number' || def.type === 'group') {
          const opts = def.options || [];
          const boxes = opts.map((o) => {
            const box = h('input', { type: 'checkbox', value: String(o.value) });
            return { box, o, el: h('label', { class: 'checkbox' }, box, o.label) };
          });
          if (def.type === 'group') {
            const mine = h('input', { type: 'checkbox', value: '@mygroups' });
            boxes.unshift({ box: mine, o: { value: '@mygroups', label: 'Mes groupes' }, el: h('label', { class: 'checkbox' }, mine, h('em', {}, 'Mes groupes')) });
          }
          if (def.type === 'number' && (op === 'gte' || op === 'lte')) {
            valueControl = { get: () => { const v = Number(single.value); return { value: v, label: String(v) }; } };
            const single = h('input', { class: 'input', type: 'number' });
            return mount(valueHost, single);
          }
          valueControl = {
            get: () => {
              const chosen = boxes.filter((b) => b.box.checked);
              if (!chosen.length) return null;
              if (chosen.some((b) => b.o.value === '@mygroups')) return { value: '@mygroups', label: 'mes groupes' };
              const values = chosen.map((b) => (def.type === 'enum' ? b.o.value : Number(b.o.value)));
              return { value: values, label: chosen.map((b) => b.o.label).join(', ') };
            }
          };
          return mount(valueHost, h('div', { class: 'stack', style: { maxHeight: '220px', overflowY: 'auto' } }, boxes.map((b) => b.el)));
        }
        if (def.type === 'user' || def.type === 'ref') {
          let me = null;
          const ref = referenceInput({ endpoint: def.endpoint || '/api/users', params: def.params || (def.type === 'user' ? { staff: '1' } : {}) });
          const meBox = h('input', { type: 'checkbox' });
          meBox.addEventListener('change', () => { me = meBox.checked; ref.input.disabled = me; });
          valueControl = {
            get: () => (me ? { value: '@me', label: 'moi' } : ref.getValue() ? { value: ref.getValue(), label: ref.input.value } : null)
          };
          return mount(valueHost, h('div', { class: 'stack' }, def.type === 'user' ? h('label', { class: 'checkbox' }, meBox, 'Moi') : null, ref));
        }
        if (def.type === 'date') {
          const quick = selectInput(
            [
              { value: '@days:0', label: 'Aujourd’hui (depuis minuit glissant)' },
              { value: '@days:-1', label: 'Dernières 24 h' },
              { value: '@days:-7', label: '7 derniers jours' },
              { value: '@days:-30', label: '30 derniers jours' },
              { value: '@days:7', label: 'D’ici 7 jours' },
              { value: 'custom', label: 'Date précise…' }
            ]
          );
          const date = h('input', { class: 'input hidden', type: 'date' });
          quick.addEventListener('change', () => date.classList.toggle('hidden', quick.value !== 'custom'));
          valueControl = {
            get: () => {
              if (quick.value !== 'custom') return { value: quick.value, label: quick.selectedOptions[0].textContent.toLowerCase() };
              if (!date.value) return null;
              const iso = new Date(`${date.value}T${op === 'lte' ? '23:59:59' : '00:00:00'}`).toISOString();
              return { value: iso, label: new Date(iso).toLocaleDateString('fr-FR') };
            }
          };
          return mount(valueHost, h('div', { class: 'stack' }, quick, date));
        }
        if (def.type === 'bool') {
          const sel = selectInput([{ value: 'true', label: 'Oui' }, { value: 'false', label: 'Non' }]);
          valueControl = { get: () => ({ value: sel.value === 'true', label: sel.value === 'true' ? 'oui' : 'non' }) };
          return mount(valueHost, sel);
        }
        const input = h('input', { class: 'input', type: 'text' });
        valueControl = { get: () => (input.value.trim() ? { value: input.value.trim(), label: `« ${input.value.trim()} »` } : null) };
        mount(valueHost, input);
        setTimeout(() => input.focus(), 0);
      };

      const renderOps = () => {
        const def = filterFields.find((f) => f.key === fieldSelect.value);
        opSelect = selectInput(OPS_BY_TYPE[def.type].map((op) => ({ value: op, label: OP_LABELS[op] })));
        opSelect.addEventListener('change', renderValue);
        mount(opHost, opSelect);
        renderValue();
      };
      fieldSelect.addEventListener('change', renderOps);

      pop.append(
        h('div', { class: 'stack' },
          h('div', { class: 'field' }, h('span', { class: 'label' }, 'Champ'), fieldSelect),
          h('div', { class: 'field' }, h('span', { class: 'label' }, 'Condition'), opHost),
          valueHost,
          h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
            h('button', { class: 'btn', type: 'button', onclick: close }, 'Annuler'),
            h('button', {
              class: 'btn primary',
              type: 'button',
              onclick: () => {
                const op = opSelect.value;
                let value = null;
                let label = '';
                if (op !== 'empty' && op !== 'notempty') {
                  const v = valueControl?.get();
                  if (!v) return;
                  ({ value, label } = v);
                }
                const def = filterFields.find((f) => f.key === fieldSelect.value);
                // Les champs « référence » côté client se filtrent sur la colonne *_id côté serveur.
                state.filters.push({ field: def.serverKey || def.key, op, value, label });
                state.view = null;
                state.page = 1;
                close();
                refresh();
              }
            }, 'Ajouter')
          )
        )
      );
      renderOps();
    });
  }

  function openColumnChooser(anchor) {
    popover(anchor, (pop, close) => {
      const boxes = columns.map((col) => {
        const box = h('input', { type: 'checkbox', checked: state.columns.includes(col.key) });
        return { col, box, el: h('label', { class: 'checkbox' }, box, col.label) };
      });
      pop.append(
        h('div', { class: 'stack' },
          h('strong', {}, 'Colonnes affichées'),
          h('div', { class: 'stack', style: { maxHeight: '300px', overflowY: 'auto' } }, boxes.map((b) => b.el)),
          h('div', { class: 'row', style: { justifyContent: 'space-between' } },
            h('button', { class: 'btn ghost small', type: 'button', onclick: () => { boxes.forEach((b) => { b.box.checked = defaultColumns.includes(b.col.key); }); } }, 'Par défaut'),
            h('button', {
              class: 'btn primary small',
              type: 'button',
              onclick: async () => {
                const chosen = boxes.filter((b) => b.box.checked).map((b) => b.col.key);
                if (!chosen.length) return;
                state.columns = chosen;
                close();
                renderTable();
                api.put(`/api/lists/${key}/preferences`, { columns: chosen, page_size: state.pageSize }).catch(toastError);
              }
            }, 'Appliquer')
          )
        )
      );
    });
  }

  function renderToolbarState() {
    mount(viewButton, icons.filter({ size: 16 }), currentViewLabel());
    renderChips();
  }

  function renderTable() {
    if (!lastResult) return;
    const visible = state.columns.map((k) => columns.find((c) => c.key === k)).filter(Boolean);
    if (!lastResult.items.length) {
      mount(tableHost, h('div', { class: 'empty' }, emptyText));
    } else {
      mount(tableHost,
        h('table', { class: 'table responsive' },
          h('thead', {}, h('tr', {}, visible.map((col) => {
            const sortable = col.sortable !== false;
            const active = lastResult.sort === col.key;
            const th = h('th', { class: sortable ? 'sortable' : '', 'aria-sort': active ? (lastResult.dir === 'desc' ? 'descending' : 'ascending') : null },
              col.label, active ? h('span', { class: 'arrow' }, lastResult.dir === 'desc' ? '▼' : '▲') : null);
            if (sortable) {
              th.addEventListener('click', () => {
                if (state.sort === col.key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
                else {
                  state.sort = col.key;
                  state.dir = col.defaultDir || 'asc';
                }
                refresh();
              });
            }
            return th;
          }))),
          h('tbody', {}, lastResult.items.map((row) => {
            const tr = h('tr', { class: onOpen ? 'clickable' : '' },
              visible.map((col) => {
                const value = col.render ? col.render(row) : row[col.key];
                return h('td', { 'data-label': col.label, class: col.className || '' }, value ?? '—');
              })
            );
            if (onOpen) {
              tr.tabIndex = 0;
              tr.addEventListener('click', (e) => { if (!e.target.closest('a, button')) onOpen(row); });
              tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') onOpen(row); });
            }
            return tr;
          }))
        )
      );
    }
    const { total, page, pageSize } = lastResult;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const sizeSelect = selectInput([10, 25, 50, 100].map((n) => ({ value: n, label: `${n} / page` })), { value: state.pageSize });
    sizeSelect.style.width = 'auto';
    sizeSelect.addEventListener('change', () => {
      state.pageSize = Number(sizeSelect.value);
      state.page = 1;
      refresh();
      api.put(`/api/lists/${key}/preferences`, { columns: state.columns, page_size: state.pageSize }).catch(() => {});
    });
    mount(pager,
      h('span', { class: 'small muted grow' }, `${total} résultat${total > 1 ? 's' : ''}`),
      sizeSelect,
      h('button', { class: 'btn small icon', type: 'button', disabled: page <= 1, 'aria-label': 'Page précédente', onclick: () => { state.page -= 1; refresh(); } }, icons.chevronLeft({ size: 16 })),
      h('span', { class: 'small' }, `${page} / ${pages}`),
      h('button', { class: 'btn small icon', type: 'button', disabled: page >= pages, 'aria-label': 'Page suivante', onclick: () => { state.page += 1; refresh(); } }, icons.chevronRight({ size: 16 }))
    );
  }

  let requestId = 0;
  async function refresh() {
    persist();
    renderToolbarState();
    const id = ++requestId;
    try {
      const result = await api.get(endpoint, {
        q: state.q,
        sort: state.sort,
        dir: state.dir,
        page: state.page,
        pageSize: state.pageSize,
        filters: state.filters.length ? state.filters.map(({ field, op, value }) => ({ field, op, value })) : undefined
      });
      if (id !== requestId) return; // une réponse plus récente est déjà là
      lastResult = result;
      renderTable();
    } catch (err) {
      if (id === requestId) mount(tableHost, h('div', { class: 'empty' }, err.message));
    }
  }

  async function loadPreferences() {
    try {
      const prefs = await api.get(`/api/lists/${key}`);
      if (prefs.columns?.length) state.columns = prefs.columns.filter((k) => columns.some((c) => c.key === k));
      state.pageSize = prefs.page_size || 25;
      savedViews = prefs.filters;
    } catch {
      /* préférences indisponibles : on garde les valeurs par défaut */
    }
    renderToolbarState();
  }

  search.addEventListener('input', debounce(() => {
    state.q = search.value.trim();
    state.page = 1;
    refresh();
  }, 300));

  const filterButton = h('button', { class: 'btn', type: 'button' }, icons.plus({ size: 16 }), 'Filtre');
  filterButton.addEventListener('click', () => openFilterBuilder(filterButton));
  const columnsButton = h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Colonnes', title: 'Colonnes' }, icons.columns());
  columnsButton.addEventListener('click', () => openColumnChooser(columnsButton));

  mount(root,
    h('div', { class: 'list-toolbar' },
      viewButton,
      search,
      filterFields.length ? filterButton : null,
      columnsButton,
      h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Actualiser', title: 'Actualiser', onclick: () => refresh() }, icons.refresh()),
      h('div', { class: 'grow' }),
      toolbarExtras
    ),
    chips,
    tableHost,
    pager
  );

  loadPreferences().then(refresh);
  root.refresh = refresh;
  return root;
}
