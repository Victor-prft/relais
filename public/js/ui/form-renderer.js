import { h } from './dom.js';
import { field, referenceInput } from './fields.js';

/**
 * Rendu d'un formulaire décrit en JSON (même format que lib/form-schema.js) :
 *   [{ name, label, type, required?, options?, min?, max?, help? }]
 * Renvoie { el, getValues(), markErrors(details) }.
 */
export function renderForm(schema, values = {}, { readOnly = false, columns = 2 } = {}) {
  const controls = {};

  const build = (f) => {
    const v = values?.[f.name];
    switch (f.type) {
      case 'textarea':
        return h('textarea', { class: 'input', rows: 4, value: v ?? '', readOnly });
      case 'number':
        return h('input', { class: 'input', type: 'number', value: v ?? '', min: f.min, max: f.max, readOnly });
      case 'date':
        return h('input', { class: 'input', type: 'date', value: v ?? '', readOnly });
      case 'select': {
        const select = h('select', { class: 'input', disabled: readOnly }, h('option', { value: '' }, '— Choisir —'));
        for (const o of f.options || []) select.append(h('option', { value: o, selected: o === v }, o));
        return select;
      }
      case 'checkbox':
        return h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', checked: v === true, disabled: readOnly }), f.label);
      case 'user':
        return referenceInput({ endpoint: '/api/users', value: v ? { id: v, label: values[`${f.name}__label`] || `#${v}` } : null, disabled: readOnly });
      case 'ci':
        return referenceInput({ endpoint: '/api/cis', value: v ? { id: v, label: values[`${f.name}__label`] || `#${v}` } : null, disabled: readOnly, labelOf: (c) => c.name, sublabelOf: (c) => c.class_label });
      default:
        return h('input', { class: 'input', type: 'text', value: v ?? '', readOnly });
    }
  };

  const el = h('div', { class: columns === 2 ? 'grid-2' : 'stack' },
    schema.map((f) => {
      const control = build(f);
      controls[f.name] = { f, control };
      if (f.type === 'checkbox') return h('div', { class: 'field', style: { justifyContent: 'flex-end' } }, control, f.help ? h('div', { class: 'hint' }, f.help) : null);
      return field(f.label, control, { required: f.required, hint: f.help, className: f.type === 'textarea' ? 'span-2' : '' });
    })
  );

  const getValues = () => {
    const out = {};
    for (const [name, { f, control }] of Object.entries(controls)) {
      if (f.type === 'checkbox') out[name] = control.querySelector('input').checked;
      else if (f.type === 'user' || f.type === 'ci') out[name] = control.getValue();
      else if (f.type === 'number') out[name] = control.value === '' ? null : Number(control.value);
      else out[name] = control.value === '' ? null : control.value;
    }
    return out;
  };

  const markErrors = (details = []) => {
    for (const { control } of Object.values(controls)) control.classList?.remove('invalid');
    for (const d of details) controls[d.path]?.control.classList?.add('invalid');
  };

  return { el, getValues, markErrors, controls };
}
