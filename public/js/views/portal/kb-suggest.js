import { h, mount, debounce } from '../../ui/dom.js';
import { icons } from '../../ui/icons.js';
import { api } from '../../api.js';

/**
 * Suggestions d'articles pendant la saisie d'un incident. La recherche plein
 * texte propose, l'IA (si disponible) ne garde que ce qui répond vraiment.
 * Appel après une pause de frappe, et seulement si le texte a changé.
 */
export function kbSuggestions(readText) {
  const el = h('div', { class: 'kb-suggestions hidden', 'aria-live': 'polite' });
  let last = '';
  let seq = 0;

  const refresh = debounce(async () => {
    const text = readText().trim();
    if (text.length < 12 || text === last) return;
    last = text;
    const id = ++seq;
    try {
      const { items, source } = await api.post('/api/ai/kb-suggest', { text });
      if (id !== seq) return;
      if (!items.length) {
        el.classList.add('hidden');
        return;
      }
      mount(el,
        h('div', { class: 'row small', style: { marginBottom: '4px' } }, icons.book({ size: 15 }), h('strong', {}, 'Ces articles résolvent peut-être votre problème'), source === 'ai' ? h('span', { class: 'ai-chip' }, icons.sparkles({ size: 13 }), 'triés par l’assistant') : null),
        items.map((a) => h('a', { href: `#/portal/kb/${a.id}`, target: '_blank' }, a.title))
      );
      el.classList.remove('hidden');
    } catch {
      /* suggestions facultatives : silence en cas d'échec */
    }
  }, 1100);

  return { el, refresh };
}
