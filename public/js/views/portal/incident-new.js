import { h, mount } from '../../ui/dom.js';
import { api } from '../../api.js';
import { toast, toastError } from '../../ui/feedback.js';
import { field, textInput, textArea, selectInput, numberOrNull } from '../../ui/fields.js';
import { getCategories, categoryOptions } from '../../state.js';
import { navigate } from '../../router.js';
import { aiAssist } from './incident-ai.js';
import { kbSuggestions } from './kb-suggest.js';

/**
 * Déclaration d'incident côté portail. Pas de jargon ITIL : impact et urgence
 * sont posés sous forme de questions, la priorité se calcule côté serveur.
 */
const URGENCY = [
  { value: 1, label: 'Je suis bloqué(e), je ne peux pas travailler' },
  { value: 2, label: 'Je suis gêné(e), mais je peux avancer' },
  { value: 3, label: 'Ça peut attendre' }
];
const IMPACT = [
  { value: 3, label: 'Moi seul(e)' },
  { value: 2, label: 'Mon équipe ou mon service' },
  { value: 1, label: 'Toute l’entreprise, ou des clients' }
];

function radios(name, options, value) {
  const group = h('div', { class: 'stack', role: 'radiogroup' });
  for (const o of options) {
    group.append(h('label', { class: 'checkbox' }, h('input', { type: 'radio', name, value: o.value, checked: o.value === value }), o.label));
  }
  group.getValue = () => Number(group.querySelector('input:checked')?.value);
  group.setValue = (v) => {
    const input = group.querySelector(`input[value="${v}"]`);
    if (input) input.checked = true;
  };
  return group;
}

export async function portalIncidentNewView(el) {
  const categories = await getCategories('incident');
  const c = {
    title: textInput({ maxlength: 160, placeholder: 'Ex. : Impossible d’imprimer sur l’imprimante du 2e étage' }),
    description: textArea({ rows: 6, maxlength: 8000, placeholder: 'Que se passe-t-il ? Depuis quand ? Message d’erreur éventuel…' }),
    category_id: selectInput(categoryOptions(categories, { leavesOnly: true }), { empty: 'Je ne sais pas' }),
    urgency: radios('urgency', URGENCY, 2),
    impact: radios('impact', IMPACT, 3)
  };
  let contactType = 'portal';
  let ciId = null;

  const suggestions = kbSuggestions(() => `${c.title.value} ${c.description.value}`);
  c.title.addEventListener('input', suggestions.refresh);
  c.description.addEventListener('input', suggestions.refresh);

  // Pré-remplissage par l'assistant IA (formulaire de confirmation éditable).
  const assistant = aiAssist({
    onSuggestion: (s) => {
      c.title.value = s.title || '';
      c.description.value = s.description || '';
      if (s.category_id) c.category_id.value = String(s.category_id);
      if (s.urgency) c.urgency.setValue(s.urgency);
      if (s.impact) c.impact.setValue(s.impact);
      ciId = s.ci_id || null;
      contactType = 'ai';
      suggestions.refresh();
    }
  });

  const submit = h('button', { class: 'btn primary', type: 'submit', style: { height: '40px' } }, 'Envoyer au support');
  const form = h('form', { class: 'card card-body stack', novalidate: true },
    field('En une phrase, quel est le problème ?', c.title, { required: true }),
    field('Détails', c.description, { hint: 'Plus vous êtes précis, plus la résolution est rapide.' }),
    suggestions.el,
    h('div', { class: 'grid-2' },
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'À quel point êtes-vous gêné(e) ?'), c.urgency),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Qui est concerné ?'), c.impact)
    ),
    field('Catégorie', c.category_id),
    h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('a', { class: 'btn ghost', href: '#/portal' }, 'Annuler'), submit)
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!c.title.value.trim()) {
      c.title.classList.add('invalid');
      c.title.focus();
      return;
    }
    submit.disabled = true;
    try {
      const created = await api.post('/api/incidents', {
        title: c.title.value.trim(),
        description: c.description.value.trim() || null,
        category_id: numberOrNull(c.category_id.value),
        urgency: c.urgency.getValue(),
        impact: c.impact.getValue(),
        ci_id: ciId ?? undefined,
        contact_type: contactType
      });
      toast(`Incident ${created.number} envoyé. Le support vous répond ici.`);
      navigate(`/portal/tickets/${created.id}`);
    } catch (err) {
      toastError(err);
      submit.disabled = false;
    }
  });

  mount(el,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Signaler un problème'), h('div', { class: 'sub' }, 'Le support est prévenu dès l’envoi.'))),
    assistant,
    form
  );
  c.title.focus();
}
