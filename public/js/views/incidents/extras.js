import { h } from '../../ui/dom.js';
import { icons } from '../../ui/icons.js';

/** Actions supplémentaires de la fiche incident : capitaliser une résolution en article. */
export function incidentExtras(t) {
  if (!t?.id || !['resolved', 'closed'].includes(t.state) || !t.resolution_notes) return null;
  return h('a', { class: 'btn', href: `#/kb/new?from=${t.id}`, title: 'Rédiger un article de la base de connaissances à partir de cette résolution' }, icons.book({ size: 16 }), 'Créer un article');
}
