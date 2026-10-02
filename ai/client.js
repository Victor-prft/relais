'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;

/**
 * Accès au LLM, côté serveur uniquement (la clé ne quitte jamais le serveur).
 *
 * Chaque appel :
 * - demande une sortie JSON contrainte par un schéma (`output_config.format`) ;
 * - revalide la réponse avec zod (les ids proposés sont ensuite filtrés par
 *   l'appelant contre ce qui existe vraiment) ;
 * - active le repli serveur en cas de refus (`fallbacks: "default"`) ;
 * - est journalisé dans `ai_requests` (tokens, durée, statut — jamais le contenu).
 * Toute défaillance lève AiUnavailable : l'appelant retombe sur le chemin sans IA.
 */

class AiUnavailable extends Error {
  constructor(reason, status = 'error') {
    super(reason);
    this.status = status;
  }
}

function logRequest(db, entry) {
  db.prepare(
    `INSERT INTO ai_requests (user_id, feature, model, status, input_tokens, output_tokens, duration_ms, error, created_at)
     VALUES (@user_id, @feature, @model, @status, @input_tokens, @output_tokens, @duration_ms, @error, @created_at)`
  ).run({ input_tokens: null, output_tokens: null, duration_ms: null, error: null, ...entry });
}

/**
 * @param {object} options { apiKey, model, timeoutMs, transport? } — `transport` remplace
 *        l'appel réseau (tests) : async (params) => message au format de l'API.
 */
function createAiClient({ apiKey, model, timeoutMs = 25000, transport = null }) {
  const enabled = Boolean(apiKey || transport);
  const sdk = apiKey && !transport ? new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 }) : null;
  const send = transport || ((params) => sdk.beta.messages.create(params));

  /**
   * Demande un objet JSON conforme à `jsonSchema`, revalidé par `zodSchema`.
   * effort : 'low' pour l'extraction et le classement (rapide, peu coûteux).
   */
  async function json(ctx, { feature, system, prompt, jsonSchema, zodSchema, maxTokens = 4000, effort = 'low' }) {
    const base = { user_id: ctx.user?.id ?? null, feature, model, created_at: new Date().toISOString() };
    if (!enabled) {
      logRequest(ctx.db, { ...base, status: 'disabled' });
      throw new AiUnavailable('Assistant IA non configuré', 'disabled');
    }
    const started = Date.now();
    let message;
    try {
      message = await send({
        model,
        max_tokens: maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: prompt }],
        output_config: { effort, format: { type: 'json_schema', schema: jsonSchema } }
      });
    } catch (err) {
      logRequest(ctx.db, { ...base, status: 'error', duration_ms: Date.now() - started, error: String(err.status || err.name || 'error').slice(0, 120) });
      throw new AiUnavailable('Le service IA ne répond pas');
    }
    const usage = { input_tokens: message.usage?.input_tokens ?? null, output_tokens: message.usage?.output_tokens ?? null, duration_ms: Date.now() - started };

    if (message.stop_reason === 'refusal') {
      logRequest(ctx.db, { ...base, ...usage, status: 'refused', error: message.stop_details?.category || null });
      throw new AiUnavailable('Demande déclinée par l’assistant', 'refused');
    }
    const text = (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    let value;
    try {
      value = zodSchema.parse(JSON.parse(text));
    } catch (err) {
      logRequest(ctx.db, { ...base, ...usage, status: 'invalid', error: message.stop_reason === 'max_tokens' ? 'max_tokens' : String(err.message).slice(0, 120) });
      throw new AiUnavailable('Réponse de l’assistant inexploitable', 'invalid');
    }
    logRequest(ctx.db, { ...base, ...usage, status: 'ok' });
    return value;
  }

  return { enabled, model, json };
}

module.exports = { createAiClient, AiUnavailable };
