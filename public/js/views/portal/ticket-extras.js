import { h } from '../../ui/dom.js';
import { variablesBlock } from '../../ui/request-parts.js';

/** Détails propres à un type dans la fiche portail : réponses au formulaire d'une demande. */
export function portalTicketExtras(t) {
  if (t.type !== 'request') return null;
  const vars = variablesBlock(t);
  return vars ? h('div', { style: { marginTop: '12px' } }, h('h4', {}, 'Votre demande'), vars) : null;
}
