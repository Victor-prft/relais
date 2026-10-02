import { h, mount } from './dom.js';

/**
 * Briques de la vue formulaire : frise d'avancement, onglets, carte latérale.
 */

/** Frise des étapes ; un état hors frise (annulé, rejeté…) grise tout. */
export function workflowBar(steps, current) {
  const index = steps.findIndex((s) => s.state === current);
  return h('div', { class: 'workflow', role: 'list', 'aria-label': 'Avancement' },
    steps.map((step, i) =>
      h('div', {
        role: 'listitem',
        class: `step ${index >= 0 && i < index ? 'done' : ''} ${i === index ? 'current' : ''}`,
        'aria-current': i === index ? 'step' : null
      }, step.label)
    )
  );
}

/**
 * Onglets. tabs : [{ id, label, count?, render(panel) }]. Le contenu d'un
 * onglet est construit à sa première ouverture, puis gardé.
 */
export function tabbed(tabs, { initial = tabs[0].id, onChange } = {}) {
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  const panels = h('div');
  const built = new Map();
  let active = null;

  const select = (id) => {
    active = id;
    for (const btn of bar.children) {
      const on = btn.dataset.tab === id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
    }
    for (const [tabId, panel] of built) panel.hidden = tabId !== id;
    if (!built.has(id)) {
      const tab = tabs.find((t) => t.id === id);
      const panel = h('div', { class: 'tab-panel', role: 'tabpanel' });
      built.set(id, panel);
      panels.append(panel);
      tab.render(panel);
    }
    onChange?.(id);
  };

  for (const tab of tabs) {
    const btn = h('button', { type: 'button', role: 'tab', onclick: () => select(tab.id) }, tab.label, tab.count ? h('span', { class: 'count' }, tab.count) : null);
    btn.dataset.tab = tab.id;
    bar.append(btn);
  }

  const el = h('div', {}, bar, panels);
  el.select = select;
  el.active = () => active;
  /** Reconstruit un onglet (après une mise à jour). */
  el.rebuild = (id) => {
    const panel = built.get(id);
    if (!panel) return;
    const tab = tabs.find((t) => t.id === id);
    mount(panel);
    tab.render(panel);
  };
  el.setCount = (id, count) => {
    const btn = [...bar.children].find((b) => b.dataset.tab === id);
    if (!btn) return;
    btn.querySelector('.count')?.remove();
    if (count) btn.append(h('span', { class: 'count' }, count));
  };
  select(initial);
  return el;
}

/** Liste clé/valeur pour la colonne latérale. */
export function keyValues(pairs) {
  return h('dl', { class: 'kv' }, pairs.filter(Boolean).map(([k, v]) => [h('dt', {}, k), h('dd', {}, v ?? '—')]));
}

export function sideCard(title, ...children) {
  return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, title)), h('div', { class: 'card-body' }, children));
}
