'use strict';

/**
 * Modèles d'incidents réalistes. `cat` : id de sous-catégorie (migration 002),
 * `group` : groupe de support, `ci` : noms de CI possibles (CMDB, phase 3),
 * `iu` : couples [impact, urgence] plausibles.
 */
const TEMPLATES = [
  { cat: 2, group: 'sd', weight: 10, ci: ['PC-LFONTAINE', 'PC-MDUBOIS', 'PC-CGIRARD', 'LAPTOP-SBENALI', 'LAPTOP-KHADDAD'], iu: [[3, 1], [3, 2], [3, 3]],
    fixes: ['Disque système remplacé, poste remasterisé.', 'Pilote graphique réinstallé.', 'Mise à jour défaillante désinstallée.', 'Clavier remplacé.', 'Nettoyage et remplacement du ventilateur.'],
    titles: ['Mon PC ne démarre plus', 'Écran bleu au démarrage', 'PC très lent depuis la dernière mise à jour', 'Le clavier ne répond plus', 'Le poste surchauffe et s’éteint', 'Plus de son sur le poste', 'Deuxième écran non détecté'],
    details: ['Depuis ce matin, rien à faire.', 'Le problème apparaît après chaque redémarrage.', 'J’ai déjà essayé de redémarrer deux fois.', 'Cela m’empêche de préparer ma réunion de 14 h.'] },
  { cat: 3, group: 'sd', weight: 7, ci: ['IMP-ETAGE2', 'IMP-RDC'], iu: [[2, 2], [3, 2], [3, 3]],
    fixes: ['File d’impression purgée et pilote réinstallé.', 'Rouleau d’entraînement remplacé.', 'Cartouche couleur remplacée.', 'Profil SMTP du scanner corrigé.'],
    titles: ['Impossible d’imprimer sur l’imprimante du 2e étage', 'Bourrage papier récurrent', 'Impression en noir et blanc uniquement', 'Le scanner n’envoie plus les PDF par mail'],
    details: ['Le document reste en file d’attente.', 'Plusieurs collègues ont le même problème.', 'Le voyant orange clignote.'] },
  { cat: 4, group: 'sd', weight: 3, ci: ['SRV-TOIP'], iu: [[3, 2], [2, 2]],
    fixes: ['Port du commutateur réactivé.', 'Profil softphone réinitialisé.'],
    titles: ['Mon téléphone fixe n’a plus de tonalité', 'Softphone : pas de son pendant les appels'],
    details: ['Je ne peux plus joindre les clients.', 'Le casque fonctionne avec Teams pourtant.'] },
  { cat: 6, group: 'apps', weight: 9, ci: ['APP-MESSAGERIE', 'SRV-MAIL-01'], iu: [[3, 2], [2, 2], [3, 1], [1, 1]],
    fixes: ['Profil Outlook recréé.', 'Quota de boîte augmenté, archivage activé.', 'Règle du filtre antispam corrigée.', 'Droits de délégation du calendrier restaurés.'],
    titles: ['Outlook ne se synchronise plus', 'Boîte mail pleine, je ne peux plus envoyer', 'Je ne reçois plus les mails externes', 'Calendrier partagé inaccessible', 'Les pièces jointes ne s’ouvrent plus'],
    details: ['Le dernier mail reçu date d’hier soir.', 'Message « Impossible de se connecter au serveur ».', 'Ça marche sur le téléphone mais pas sur le PC.'] },
  { cat: 7, group: 'apps', weight: 7, ci: ['APP-ERP', 'DB-ERP', 'SRV-APP-01'], iu: [[2, 1], [2, 2], [1, 2], [3, 2]],
    fixes: ['Index de la table des factures reconstruit.', 'Traitement batch replanifié hors heures de bureau.', 'Paramètre d’export corrigé après la mise à jour.'],
    titles: ['ERP : erreur lors de la validation des factures', 'ERP très lent en fin de mois', 'Export comptable en échec', 'ERP : impossible d’éditer les bons de commande'],
    details: ['Erreur « Transaction annulée (code 504) ».', 'Toute l’équipe comptable est concernée.', 'La clôture mensuelle est demain.'] },
  { cat: 8, group: 'apps', weight: 6, ci: ['APP-CRM', 'DB-CRM'], iu: [[2, 2], [3, 2], [2, 1]],
    fixes: ['Cache applicatif vidé et module de saisie redéployé.', 'Jeton de synchronisation renouvelé.', 'Script de dédoublonnage exécuté.'],
    titles: ['CRM : impossible de créer une opportunité', 'Synchronisation CRM et messagerie en échec', 'Le CRM affiche une page blanche', 'Doublons de contacts dans le CRM'],
    details: ['Le bouton « Enregistrer » ne fait rien.', 'Rien depuis la mise à jour de mardi.', 'Les commerciaux en rendez-vous sont bloqués.'] },
  { cat: 9, group: 'sd', weight: 7, ci: ['APP-BUREAUTIQUE'], iu: [[3, 2], [3, 3]],
    fixes: ['Réparation Office et réinitialisation du cache.', 'Licence réattribuée.', 'Client Teams réinstallé.'],
    titles: ['Excel plante à l’ouverture d’un fichier partagé', 'Licence Office expirée', 'Teams ne lance plus les réunions', 'Word ne propose plus l’enregistrement sur le partage'],
    details: ['Message d’activation au démarrage.', 'Seulement avec les fichiers du serveur.', 'Réinstallé hier, sans effet.'] },
  { cat: 11, group: 'infra', weight: 8, ci: ['APP-VPN', 'FW-01'], iu: [[3, 1], [2, 2], [3, 2]],
    fixes: ['Compte VPN resynchronisé avec l’annuaire.', 'Délai d’inactivité du profil VPN corrigé.', 'Certificat client renouvelé.'],
    titles: ['VPN : connexion refusée', 'VPN qui se déconnecte toutes les 10 minutes', 'VPN très lent en télétravail', 'Certificat VPN expiré'],
    details: ['Je suis en télétravail aujourd’hui.', 'Erreur d’authentification alors que mon mot de passe est bon.', 'Ma connexion internet fonctionne normalement.'] },
  { cat: 12, group: 'infra', weight: 4, ci: ['WIFI-CTRL'], iu: [[2, 2], [3, 3]],
    fixes: ['Borne Wi-Fi redémarrée, canal changé.', 'Portail invités réactivé.'],
    titles: ['Wi-Fi instable en salle de réunion', 'Impossible de se connecter au Wi-Fi invités'],
    details: ['Coupures toutes les cinq minutes environ.', 'Un client arrive à 15 h.'] },
  { cat: 13, group: 'infra', weight: 3, ci: ['RTR-WAN', 'FW-01', 'SW-CORE-01'], iu: [[2, 1], [1, 1], [2, 2]],
    fixes: ['Commutateur d’étage redémarré.', 'Règle du proxy corrigée.'],
    titles: ['Plus d’accès internet sur l’étage', 'Sites web très lents depuis ce matin'],
    details: ['Les collègues du 1er étage aussi.', 'Le réseau interne fonctionne.'] },
  { cat: 15, group: 'sd', weight: 8, ci: ['SRV-AD-01'], iu: [[3, 1], [3, 2]],
    fixes: ['Compte déverrouillé, mot de passe réinitialisé.', 'Appareil de double authentification réenregistré.'],
    titles: ['Compte verrouillé après plusieurs tentatives', 'Mot de passe expiré, impossible de le changer', 'Code de double authentification non reçu'],
    details: ['Je ne peux plus ouvrir ma session.', 'Le message parle de règles de complexité.'] },
  { cat: 16, group: 'sd', weight: 5, ci: ['SRV-FILE-01', 'APP-GED'], iu: [[3, 2], [3, 3]],
    fixes: ['Ajout au groupe d’accès de l’annuaire.', 'Droits GED alignés sur le nouveau poste.', 'Partage remonté sur le poste.'],
    titles: ['Accès refusé au dossier partagé Comptabilité', 'Besoin des droits sur la GED après changement de poste', 'Dossier partagé invisible depuis ce matin'],
    details: ['J’y avais accès la semaine dernière.', 'Mon manager a validé la demande.'] }
];

