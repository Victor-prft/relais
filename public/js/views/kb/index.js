import { h, mount, loading, debounce } from '../../ui/dom.js';
import { icons } from '../../ui/icons.js';
import { api } from '../../api.js';
import { toast, toastError } from '../../ui/feedback.js';
import { field, selectInput, numberOrNull } from '../../ui/fields.js';
import { renderMarkdown, highlighted } from '../../ui/markdown.js';
import { formatDate, formatRelative, formatDateTime } from '../../format.js';
import { navigate } from '../../router.js';
import { getCategories, hasRole } from '../../state.js';
import { setTitle } from '../../app.js';
import { ticketPath } from '../../ui/badges.js';

const STATUS = { draft: ['Brouillon', ''], published: ['Publié', 'ok'], retired: ['Retiré', 'warn'] };
const statusBadge = (s) => h('span', { class: `badge dot ${STATUS[s][1]}` }, STATUS[s][0]);

/** Carte d'article dans une liste ; `base` : préfixe de route (console ou portail). */
function articleCard(a, base) {
  return h('a', { class: 'card card-body kb-card', href: `#${base}/${a.id}` },
    h('div', { class: 'row small muted' }, h('span', { class: 'number' }, a.number), a.category_name ? h('span', { class: 'badge' }, a.category_name) : null, a.status !== 'published' ? statusBadge(a.status) : null, h('span', { class: 'grow' }), `${a.view_count} lecture${a.view_count > 1 ? 's' : ''}`),
    h('strong', {}, a.title),
    h('div', { class: 'small muted kb-excerpt' }, highlighted(a.excerpt || ''))
  );
}

/** Liste + recherche, commune à la console et au portail. */
function kbBrowser(el, { base, staff, query }) {
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Rechercher une solution : « vpn refusé », « imprimante »…', value: query.q || '', style: { maxWidth: '520px' } });
  const statusSelect = staff ? selectInput([{ value: 'published', label: 'Publiés' }, { value: 'draft', label: 'Brouillons' }, { value: 'retired', label: 'Retirés' }, { value: 'all', label: 'Tous' }], { value: query.status || 'published' }) : null;
  if (statusSelect) statusSelect.style.width = 'auto';
  const categorySelect = selectInput([], { empty: 'Toutes les catégories' });
  categorySelect.style.width = 'auto';
  const results = h('div', { class: 'stack' }, loading());

  getCategories('kb').then((cats) => {
    for (const c of cats) categorySelect.append(h('option', { value: c.id, selected: String(c.id) === query.category }, c.name));
  });

  const load = async () => {
    try {
      const { items } = await api.get('/api/kb', { q: search.value.trim(), status: statusSelect?.value, category_id: categorySelect.value || undefined });
      mount(results,
        items.length ? items.map((a) => articleCard(a, base)) : h('div', { class: 'card card-body muted' }, search.value.trim() ? 'Aucun article ne correspond. Essayez d’autres mots, ou signalez le problème au support.' : 'Aucun article.')
      );
    } catch (err) {
      mount(results, h('p', {}, err.message));
    }
  };
  search.addEventListener('input', debounce(load, 300));
  categorySelect.addEventListener('change', load);
  statusSelect?.addEventListener('change', load);
  load();
  return h('div', { class: 'stack' }, h('div', { class: 'row' }, search, categorySelect, statusSelect), results);
}

export function kbListView(el, _params, query) {
  mount(el,
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Base de connaissances'), h('div', { class: 'sub' }, 'Solutions rédigées par le support, consultables par tous')),
      h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/kb/new' }, icons.plus(), 'Nouvel article'))
    ),
    kbBrowser(el, { base: '/kb', staff: true, query })
  );
}

export function portalKbView(el, _params, query) {
  mount(el,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Trouver une réponse'), h('div', { class: 'sub' }, 'Les solutions aux problèmes les plus courants'))),
    kbBrowser(el, { base: '/portal/kb', staff: false, query }),
    h('p', { class: 'muted', style: { marginTop: '24px' } }, 'Pas de solution ? ', h('a', { href: '#/portal/incident/new' }, 'Signalez le problème au support.'))
  );
}

