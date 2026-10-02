import { h, mount } from '../ui/dom.js';
import { session } from '../state.js';

export function homeView(el) {
  mount(el,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, `Bonjour ${session.user.full_name.split(' ')[0]}`), h('div', { class: 'sub' }, 'Le tableau de bord arrive en phase 5.')))
  );
}
