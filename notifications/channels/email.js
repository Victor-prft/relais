'use strict';

/**
 * Canal email. Aucun envoi pour l'instant : l'interface est en place pour
 * brancher un fournisseur (Resend, SMTP…) sans toucher au reste.
 *
 *   send({ to, subject, text, link }) → Promise<boolean> (true si envoyé)
 *
 * Pour brancher un fournisseur : implémenter `deliver` ci-dessous, passer
 * EMAIL_ENABLED=true, et la couche notifications posera `emailed_at`.
 */
function createEmailChannel({ enabled = false, appUrl = '', log = null } = {}) {
  async function deliver(_message) {
    return false;
  }

  return {
    name: 'email',
    enabled,
    async send(message) {
      if (!enabled) return false;
      try {
        return await deliver({ ...message, link: message.link ? `${appUrl}${message.link}` : null });
      } catch (err) {
        log?.warn?.('[email] échec d’envoi', err.message);
        return false;
      }
    }
  };
}

module.exports = { createEmailChannel };
