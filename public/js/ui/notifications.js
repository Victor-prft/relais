import { h } from './dom.js';
import { icons } from './icons.js';

/** Cloche des notifications. Branchée sur l'API en phase 4. */
export function mountBell() {
  return h('button', { class: 'btn ghost icon bell', type: 'button', 'aria-label': 'Notifications' }, icons.bell());
}
