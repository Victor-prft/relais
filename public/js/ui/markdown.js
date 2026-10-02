import { h } from './dom.js';

/**
 * Markdown → HTML assaini. C'est le seul endroit de l'application qui
 * injecte du HTML : marked produit le HTML, DOMPurify le nettoie (scripts,
 * attributs on*, liens javascript: retirés) avant insertion.
 */
export function renderMarkdown(md) {
  const el = h('div', { class: 'markdown' });
  if (!window.marked || !window.DOMPurify) {
    el.textContent = md || '';
    el.style.whiteSpace = 'pre-wrap';
    return el;
  }
  const html = window.marked.parse(md || '', { gfm: true, breaks: true });
  el.innerHTML = window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'iframe', 'form'], FORBID_ATTR: ['style'] });
  for (const a of el.querySelectorAll('a[href]')) {
    if (!a.getAttribute('href').startsWith('#')) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  }
  return el;
}

/** Extrait de recherche : les mots entourés de [[ ]] par FTS5 deviennent <mark>, sans innerHTML. */
export function highlighted(excerpt = '') {
  const el = h('span');
  const parts = String(excerpt).split(/\[\[|\]\]/);
  parts.forEach((part, i) => el.append(i % 2 ? h('mark', {}, part) : document.createTextNode(part.replace(/[#*_`>]/g, ''))));
  return el;
}
