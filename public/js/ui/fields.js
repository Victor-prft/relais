import { h, debounce } from './dom.js';
import { api } from '../api.js';

/** Champ libellé + contrôle + aide. */
export function field(label, control, { required = false, hint = null, className = '' } = {}) {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  const target = control.matches?.('input, select, textarea') ? control : control.querySelector?.('input, select, textarea');
  if (target && !target.id) target.id = id;
  return h('div', { class: `field ${className}` },
    h('label', { for: target?.id || id, class: required ? 'required' : '' }, label),
    control,
    hint ? h('div', { class: 'hint' }, hint) : null
  );
}

export function textInput({ value = '', placeholder = '', type = 'text', maxlength, required, readOnly } = {}) {
  return h('input', { class: 'input', type, value: value ?? '', placeholder, maxlength, required, readOnly });
}

export function textArea({ value = '', rows = 4, placeholder = '', maxlength, readOnly } = {}) {
  return h('textarea', { class: 'input', rows, placeholder, maxlength, readOnly, value: value ?? '' });
}

/** options : [{ value, label }] ; `empty` ajoute une option vide en tête. */
export function selectInput(options, { value = null, empty = null, disabled = false } = {}) {
  const select = h('select', { class: 'input', disabled });
  if (empty !== null) select.append(h('option', { value: '' }, empty));
  for (const opt of options) {
    select.append(h('option', { value: String(opt.value), selected: String(opt.value) === String(value ?? '') }, opt.label));
  }
  return select;
}

export const numberOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

/**
 * Champ « référence » : recherche dans une API et retient l'identifiant.
 *   referenceInput({ endpoint: '/api/users', value: { id, label }, onChange })
 * L'élément renvoyé expose getValue() → id | null et setValue({ id, label }).
 */
export function referenceInput({
  endpoint,
  params = {},
  value = null,
  placeholder = 'Rechercher…',
  labelOf = (item) => item.full_name || item.name || item.title,
  sublabelOf = (item) => item.email || item.class_label || item.number || '',
  onChange = () => {},
  disabled = false
}) {
  let selected = value?.id ? value : null;
  let items = [];
  let active = -1;

  const input = h('input', { class: 'input', type: 'text', placeholder, autocomplete: 'off', value: selected?.label || '', disabled });
  const list = h('div', { class: 'suggestions hidden', role: 'listbox' });
  const wrap = h('div', { class: 'reference' }, input, list);

  const hide = () => {
    list.classList.add('hidden');
    active = -1;
  };

  const choose = (item) => {
    selected = item ? { id: item.id, label: labelOf(item) } : null;
    input.value = selected?.label || '';
    hide();
    onChange(item || null);
  };

  const renderList = () => {
    list.replaceChildren(
      ...items.map((item, i) =>
        h('button', { type: 'button', class: i === active ? 'active' : '', onmousedown: (e) => { e.preventDefault(); choose(item); } },
          labelOf(item), sublabelOf(item) ? h('small', {}, sublabelOf(item)) : null)
      )
    );
    if (!items.length) list.append(h('div', { class: 'small muted', style: { padding: '8px 10px' } }, 'Aucun résultat'));
    list.classList.remove('hidden');
  };

  const search = debounce(async () => {
    try {
      const res = await api.get(endpoint, { ...params, q: input.value.trim() });
      items = res.items || [];
      active = -1;
      renderList();
    } catch {
      hide();
    }
  }, 200);

  input.addEventListener('input', () => {
    if (!input.value.trim()) {
      if (selected) choose(null);
      hide();
      return;
    }
    search();
  });
  input.addEventListener('focus', () => {
    if (!input.value) search();
  });
  input.addEventListener('blur', () => {
    setTimeout(hide, 120);
    // Texte modifié sans choisir : on revient à la valeur retenue.
    if (selected && input.value !== selected.label) input.value = selected.label;
    if (!selected) input.value = '';
  });
  input.addEventListener('keydown', (e) => {
    if (list.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); renderList(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); renderList(); e.preventDefault(); }
    if (e.key === 'Enter' && active >= 0) { choose(items[active]); e.preventDefault(); }
    if (e.key === 'Escape') hide();
  });

  wrap.getValue = () => selected?.id ?? null;
  wrap.setValue = (v) => {
    selected = v?.id ? v : null;
    input.value = selected?.label || '';
  };
  wrap.setParams = (p) => Object.assign(params, p);
  wrap.input = input;
  return wrap;
}

/** Lit un ensemble de contrôles nommés → objet. */
export function readControls(controls) {
  const out = {};
  for (const [key, control] of Object.entries(controls)) {
    if (typeof control.getValue === 'function') out[key] = control.getValue();
    else if (control.type === 'checkbox') out[key] = control.checked;
    else out[key] = control.value;
  }
  return out;
}
