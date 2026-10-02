'use strict';

const { createChange, submitToCab } = require('../../changes/service');
const { updateTicket } = require('../../tickets/service');
const { addEntry } = require('../../tickets/journal');
const { decide } = require('../../approvals/service');
const { recordEvent } = require('../../tickets/audit');
const { zonedToUtc, localDateString, shiftDay } = require('../../lib/tz');

/**
 * Modèles standard et une dizaine de changements : passés (dont un échec qui a
 * causé l'incident majeur ERP), à venir (dont deux en conflit sur SRV-DB-01),
 * un en évaluation CAB, un brouillon, un rejeté.
 */

const TEMPLATES = [
  {
    name: 'Correctifs Windows mensuels',
    description: 'Application des correctifs de sécurité du mois sur des serveurs Windows.',
    implementation_plan: '1. Instantané des VM\n2. Application des correctifs via WSUS\n3. Redémarrage\n4. Contrôle des services',
    backout_plan: 'Restauration de l’instantané pris avant intervention.',
    test_plan: 'Vérifier les services Windows et la supervision.',
    risk: 'low',
    duration_minutes: 180
  },
  {
    name: 'Redémarrage planifié d’un serveur applicatif',
    description: 'Redémarrage hors heures ouvrées, services relancés et contrôlés.',
    implementation_plan: '1. Prévenir les utilisateurs\n2. Arrêt propre des services\n3. Redémarrage\n4. Contrôle',
    backout_plan: 'Sans objet : le serveur redémarre dans son état initial.',
    risk: 'low',
    duration_minutes: 60
  },
  {
    name: 'Renouvellement d’un certificat TLS',
    description: 'Remplacement d’un certificat arrivant à expiration.',
    implementation_plan: '1. Générer la CSR\n2. Installer le certificat\n3. Recharger le service',
    backout_plan: 'Réinstaller l’ancien certificat (encore valide).',
    risk: 'low',
    duration_minutes: 30
  }
];

