import { h, mount } from './dom.js';
import { icons } from './icons.js';
import { api } from '../api.js';
import { cached } from '../state.js';
import { formatRelative } from '../format.js';

const WAITING = { support: 'le support', requester: 'le demandeur', vendor: 'un fournisseur', nobody: 'personne' };

/**
 * Résumé IA d'un fil d'activité long (console). Bouton à la demande : on ne
 * paie pas un résumé que personne ne lit. Masqué si l'IA est désactivée ou
 * si le fil est trop court.
 */
export function aiSummaryCard(ticketId, entryCount) {
  const card = h('section', { class: 'card hidden' });
  if (entryCount < 5) return card;
  cached('ai-status', () => api.get('/api/ai/status')).then(({ enabled }) => {
    if (!enabled) return;
    card.classList.remove('hidden');
    const body = h('div', { class: 'card-body ai-summary small' });
    const button = h('button', { class: 'btn small', type: 'button' }, icons.sparkles({ size: 14 }), 'Résumer le fil');
    button.addEventListener('click', async () => {
      button.disabled = true;
      mount(body, h('div', { class: 'loading small' }, h('span', { class: 'spinner' }), 'Lecture du fil…'));
      try {
        const res = await api.post(`/api/ai/tickets/${ticketId}/summary`);
        if (!res.available) return mount(body, h('p', { class: 'muted' }, res.reason));
        const s = res.summary;
        mount(body,
          h('p', { style: { margin: 0 } }, s.situation),
          s.done.length ? [h('h4', { style: { margin: '10px 0 0' } }, 'Fait'), h('ul', {}, s.done.map((d) => h('li', {}, d)))] : null,
          s.next_steps.length ? [h('h4', { style: { margin: '10px 0 0' } }, 'À faire'), h('ul', {}, s.next_steps.map((d) => h('li', {}, d)))] : null,
          h('p', { class: 'faint', style: { margin: '10px 0 0' } }, `En attente de : ${WAITING[s.waiting_on]} · ${s.cached ? 'résumé en cache' : 'résumé'} ${formatRelative(s.created_at)}`)
        );
      } catch (err) {
        mount(body, h('p', { class: 'error' }, err.message));
      } finally {
        button.disabled = false;
      }
    });
    mount(card, h('div', { class: 'card-head' }, h('span', { class: 'ai-chip grow' }, icons.sparkles({ size: 14 }), 'Résumé IA'), button), body);
  }).catch(() => {});
  return card;
}
