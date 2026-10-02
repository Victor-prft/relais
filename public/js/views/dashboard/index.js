import { h, mount, loading, debounce } from '../../ui/dom.js';
import { icons } from '../../ui/icons.js';
import { api } from '../../api.js';
import { popover, toast, toastError, confirmDialog } from '../../ui/feedback.js';
import { session } from '../../state.js';
import { RENDERERS, CHART_WIDGETS } from './renderers.js';

/**
 * Tableau de bord Gridstack : widgets déplaçables et redimensionnables en mode
 * « Personnaliser », disposition enregistrée par utilisateur. Sur mobile, la
 * grille passe à une colonne et la disposition n'est pas réenregistrée (elle
 * écraserait celle du poste de travail).
 */
export async function dashboardView(el) {
  mount(el, loading());
  if (typeof window.GridStack !== 'function') {
    mount(el, h('div', { class: 'empty' }, 'Bibliothèque de grille indisponible.'));
    return undefined;
  }

  let { layout, widgets } = await api.get('/api/dashboard/layout');
  const narrow = matchMedia('(max-width: 900px)');
  if (narrow.matches) return stackedView(el, { layout, widgets, onWide: () => dashboardView(el) });
  const titles = Object.fromEntries(widgets.map((w) => [w.id, w.title]));
  const sizes = Object.fromEntries(widgets.map((w) => [w.id, w.size]));
  const cleanups = new Map();
  const tableMode = new Set();
  let editing = false;

  const gridEl = h('div', { class: 'grid-stack' });
  const editButton = h('button', { class: 'btn', type: 'button' }, icons.edit({ size: 16 }), 'Personnaliser');
  const addButton = h('button', { class: 'btn hidden', type: 'button' }, icons.plus({ size: 16 }), 'Ajouter un widget');
  const resetButton = h('button', { class: 'btn ghost hidden', type: 'button' }, 'Disposition par défaut');

  mount(el,
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, `Bonjour ${session.user.full_name.split(' ')[0]}`), h('div', { class: 'sub' }, 'Votre tableau de bord')),
      h('div', { class: 'actions btn-group' }, resetButton, addButton, editButton)
    ),
    gridEl
  );

  const grid = window.GridStack.init(
    {
      column: 12,
      cellHeight: 76,
      margin: 8,
      float: false,
      staticGrid: true,
      animate: true,
      handle: '.widget-head',
      columnOpts: { breakpointForWindow: true, breakpoints: [{ w: 900, c: 1 }] }
    },
    gridEl
  );

  async function loadWidget(id) {
    const item = gridEl.querySelector(`[gs-id="${id}"]`);
    const body = item?.querySelector('.widget-body');
    if (!body) return;
    cleanups.get(id)?.();
    cleanups.delete(id);
    try {
      const data = await api.get(`/api/dashboard/widgets/${id}`);
      mount(body);
      const cleanup = RENDERERS[id]?.(body, data, { table: tableMode.has(id) });
      if (typeof cleanup === 'function') cleanups.set(id, cleanup);
    } catch (err) {
      mount(body, h('div', { class: 'empty small' }, err.message));
    }
  }

  function widgetElement(item) {
    const id = item.id;
    const tableToggle = CHART_WIDGETS.has(id)
      ? h('button', {
          class: 'btn ghost icon small',
          type: 'button',
          title: 'Graphique / tableau',
          'aria-label': 'Basculer entre graphique et tableau',
          onclick: () => {
            if (tableMode.has(id)) tableMode.delete(id);
            else tableMode.add(id);
            loadWidget(id);
          }
        }, icons.columns({ size: 15 }))
      : null;
    const remove = h('button', {
      class: 'btn ghost icon small widget-remove',
      type: 'button',
      'aria-label': `Retirer ${titles[id]}`,
      onclick: () => {
        cleanups.get(id)?.();
        cleanups.delete(id);
        grid.removeWidget(wrapper);
        save();
      }
    }, icons.x({ size: 15 }));
    const wrapper = h('div', { class: 'grid-stack-item', 'gs-id': id, 'gs-x': item.x, 'gs-y': item.y, 'gs-w': item.w, 'gs-h': item.h, 'gs-min-w': 3, 'gs-min-h': 2 },
      h('div', { class: 'grid-stack-item-content widget card' },
        h('div', { class: 'widget-head' },
          h('h3', { class: 'grow' }, titles[id] || id),
          tableToggle,
          h('button', { class: 'btn ghost icon small', type: 'button', 'aria-label': 'Actualiser', title: 'Actualiser', onclick: () => loadWidget(id) }, icons.refresh({ size: 15 })),
          remove
        ),
        h('div', { class: 'widget-body' }, loading())
      )
    );
    if (item.auto) wrapper.setAttribute('gs-auto-position', 'true');
    return wrapper;
  }

  function addToGrid(item) {
    const node = widgetElement(item);
    gridEl.append(node);
    grid.makeWidget(node);
    loadWidget(item.id);
  }

  function renderAll() {
    for (const fn of cleanups.values()) fn();
    cleanups.clear();
    grid.removeAll(true);
    grid.batchUpdate();
    for (const item of layout) {
      const node = widgetElement(item);
      gridEl.append(node);
      grid.makeWidget(node);
    }
    grid.batchUpdate(false);
    layout.forEach((item) => loadWidget(item.id));
  }

  const save = debounce(async () => {
    if (grid.getColumn() !== 12) return;
    // Gridstack omet les valeurs par défaut (x/y à 0, w/h à 1) : on les rétablit.
    const items = grid.save(false).map(({ id, x = 0, y = 0, w = 1, h: height = 1 }) => ({ id, x, y, w, h: height }));
    layout = items;
    try {
      await api.put('/api/dashboard/layout', { layout: items });
    } catch (err) {
      toastError(err);
    }
  }, 500);
  grid.on('change', () => { if (editing) save(); });

  editButton.addEventListener('click', () => {
    editing = !editing;
    grid.setStatic(!editing);
    gridEl.classList.toggle('editing', editing);
    addButton.classList.toggle('hidden', !editing);
    resetButton.classList.toggle('hidden', !editing);
    mount(editButton, editing ? icons.save({ size: 16 }) : icons.edit({ size: 16 }), editing ? 'Terminer' : 'Personnaliser');
    if (!editing) toast('Disposition enregistrée');
  });

  addButton.addEventListener('click', () =>
    popover(addButton, (pop, close) => {
      pop.classList.add('menu');
      const present = new Set(grid.save(false).map((w) => w.id));
      const missing = widgets.filter((w) => !present.has(w.id));
      if (!missing.length) pop.append(h('div', { class: 'small muted', style: { padding: '8px' } }, 'Tous les widgets sont déjà affichés.'));
      for (const w of missing) {
        pop.append(h('button', {
          type: 'button',
          onclick: () => {
            close();
            addToGrid({ id: w.id, x: 0, y: 0, w: sizes[w.id].w, h: sizes[w.id].h, auto: true });
            save();
          }
        }, icons.plus({ size: 15 }), w.title));
      }
    })
  );

  resetButton.addEventListener('click', async () => {
    if (!(await confirmDialog('Revenir à la disposition par défaut de votre rôle ?', { confirmLabel: 'Réinitialiser' }))) return;
    layout = (await api.del('/api/dashboard/layout')).layout;
    renderAll();
  });

  renderAll();

  // Les graphiques lisent leurs couleurs dans les jetons : on les redessine au changement de thème.
  const redraw = debounce(() => layout.forEach((w) => CHART_WIDGETS.has(w.id) && loadWidget(w.id)), 50);
  const observer = new MutationObserver(redraw);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', redraw);
  // Passage en largeur mobile : on bascule sur la pile simple.
  const onNarrow = () => { if (narrow.matches) dashboardView(el); };
  narrow.addEventListener('change', onNarrow);

  // Données fraîches toutes les 2 minutes.
  const timer = setInterval(() => { if (!document.hidden && !editing) layout.forEach((w) => loadWidget(w.id)); }, 120000);

  return () => {
    clearInterval(timer);
    observer.disconnect();
    media.removeEventListener('change', redraw);
    narrow.removeEventListener('change', onNarrow);
    for (const fn of cleanups.values()) fn();
    grid.destroy(false);
  };
}

