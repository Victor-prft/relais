import { h, mount } from '../../ui/dom.js';
import { icons } from '../../ui/icons.js';
import { api } from '../../api.js';
import { cached } from '../../state.js';
import { LEVEL_LABELS } from '../../format.js';

const CONFIDENCE = { low: 'faible', medium: 'moyenne', high: 'élevée' };

/**
 * Assistant de déclaration : l'utilisateur décrit son problème en texte libre,
 * le serveur demande au LLM un brouillon structuré, qui préremplit le
 * formulaire ci-dessous. Rien n'est envoyé au support sans confirmation.
 * Sans IA disponible, le bloc ne s'affiche pas : on reste sur le formulaire.
 */
export function aiAssist({ onSuggestion }) {
  const host = h('section', { class: 'card card-body callout ai ai-panel hidden' });
  cached('ai-status', () => api.get('/api/ai/status')).then(({ enabled }) => {
    if (!enabled) return;
    host.classList.remove('hidden');
    const text = h('textarea', { class: 'input', placeholder: 'Ex. : « Depuis ce matin le VPN me refuse la connexion, je suis en télétravail et je ne peux plus accéder à l’ERP. »', maxlength: 4000 });
    const result = h('div');
    const button = h('button', { class: 'btn primary', type: 'button' }, icons.sparkles({ size: 16 }), 'Préremplir le formulaire');
    button.addEventListener('click', async () => {
      if (text.value.trim().length < 10) return text.focus();
      button.disabled = true;
      mount(result, h('div', { class: 'loading small' }, h('span', { class: 'spinner' }), 'Analyse en cours…'));
      try {
        const res = await api.post('/api/ai/triage', { text: text.value.trim() });
        if (!res.available) {
          mount(result, h('p', { class: 'small muted' }, `${res.reason}. Remplissez le formulaire ci-dessous, le support s’occupe du reste.`));
          return;
        }
        const s = res.suggestion;
        onSuggestion(s);
        mount(result,
          h('div', { class: 'stack small', style: { marginTop: '10px' } },
            h('div', {}, h('strong', {}, 'Formulaire prérempli — vérifiez-le avant d’envoyer.'), ` Confiance ${CONFIDENCE[s.confidence]}.`),
            h('div', { class: 'muted' }, [s.category_label ? `Catégorie : ${s.category_label}` : 'Catégorie : à préciser', s.ci_name ? `Élément : ${s.ci_name}` : null, `Urgence ${LEVEL_LABELS[s.urgency]}, impact ${LEVEL_LABELS[s.impact]}`].filter(Boolean).join(' · ')),
            s.rationale ? h('div', { class: 'faint' }, s.rationale) : null
          )
        );
      } catch (err) {
        mount(result, h('p', { class: 'small error' }, err.message));
      } finally {
        button.disabled = false;
      }
    });
    mount(host,
      h('div', { class: 'ai-chip' }, icons.sparkles({ size: 15 }), 'Assistant'),
      h('p', { style: { margin: '6px 0 10px' } }, 'Décrivez le problème avec vos mots : l’assistant prépare la déclaration.'),
      text,
      h('div', { class: 'row', style: { marginTop: '8px' } }, button, h('span', { class: 'small faint' }, 'Votre texte est analysé par un modèle d’IA ; vous gardez la main sur ce qui est envoyé.')),
      result
    );
  }).catch(() => {});
  return host;
}
