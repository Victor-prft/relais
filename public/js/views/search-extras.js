import { h } from '../ui/dom.js';
import { api } from '../api.js';
import { navigate } from '../router.js';

/** Résultats complémentaires de la recherche globale : CI (et articles, phase 8). */
export async function searchExtras(q) {
  const cis = await api.get('/api/cis', { q, pageSize: 10 }).catch(() => ({ items: [] }));
  return h('section', { class: 'card', style: { marginTop: '16px' } },
    h('div', { class: 'card-head' }, h('h2', {}, 'Éléments de configuration'), h('span', { class: 'badge' }, String(cis.items.length))),
    cis.items.length
      ? h('table', { class: 'table responsive' }, h('tbody', {}, cis.items.map((ci) =>
          h('tr', { class: 'clickable', onclick: () => navigate(`/cmdb/${ci.id}`) },
            h('td', { 'data-label': 'Nom' }, h('strong', {}, ci.name)),
            h('td', { 'data-label': 'Classe' }, ci.class_label),
            h('td', { 'data-label': 'Groupe' }, ci.support_group || '—')
          )
        )))
      : h('div', { class: 'empty' }, 'Aucun CI.')
  );
}