/** Lecture d'un article (console ou portail). */
export async function kbArticleView(el, { id }, _q, { portal = false } = {}) {
  mount(el, loading());
  const a = await api.get(`/api/kb/${id}`);
  setTitle(a.title);
  const back = portal ? '#/portal/kb' : '#/kb';
  mount(el,
    h('p', {}, h('a', { href: back }, '← Base de connaissances')),
    h('div', { class: 'record' },
      h('article', { class: 'card card-body' },
        h('div', { class: 'row small muted' }, h('span', { class: 'number' }, a.number), a.category_name ? h('span', { class: 'badge' }, a.category_name) : null, statusBadge(a.status)),
        h('h1', { style: { margin: '8px 0 16px' } }, a.title),
        renderMarkdown(a.body)
      ),
      h('aside', { class: 'record-aside' },
        h('section', { class: 'card card-body stack small' },
          h('div', {}, h('span', { class: 'muted' }, 'Mis à jour '), formatDate(a.updated_at)),
          a.author_name ? h('div', {}, h('span', { class: 'muted' }, 'Rédigé par '), a.author_name) : null,
          h('div', {}, `${a.view_count} lecture${a.view_count > 1 ? 's' : ''}`),
          !portal && a.source_ticket_id ? h('div', {}, h('span', { class: 'muted' }, 'Né de '), h('a', { href: `#${ticketPath(a.source_ticket_type, a.source_ticket_id)}` }, a.source_ticket_number)) : null,
          !portal && hasRole('agent') ? h('a', { class: 'btn', href: `#/kb/${a.id}/edit` }, icons.edit({ size: 16 }), 'Modifier') : null,
          portal ? h('a', { class: 'btn', href: '#/portal/incident/new' }, 'Le problème persiste ?') : null
        )
      )
    )
  );
}

/** Éditeur Markdown avec aperçu ; ?from=ID préremplit depuis un incident résolu. */
export async function kbEditorView(el, { id }, query) {
  mount(el, loading());
  const isNew = !id || id === 'new';
  const [categories, article] = await Promise.all([
    getCategories('kb'),
    isNew ? (query.from ? api.get(`/api/kb/draft-from-ticket/${encodeURIComponent(query.from)}`) : Promise.resolve({ title: '', body: '' })) : api.get(`/api/kb/${id}`)
  ]);
  setTitle(isNew ? 'Nouvel article' : `Modifier ${article.number}`);

  const title = h('input', { class: 'input', value: article.title, maxlength: 200 });
  const body = h('textarea', { class: 'input mono kb-editor', value: article.body, spellcheck: 'true' });
  const category = selectInput(categories.map((c) => ({ value: c.id, label: c.name })), { value: article.category_id, empty: '— Aucune —' });
  const preview = h('div', { class: 'card card-body kb-preview' });
  const paint = () => mount(preview, renderMarkdown(body.value || '_Aperçu…_'));
  body.addEventListener('input', debounce(paint, 200));
  paint();

  const save = async (status) => {
    const payload = { title: title.value.trim(), body: body.value, category_id: numberOrNull(category.value), status };
    try {
      const saved = isNew
        ? await api.post('/api/kb', { ...payload, source_ticket_id: article.source_ticket_id ?? undefined })
        : await api.patch(`/api/kb/${article.id}`, payload);
      toast(status === 'published' ? `${saved.number} publié` : 'Brouillon enregistré');
      navigate(`/kb/${saved.id}`);
    } catch (err) {
      toastError(err);
    }
  };

  mount(el,
    h('div', { class: 'record-head' },
      h('div', { class: 'grow' },
        h('div', { class: 'row small muted' }, isNew ? 'Nouvel article' : h('span', { class: 'number' }, article.number), article.source_ticket_number ? `à partir de ${article.source_ticket_number}` : null, !isNew ? statusBadge(article.status) : null),
        h('h1', {}, isNew ? 'Rédiger un article' : article.title)
      ),
      h('div', { class: 'btn-group' },
        !isNew && article.status === 'published' ? h('button', { class: 'btn danger', type: 'button', onclick: () => save('retired') }, 'Retirer') : null,
        h('button', { class: 'btn', type: 'button', onclick: () => save(isNew || article.status === 'draft' ? 'draft' : article.status) }, icons.save({ size: 16 }), 'Enregistrer'),
        isNew || article.status !== 'published' ? h('button', { class: 'btn primary', type: 'button', onclick: () => save('published') }, 'Publier') : null
      )
    ),
    h('div', { class: 'grid-2', style: { marginBottom: '16px' } }, field('Titre', title, { required: true }), field('Catégorie', category)),
    h('div', { class: 'kb-split' },
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Contenu (Markdown)'), body),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Aperçu'), preview)
    ),
    !isNew ? h('p', { class: 'small faint' }, `Dernière modification ${formatRelative(article.updated_at)} (${formatDateTime(article.updated_at)})`) : null
  );
}
