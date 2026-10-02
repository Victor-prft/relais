import { h } from '../ui/dom.js';
import { api } from '../api.js';
import { navigate } from '../router.js';

/** Résultats complémentaires de la recherche globale : CI (et articles, phase 8). */
export async function searchExtras(q) {
  const [cis, kb] = await Promise.all([api.get('/api/cis', { q, pageSize: 10 }).catch(() => ({ items: [] })), api.get('/api/kb', { q, status: 'all' }).catch(() => ({ items: [] }))]);
  return h('div', {}, h('section', { class: 'card', style: { marginTop: '16px' } },
    h('div', { class: 'card-head' }, h('h2', {}, 'Articles'), h('span', { class: 'badge' }, String(kb.items.length))),
    kb.items.length
      ? h('table', { class: 'table responsive' }, h('tbody', {}, kb.items.map((a) => h('tr', { class: 'clickable', onclick: () => navigate(`/kb/${a.id}`) }, h('td', {}, h('span', { class: 'number' }, a.number)), h('td', {}, a.title)))))
      : h('div', { class: 'empty' }, 'Aucun article.')
  ), h('section', { class: 'card', style: { marginTop: '16px' } },
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
  ));
}
