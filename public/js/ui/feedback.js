import { h, append } from './dom.js';
import { icons } from './icons.js';

let toastHost;

export function toast(message, { type = 'info', timeout = 3500 } = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const el = h('div', { class: `toast ${type}` }, message);
  toastHost.append(el);
  setTimeout(() => el.remove(), timeout);
}

/** Affiche l'erreur d'un appel d'API (avec le détail de validation s'il existe). */
export function toastError(err) {
  const details = err?.details?.length ? ` — ${err.details.map((d) => `${d.path || 'champ'} : ${d.message}`).join(' ; ')}` : '';
  toast(`${err?.message || 'Erreur'}${details}`, { type: 'error', timeout: 6000 });
}

/**
 * Modale native <dialog>. `build(body, close)` remplit le corps ; renvoie une
 * promesse résolue par la valeur passée à close().
 */
export function modal({ title, wide = false, build, actions = [] }) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: `modal${wide ? ' wide' : ''}` });
    const close = (value = null) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    const body = h('div', { class: 'modal-body' });
    const foot = h('div', { class: 'modal-foot' });
    for (const action of actions) {
      foot.append(
        h('button', { class: `btn ${action.class || ''}`, type: 'button', onclick: () => action.onClick(close) }, action.label)
      );
    }
    append(dialog, [
      h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'btn ghost icon close', type: 'button', 'aria-label': 'Fermer', onclick: () => close(null) }, icons.x())),
      body,
      actions.length ? foot : null
    ]);
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    document.body.append(dialog);
    build?.(body, close);
    dialog.showModal();
  });
}

export function confirmDialog(message, { title = 'Confirmer', confirmLabel = 'Confirmer', danger = false } = {}) {
  return modal({
    title,
    build: (body) => body.append(h('p', {}, message)),
    actions: [
      { label: 'Annuler', onClick: (close) => close(false) },
      { label: confirmLabel, class: danger ? 'danger' : 'primary', onClick: (close) => close(true) }
    ]
  });
}

/** Demande un texte (motif, commentaire). Renvoie null si annulé. */
export function promptDialog({ title, label, required = true, multiline = true, value = '' }) {
  let input;
  return modal({
    title,
    build: (body) => {
      input = multiline
        ? h('textarea', { class: 'input', rows: 4, value })
        : h('input', { class: 'input', value });
      body.append(h('div', { class: 'field' }, h('label', {}, label), input));
      setTimeout(() => input.focus(), 0);
    },
    actions: [
      { label: 'Annuler', onClick: (close) => close(null) },
      {
        label: 'Valider',
        class: 'primary',
        onClick: (close) => {
          if (required && !input.value.trim()) {
            input.classList.add('invalid');
            return;
          }
          close(input.value.trim());
        }
      }
    ]
  });
}

/** Petit menu flottant ancré sous un élément. */
export function popover(anchor, build, { className = '' } = {}) {
  document.querySelectorAll('.popover').forEach((p) => p.remove());
  const pop = h('div', { class: `popover ${className}` });
  build(pop, () => pop.remove());
  document.body.append(pop);
  const rect = anchor.getBoundingClientRect();
  const width = pop.offsetWidth;
  const left = Math.max(8, Math.min(rect.left + window.scrollX, window.scrollX + window.innerWidth - width - 8));
  pop.style.left = `${left}px`;
  pop.style.top = `${rect.bottom + window.scrollY + 6}px`;
  const onDoc = (e) => {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) {
      pop.remove();
      document.removeEventListener('mousedown', onDoc);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
  return pop;
}