function seedChanges(db, refs, now) {
  const TZ = 'Europe/Paris';
  const users = Object.fromEntries(Object.entries(refs.users).map(([k, id]) => [k, db.prepare('SELECT * FROM users WHERE id = ?').get(id)]));
  const ci = (...names) => names.map((n) => refs.cis[n]);
  const tpl = {};
  for (const t of TEMPLATES) {
    tpl[t.name] = Number(
      db.prepare('INSERT INTO standard_changes (name, description, implementation_plan, backout_plan, test_plan, risk, duration_minutes) VALUES (@name, @description, @implementation_plan, @backout_plan, @test_plan, @risk, @duration_minutes)').run({ test_plan: null, ...t }).lastInsertRowid
    );
  }
  /** Jour J ± n à hh:mm, heure de Paris. */
  const at = (days, hour, minute = 0) => {
    const [year, month, day] = shiftDay(localDateString(now, TZ), days).split('-').map(Number);
    return zonedToUtc({ year, month, day, hour, minute }, TZ);
  };
  const ctx = (user, date) => ({ db, user, now: date });
  const H = 3600000;

  /**
   * Joue un changement jusqu'à `until` : created → cab → authorized → scheduled → implement → closed.
   */
  function play({ by, title, type = 'normal', template, risk, cis, start, end, justification, plan, backout, cab = [], decisions = [], until, close = 'successful', notes, group = 'infra' }) {
    // Rédigé six jours avant la fenêtre, à 10 h ; le CAB se prononce dans la journée.
    const [cy, cm, cd] = shiftDay(localDateString(start, TZ), -6).split('-').map(Number);
    const created = zonedToUtc({ year: cy, month: cm, day: cd, hour: 10 }, TZ);
    const chg = createChange(ctx(users[by], created), {
      title,
      change_type: template ? undefined : type,
      template_id: template ? tpl[template] : undefined,
      risk,
      planned_start: start.toISOString(),
      planned_end: end ? end.toISOString() : undefined,
      justification,
      implementation_plan: plan,
      backout_plan: backout,
      assignment_group_id: refs.groups[group],
      assigned_to_id: users[by].id,
      ci_ids: cis
    });
    const steps = ['draft', 'assess', 'authorized', 'scheduled', 'implement', 'closed'];
    const reach = (s) => steps.indexOf(until) >= steps.indexOf(s);
    let t = new Date(created.getTime() + 2 * H);
    if (template) {
      if (reach('scheduled')) updateTicket(ctx(users[by], t), chg.id, { state: 'scheduled' });
    } else if (reach('assess') || until === 'rejected') {
      submitToCab(ctx(users[by], t), chg.id, cab.map((k) => users[k].id));
      for (const [k, decision, comment] of decisions) {
        t = new Date(t.getTime() + 3 * H);
        const ap = db.prepare("SELECT id FROM approvals WHERE ticket_id = ? AND approver_id = ? AND state = 'requested'").get(chg.id, users[k].id);
        if (ap) decide(ctx(users[k], t), ap.id, decision, comment);
      }
      if (reach('scheduled')) updateTicket(ctx(users[by], new Date(t.getTime() + H)), chg.id, { state: 'scheduled' });
    }
    if (reach('implement')) {
      const fresh = db.prepare('SELECT planned_start, planned_end FROM changes WHERE ticket_id = ?').get(chg.id);
      updateTicket(ctx(users[by], new Date(fresh.planned_start)), chg.id, { state: 'implement' });
      const finished = new Date(new Date(fresh.planned_end).getTime() - 10 * 60000);
      addEntry(ctx(users[by], finished), chg.id, { kind: 'work_note', body: notes || 'Déroulé conforme au plan.' });
      updateTicket(ctx(users[by], finished), chg.id, { state: 'review' });
      if (reach('closed')) updateTicket(ctx(users[by], new Date(finished.getTime() + 12 * H)), chg.id, { state: 'closed', close_code: close, close_notes: notes || null });
    }
    return chg;
  }

  const list = [];
  list.push(play({
    by: 'karim', group: 'apps', title: 'Mise à jour de l’ERP en version 11.4', risk: 'high', cis: ci('APP-ERP', 'DB-ERP'),
    start: at(-40, 20), end: at(-40, 23), justification: 'Fin de support de la 11.3 ; correctifs de la clôture mensuelle.',
    plan: 'Sauvegarde complète, arrêt de l’ERP, migration du schéma, montée de version, tests de recette.', backout: 'Restauration de la sauvegarde et réinstallation de la 11.3.',
    cab: ['helene', 'julien'], decisions: [['helene', 'approved', 'OK hors clôture.'], ['julien', 'approved', null]], until: 'closed'
  }));
  const mailFix = play({
    by: 'ines', type: 'emergency', title: 'Extension du volume de journaux de SRV-MAIL-01', risk: 'moderate', cis: ci('SRV-MAIL-01'),
    start: at(-41, 11), end: at(-41, 11, 45), justification: 'Messagerie indisponible : disque des journaux saturé.',
    plan: 'Purge des journaux de plus de 7 jours, extension du volume à 200 Go.', backout: 'Aucun retour arrière nécessaire (extension non destructive).',
    cab: ['helene', 'julien'], decisions: [['helene', 'approved', 'Go, urgent.']], until: 'closed', notes: 'Service rétabli à 11 h 40. Supervision du volume ajoutée.'
  });
  list.push(mailFix);
  list.push(play({
    by: 'ines', title: 'Remplacement du commutateur SW-ETAGE-1', risk: 'moderate', cis: ci('SW-ETAGE-1'),
    start: at(-25, 19), end: at(-25, 21), justification: 'Ports défaillants, matériel hors garantie.',
    plan: 'Pré-configuration du nouveau commutateur, bascule des câbles port à port.', backout: 'Remise en place de l’ancien commutateur.',
    cab: ['helene'], decisions: [['helene', 'approved', null]], until: 'closed', close: 'successful_with_issues', notes: 'Deux prises murales mal étiquetées, corrigées le lendemain.'
  }));
  const nightly = play({
    by: 'karim', group: 'apps', title: 'Optimisation des traitements de nuit de l’ERP', risk: 'moderate', cis: ci('DB-ERP'),
    start: at(-19, 22), end: at(-19, 23, 30), justification: 'Les traitements de nuit débordent sur la matinée.',
    plan: 'Réordonnancement des tâches planifiées, nouvel index sur la table des écritures.', backout: 'Restaurer l’ordonnancement précédent, supprimer l’index.',
    cab: ['julien', 'helene'], decisions: [['julien', 'approved', null], ['helene', 'approved', null]], until: 'closed', close: 'backed_out',
    notes: 'Le traitement interrompu a laissé un verrou sur DB-ERP : retour arrière le lendemain matin après l’incident majeur.'
  });
  list.push(nightly);
  list.push(play({ by: 'ines', template: 'Correctifs Windows mensuels', title: 'Correctifs Windows de septembre (AD, fichiers)', cis: ci('SRV-AD-01', 'SRV-FILE-01'), start: at(-10, 20), until: 'closed' }));

  // À venir.
  list.push(play({
    by: 'karim', group: 'apps', title: 'Montée de version de PostgreSQL (DB-CRM)', risk: 'moderate', cis: ci('DB-CRM'),
    start: at(2, 20), end: at(2, 22), justification: 'Version 16.2 vulnérable (CVE de septembre).',
    plan: 'Sauvegarde, pg_upgrade, réindexation, tests du CRM.', backout: 'Restauration de la sauvegarde sur l’ancienne version.',
    cab: ['julien', 'helene'], decisions: [['julien', 'approved', null], ['helene', 'approved', 'Prévenir les commerciaux.']], until: 'scheduled'
  }));
  list.push(play({ by: 'ines', template: 'Correctifs Windows mensuels', title: 'Correctifs Windows d’octobre (DB, applicatif)', cis: ci('SRV-DB-01', 'SRV-APP-01'), start: at(3, 20), until: 'scheduled' }));
  list.push(play({
    by: 'ines', title: 'Migration du stockage de SRV-DB-01', risk: 'high', cis: ci('SRV-DB-01'),
    start: at(3, 21), end: at(3, 23, 30), justification: 'Baie de stockage en fin de vie.',
    plan: 'Migration à chaud des volumes vers la nouvelle baie.', backout: 'Retour sur les volumes d’origine (conservés 30 jours).',
    cab: ['helene', 'julien'], decisions: [['helene', 'approved', null], ['julien', 'approved', 'Attention au chevauchement avec les correctifs.']], until: 'authorized'
  }));
  list.push(play({
    by: 'ines', title: 'Renouvellement du certificat du VPN', risk: 'low', cis: ci('APP-VPN', 'FW-01'),
    start: at(5, 19), end: at(5, 19, 30), justification: 'Le certificat expire dans 12 jours.',
    plan: 'Installation du nouveau certificat sur le pare-feu, test de connexion.', backout: 'Réinstaller l’ancien certificat.',
    cab: ['helene', 'julien'], decisions: [['helene', 'approved', null]], until: 'assess'
  }));
  list.push(play({
    by: 'thomas', title: 'Nouveau réseau Wi-Fi invités', risk: 'moderate', cis: ci('WIFI-CTRL'),
    start: at(9, 18), end: at(9, 20), justification: 'Portail captif actuel peu fiable.',
    plan: 'Création du SSID, portail captif, isolation VLAN.', backout: 'Réactivation de l’ancien SSID.', until: 'draft'
  }));
  list.push(play({
    by: 'ines', title: 'Changement de fournisseur d’accès internet', risk: 'high', cis: ci('RTR-WAN'),
    start: at(12, 7), end: at(12, 9), justification: 'Offre 30 % moins chère.',
    plan: 'Bascule du lien principal sur le nouvel opérateur.', backout: 'Retour sur l’opérateur actuel.',
    cab: ['julien', 'helene'], decisions: [['julien', 'rejected', 'À reprendre après la fin du contrat actuel (mars).']], until: 'rejected'
  }));

  // Liens avec les incidents majeurs : l'un résolu par le changement, l'autre causé par lui.
  const link = (from, to, kind, display) => {
    db.prepare('INSERT OR IGNORE INTO ticket_relations (from_id, to_id, kind, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(from, to, kind, refs.users.helene, now.toISOString());
    recordEvent(db, { entity: 'ticket', entityId: from, event: 'link', display, userId: refs.users.helene, at: now.toISOString() });
  };
  const major = (title) => db.prepare("SELECT id, number FROM tickets WHERE type = 'incident' AND title = ? AND priority = 1").get(title);
  const mail = major('Messagerie indisponible pour tous les utilisateurs');
  const erp = major('ERP inaccessible : erreur de connexion à la base');
  const num = (id) => db.prepare('SELECT number FROM tickets WHERE id = ?').get(id).number;
  if (mail) link(mailFix.id, mail.id, 'related', `Lié à ${mail.number}`);
  if (erp) link(erp.id, nightly.id, 'caused_by', `Causé par ${num(nightly.id)}`);

  const states = db.prepare("SELECT state, COUNT(*) AS n FROM tickets WHERE type = 'change' GROUP BY state").all();
  return `${TEMPLATES.length} modèles standard, ${list.length} changements (${states.map((s) => `${s.state} ${s.n}`).join(', ')})`;
}

module.exports = { seedChanges };
