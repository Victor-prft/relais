import { h, mount } from '../../ui/dom.js';
import { session } from '../../state.js';

export function portalHomeView(el) {
  mount(el,
    h('section', { class: 'hero' },
      h('h1', {}, `Bonjour ${session.user.full_name.split(' ')[0]}, comment pouvons-nous aider ?`),
      h('p', {}, 'Signalez un problème, demandez un équipement ou un accès, suivez vos demandes.')
    )
  );
}