/**
 * Mobile : les widgets s'empilent à leur hauteur naturelle, dans l'ordre de
 * la grille (haut → bas, gauche → droite). La personnalisation reste sur poste.
 */
function stackedView(el, { layout, widgets, onWide }) {
  const titles = Object.fromEntries(widgets.map((w) => [w.id, w.title]));
  const cleanups = [];
  const ordered = [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
  mount(el,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, `Bonjour ${session.user.full_name.split(' ')[0]}`), h('div', { class: 'sub' }, 'Votre tableau de bord'))),
    h('div', { class: 'dash-stack' },
      ordered.map((item) => {
        const body = h('div', { class: 'widget-body' }, loading());
        api.get(`/api/dashboard/widgets/${item.id}`).then((data) => {
          mount(body);
          const cleanup = RENDERERS[item.id]?.(body, data, { table: false });
          if (typeof cleanup === 'function') cleanups.push(cleanup);
        }).catch((err) => mount(body, h('div', { class: 'empty small' }, err.message)));
        return h('section', { class: `widget card ${CHART_WIDGETS.has(item.id) ? 'chart' : ''}` }, h('div', { class: 'widget-head' }, h('h3', {}, titles[item.id])), body);
      })
    )
  );
  const narrow = matchMedia('(max-width: 900px)');
  const onChange = () => { if (!narrow.matches) onWide(); };
  narrow.addEventListener('change', onChange);
  return () => {
    narrow.removeEventListener('change', onChange);
    cleanups.forEach((fn) => fn());
  };
}