/** Incidents majeurs : un P1 suivi de signalements en doublon. */
const MAJOR = [
  { daysAgo: 41, cat: 6, ci: 'SRV-MAIL-01', title: 'Messagerie indisponible pour tous les utilisateurs', fix: 'Saturation du disque des journaux sur SRV-MAIL-01 : purge et extension du volume, surveillance ajoutée.' },
  { daysAgo: 18, cat: 7, ci: 'DB-ERP', title: 'ERP inaccessible : erreur de connexion à la base', fix: 'Verrou bloquant sur DB-ERP après un traitement de nuit interrompu ; session tuée, traitement relancé.' },
  { daysAgo: 6, cat: 13, ci: 'RTR-WAN', title: 'Coupure internet sur le site principal', fix: 'Panne du lien opérateur ; bascule sur le lien de secours, ticket ouvert chez l’opérateur.' }
];

const COMMENTS_AGENT = [
  'Bonjour, je prends votre demande en charge.',
  'Pouvez-vous me préciser le message d’erreur exact ?',
  'Pouvez-vous redémarrer le poste et me dire si le problème persiste ?',
  'Je me connecte à distance sur votre poste dans cinq minutes.',
  'Nous avons identifié la cause, la correction est en cours.',
  'Le correctif est appliqué, pouvez-vous vérifier de votre côté ?'
];
const COMMENTS_USER = [
  'Voici la capture du message d’erreur.',
  'Toujours le même problème après redémarrage.',
  'C’est bon pour moi, merci !',
  'Je suis disponible cet après-midi si besoin.',
  'Le problème est revenu ce matin.'
];
const WORK_NOTES = [
  'Journaux consultés : erreurs d’authentification répétées.',
  'Pilote mis à jour, redémarrage planifié.',
  'Escalade possible vers le niveau 2 si le contournement ne tient pas.',
  'Même symptôme observé sur deux autres postes du service.',
  'Ticket fournisseur ouvert, référence en attente.',
  'Contournement appliqué, cause racine à analyser.'
];
const RESOLUTIONS = {
  permanent_fix: ['Composant défectueux remplacé.', 'Pilote réinstallé et mis à jour.', 'Droits corrigés dans l’annuaire.', 'Profil utilisateur recréé.', 'Configuration réseau corrigée.'],
  workaround: ['Contournement : utilisation du webmail en attendant le correctif.', 'Redirection vers l’imprimante voisine.', 'Connexion via le lien de secours.'],
  user_error: ['Mauvaise manipulation, procédure réexpliquée à l’utilisateur.'],
  not_reproducible: ['Non reproduit après redémarrage, à rouvrir en cas de récidive.']
};

module.exports = { TEMPLATES, MAJOR, COMMENTS_AGENT, COMMENTS_USER, WORK_NOTES, RESOLUTIONS };
