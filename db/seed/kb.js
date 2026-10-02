'use strict';

const { createArticle } = require('../../kb/service');

/** Quelques articles publiés, rédigés à partir des résolutions les plus fréquentes. */
const ARTICLES = [
  ['VPN', 'Le VPN refuse la connexion', '## Symptômes\n\nLe client VPN affiche « Échec d’authentification » alors que le mot de passe est correct.\n\n## Résolution\n\n1. Vérifiez que votre mot de passe Windows n’a pas expiré (Ctrl+Alt+Suppr → Changer un mot de passe).\n2. Redémarrez le client VPN.\n3. Si le message parle de **certificat**, contactez le support : il doit être renouvelé.'],
  ['VPN', 'Le VPN se déconnecte toutes les 10 minutes', '## Cause\n\nDélai d’inactivité trop court sur votre profil.\n\n## Résolution\n\nLe support corrige le profil ; en attendant, gardez une application réseau ouverte (messagerie).'],
  ['Messagerie', 'Outlook ne se synchronise plus', '## Résolution\n\n1. Fermez Outlook.\n2. Panneau de configuration → Courrier → Afficher les profils → **Ajouter** un nouveau profil.\n3. Définissez-le par défaut et relancez Outlook.\n\nVos messages sont sur le serveur : rien n’est perdu.'],
  ['Postes de travail', 'Écran bleu au démarrage', '## À faire tout de suite\n\n- Notez le **code d’arrêt** affiché (ex. `DRIVER_IRQL_NOT_LESS_OR_EQUAL`).\n- Débranchez les périphériques USB et redémarrez.\n\nSi l’écran bleu revient, signalez-le avec le code : il oriente vers le pilote en cause.'],
  ['Imprimantes', 'Impossible d’imprimer : document bloqué en file d’attente', '## Résolution\n\n1. Paramètres → Imprimantes → ouvrez la file → **Annuler tous les documents**.\n2. Supprimez puis réinstallez l’imprimante depuis le portail d’impression.\n3. Si plusieurs collègues sont touchés, c’est l’imprimante elle-même : signalez-le.'],
  ['Comptes et accès', 'Compte verrouillé après plusieurs tentatives', '## Résolution\n\nLe compte se déverrouille seul au bout de **15 minutes**. Si c’est urgent, appelez le Service Desk : le déverrouillage est immédiat après vérification de votre identité.'],
  ['Comptes et accès', 'Changer son mot de passe expiré', '## Règles\n\n- 12 caractères minimum\n- différent des 5 derniers\n\n## Comment faire\n\nCtrl+Alt+Suppr → **Changer un mot de passe**. En télétravail, connectez d’abord le VPN.']
];

function seedKb(db, refs, now) {
  const cats = {};
  ['VPN', 'Messagerie', 'Postes de travail', 'Imprimantes', 'Comptes et accès'].forEach((name, i) => {
    cats[name] = Number(db.prepare("INSERT INTO categories (name, scope, sort_order) VALUES (?, 'kb', ?)").run(name, i).lastInsertRowid);
  });
  const author = db.prepare('SELECT * FROM users WHERE id = ?').get(refs.users.sarah);
  ARTICLES.forEach(([cat, title, body], i) => {
    const a = createArticle({ db, user: author, now: new Date(now.getTime() - (50 - i * 5) * 86400000) }, { title, body, category_id: cats[cat], status: 'published' });
    db.prepare('UPDATE kb_articles SET view_count = ? WHERE id = ?').run(40 - i * 4, a.id);
  });
  return `${ARTICLES.length} articles de base de connaissances`;
}

module.exports = { seedKb };
