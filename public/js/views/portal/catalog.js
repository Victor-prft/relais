import { h, mount, loading } from '../../ui/dom.js';
import { icons } from '../../ui/icons.js';
import { api } from '../../api.js';
import { toast, toastError } from '../../ui/feedback.js';
import { field, referenceInput } from '../../ui/fields.js';
import { renderForm } from '../../ui/form-renderer.js';
import { navigate } from '../../router.js';
import { setTitle } from '../../app.js';
import { session } from '../../state.js';

/** Catalogue des services (portail). */
export async function portalCatalogView(el, _params, query) {
  mount(el, loading());
  const { items } = await api.get('/api/catalog/items');
  const categories = [...new Set(items.map((i) => i.category_name || 'Divers'))];
  let current = query.cat && categories.includes(query.cat) ? query.cat : null;
  const grid = h('div', { class: 'tiles' });
  const chips = h('div', { class: 'row', style: { marginBottom: '16px' } });

  const paint = () => {
    mount(chips,
      [null, ...categories].map((c) =>
        h('button', { class: `btn small ${c === current ? 'primary' : ''}`, type: 'button', onclick: () => { current = c; paint(); } }, c || 'Tout')
      )
    );
    mount(grid,
      items
        .filter((i) => !current || (i.category_name || 'Divers') === current)
        .map((i) =>
          h('a', { class: 'card tile', href: `#/portal/catalog/${i.id}` },
            h('div', { class: 'icon' }, (icons[i.icon] || icons.package)()),
            h('strong', {}, i.name),
            h('span', { class: 'small muted' }, i.short_description),
            h('div', { class: 'row small faint', style: { marginTop: 'auto' } },
              i.requires_approval ? h('span', { class: 'badge' }, 'Avec approbation') : null,
              i.delivery_days ? h('span', {}, `≈ ${i.delivery_days} j`) : null
            )
          )
        )
    );
  };
  paint();
  mount(el,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Catalogue des services'), h('div', { class: 'sub' }, 'Matériel, logiciels, accès : choisissez, remplissez, c’est parti.'))),
    chips,
    grid
  );
}

/** Commande d'un article. */
export async function portalCatalogItemView(el, { id }) {
  mount(el, loading());
  const item = await api.get(`/api/catalog/items/${id}`);
  setTitle(item.name);
  const form = renderForm(item.form_schema, {});
  let forOther = false;
  const beneficiary = referenceInput({ endpoint: '/api/users', placeholder: 'Rechercher un collègue…' });
  const benefField = field('Pour qui ?', beneficiary);
  benefField.classList.add('hidden');
  const forMe = h('input', { type: 'radio', name: 'for', checked: true });
  const forSomeone = h('input', { type: 'radio', name: 'for' });
  forMe.addEventListener('change', () => { forOther = false; benefField.classList.add('hidden'); });
  forSomeone.addEventListener('change', () => { forOther = true; benefField.classList.remove('hidden'); });

  const submit = h('button', { class: 'btn primary', type: 'submit', style: { height: '40px' } }, 'Envoyer la demande');
  const formEl = h('form', { class: 'card card-body stack', novalidate: true },
    h('div', { class: 'row' }, h('label', { class: 'checkbox' }, forMe, `Pour moi (${session.user.full_name})`), h('label', { class: 'checkbox' }, forSomeone, 'Pour quelqu’un d’autre')),
    benefField,
    item.form_schema.length ? form.el : null,
    item.requires_approval ? h('div', { class: 'callout small' }, 'Cette demande sera soumise à l’approbation du manager du bénéficiaire.') : null,
    h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('a', { class: 'btn ghost', href: '#/portal/catalog' }, 'Retour au catalogue'), submit)
  );
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      const values = Object.fromEntries(Object.entries(form.getValues()).filter(([, v]) => v !== null));
      const created = await api.post(`/api/catalog/items/${item.id}/order`, {
        requested_for_id: forOther ? beneficiary.getValue() : null,
        variables: values
      });
      toast(`Demande ${created.number} enregistrée`);
      navigate(`/portal/tickets/${created.id}`);
    } catch (err) {
      form.markErrors(err.details);
      toastError(err);
      submit.disabled = false;
    }
  });

  mount(el,
    h('p', {}, h('a', { href: '#/portal/catalog' }, '← Catalogue')),
    h('div', { class: 'record' },
      h('div', { class: 'stack' },
        h('div', { class: 'row' }, h('div', { class: 'tile', style: { padding: 0 } }, h('div', { class: 'icon' }, (icons[item.icon] || icons.package)())), h('h1', { style: { margin: 0 } }, item.name)),
        h('p', { class: 'muted' }, item.description || item.short_description),
        formEl
      ),
      h('aside', { class: 'record-aside' },
        h('section', { class: 'card card-body stack small' },
          h('strong', {}, 'Comment ça se passe ?'),
          h('ol', { style: { paddingLeft: '18px', margin: 0 } },
            item.requires_approval ? h('li', {}, 'Le manager du bénéficiaire approuve.') : null,
            item.tasks.map((t) => h('li', {}, `${t.title}${t.assignment_group_name ? ` (${t.assignment_group_name})` : ''}`)),
            h('li', {}, 'Vous êtes prévenu à chaque étape.')
          ),
          item.delivery_days ? h('div', { class: 'muted' }, `Délai habituel : ${item.delivery_days} jour(s) ouvré(s).`) : null
        )
      )
    )
  );
}
