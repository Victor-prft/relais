import { h } from '../../ui/dom.js';

/** Suggestions d'articles pendant la saisie (phase 8). */
export function kbSuggestions() {
  return { el: h('div', { class: 'hidden' }), refresh: () => {} };
}
