'use strict';

const { saveItem, orderItem } = require('../../requests/catalog');
const { decide } = require('../../approvals/service');
const { updateTicket } = require('../../tickets/service');
const { addEntry } = require('../../tickets/journal');
const { tasksOf } = require('../../requests/fulfillment');

/** Catalogue de Tessel et une quinzaine de demandes jouées sur 40 jours. */

const CATEGORIES = [
  ['Matériel', 10],
  ['Logiciels', 20],
  ['Accès', 30],
  ['Arrivées et départs', 40]
];

function items(refs, cat) {
  const g = refs.groups;
  return [
    {
      name: 'Nouveau poste de travail',
      short_description: 'Portable ou fixe, préparé et livré à votre bureau.',
      description: 'Le poste est livré masterisé, avec vos applications et vos accès. Comptez une semaine.',
      category_id: cat['Matériel'], icon: 'laptop', requires_approval: true, fulfillment_group_id: g.sd, delivery_days: 5,
      form_schema: [
        { name: 'modele', label: 'Modèle', type: 'select', required: true, options: ['Portable standard', 'Portable performance', 'Poste fixe'] },
        { name: 'station', label: 'Station d’accueil et deux écrans', type: 'checkbox' },
        { name: 'date_besoin', label: 'Pour quand ?', type: 'date', required: true },
        { name: 'justification', label: 'Justification', type: 'textarea', required: true }
      ],
      tasks: [
        { sequence: 1, title: 'Commander ou sortir le poste du stock', assignment_group_id: g.sd },
        { sequence: 2, title: 'Masteriser et installer les applications', assignment_group_id: g.sd },
        { sequence: 3, title: 'Livrer et installer au bureau', assignment_group_id: g.sd }
      ]
    },
    {
      name: 'Accès VPN',
      short_description: 'Travailler à distance sur le réseau de l’entreprise.',
      category_id: cat['Accès'], icon: 'key', requires_approval: true, fulfillment_group_id: g.infra, delivery_days: 1,
      form_schema: [
        { name: 'duree', label: 'Durée', type: 'select', required: true, options: ['Permanent', '3 mois', '1 mois'] },
        { name: 'motif', label: 'Motif', type: 'textarea', required: true }
      ],
      tasks: [
        { sequence: 1, title: 'Créer le profil VPN et le certificat', assignment_group_id: g.infra },
        { sequence: 2, title: 'Envoyer la procédure de connexion', assignment_group_id: g.sd }
      ]
    },
    {
      name: 'Accès à une application',
      short_description: 'ERP, CRM, GED, paie : demandez un compte ou un profil.',
      category_id: cat['Accès'], icon: 'app', requires_approval: true, fulfillment_group_id: g.apps, delivery_days: 2,
      form_schema: [
        { name: 'application', label: 'Application', type: 'select', required: true, options: ['ERP', 'CRM', 'GED', 'Paie'] },
        { name: 'profil', label: 'Profil', type: 'select', required: true, options: ['Lecture', 'Saisie', 'Validation'] },
        { name: 'justification', label: 'Justification', type: 'textarea', required: true }
      ],
      tasks: [{ sequence: 1, title: 'Créer le compte applicatif et le profil', assignment_group_id: g.apps }]
    },
    {
      name: 'Installation d’un logiciel',
      short_description: 'Un logiciel du catalogue installé sur votre poste.',
      category_id: cat['Logiciels'], icon: 'package', requires_approval: false, fulfillment_group_id: g.sd, delivery_days: 2,
      form_schema: [
        { name: 'logiciel', label: 'Logiciel', type: 'select', required: true, options: ['Adobe Acrobat Pro', 'Microsoft Visio', 'Microsoft Project', 'Autre'] },
        { name: 'autre', label: 'Si « Autre », lequel ?', type: 'text' },
        { name: 'poste', label: 'Poste concerné', type: 'ci', help: 'Laissez vide pour votre poste principal' }
      ],
      tasks: [{ sequence: 1, title: 'Installer le logiciel et la licence', assignment_group_id: g.sd }]
    },
    {
      name: 'Téléphone mobile',
      short_description: 'Un smartphone professionnel avec sa ligne.',
      category_id: cat['Matériel'], icon: 'phone', requires_approval: true, fulfillment_group_id: g.sd, delivery_days: 7,
      form_schema: [
        { name: 'modele', label: 'Modèle', type: 'select', required: true, options: ['Standard', 'Grand écran'] },
        { name: 'motif', label: 'Motif', type: 'textarea', required: true }
      ],
      tasks: [
        { sequence: 1, title: 'Commander le téléphone et la ligne', assignment_group_id: g.sd },
        { sequence: 2, title: 'Configurer la messagerie et remettre l’appareil', assignment_group_id: g.sd }
      ]
    },
    {
      name: 'Réinitialisation d’un mot de passe applicatif',
      short_description: 'Hors session Windows : ERP, CRM, paie…',
      category_id: cat['Accès'], icon: 'key', requires_approval: false, fulfillment_group_id: g.apps, delivery_days: 1,
      form_schema: [{ name: 'application', label: 'Application', type: 'select', required: true, options: ['ERP', 'CRM', 'GED', 'Paie'] }],
      tasks: [{ sequence: 1, title: 'Réinitialiser et transmettre le mot de passe', assignment_group_id: g.apps }]
    },
    {
      name: 'Arrivée d’un collaborateur',
      short_description: 'Compte, poste et accès prêts pour le premier jour.',
      category_id: cat['Arrivées et départs'], icon: 'users', requires_approval: true, fulfillment_group_id: g.sd, delivery_days: 5,
      form_schema: [
        { name: 'nom', label: 'Nom du collaborateur', type: 'text', required: true },
        { name: 'arrivee', label: 'Date d’arrivée', type: 'date', required: true },
        { name: 'service', label: 'Service', type: 'text', required: true },
        { name: 'poste', label: 'Besoin d’un poste de travail', type: 'checkbox' }
      ],
      tasks: [
        { sequence: 1, title: 'Créer le compte et la boîte mail', assignment_group_id: g.sd },
        { sequence: 2, title: 'Préparer le poste de travail', assignment_group_id: g.sd },
        { sequence: 2, title: 'Ouvrir les accès applicatifs', assignment_group_id: g.apps }
      ]
    }
  ];
}

const DAY = 86400000;
const H = 3600000;

/** Scénarios : [jours avant, demandeur, article, variables, sort]. */
const ORDERS = [
  [38, 'lea', 'Accès à une application', { application: 'Paie', profil: 'Lecture', justification: 'Contrôle des écritures de paie.' }, 'done'],
  [35, 'marc', 'Nouveau poste de travail', { modele: 'Portable performance', station: true, date_besoin: -28, justification: 'Démonstrations clients en déplacement.' }, 'done'],
  [31, 'chloe', 'Arrivée d’un collaborateur', { nom: 'Nina Perrot', arrivee: -24, service: 'Ressources humaines', poste: true }, 'done'],
  [27, 'lea', 'Installation d’un logiciel', { logiciel: 'Adobe Acrobat Pro' }, 'done'],
  [24, 'marc', 'Accès VPN', { duree: 'Permanent', motif: 'Télétravail deux jours par semaine.' }, 'done'],
  [20, 'chloe', 'Téléphone mobile', { modele: 'Grand écran', motif: 'Envie personnelle.' }, 'rejected'],
  [17, 'karim', 'Réinitialisation d’un mot de passe applicatif', { application: 'ERP' }, 'done'],
  [13, 'marc', 'Accès à une application', { application: 'CRM', profil: 'Validation', justification: 'Nouveau rôle de responsable de secteur.' }, 'done'],
  [9, 'lea', 'Nouveau poste de travail', { modele: 'Portable standard', station: false, date_besoin: 5, justification: 'Poste actuel de 6 ans, très lent.' }, 'partial'],
  [6, 'chloe', 'Accès VPN', { duree: '3 mois', motif: 'Mission à Lyon.' }, 'started'],
  [4, 'marc', 'Installation d’un logiciel', { logiciel: 'Microsoft Visio' }, 'started'],
  [2, 'lea', 'Accès à une application', { application: 'GED', profil: 'Saisie', justification: 'Archivage des factures fournisseurs.' }, 'pending'],
  [1, 'chloe', 'Arrivée d’un collaborateur', { nom: 'Hugo Lambert', arrivee: 10, service: 'Ressources humaines', poste: true }, 'pending'],
  [0.2, 'marc', 'Téléphone mobile', { modele: 'Standard', motif: 'Astreinte commerciale.' }, 'pending']
];

function seedCatalog(db, refs, now) {
  const cat = {};
  for (const [name, order] of CATEGORIES) {
    cat[name] = Number(db.prepare("INSERT INTO categories (name, scope, sort_order) VALUES (?, 'catalog', ?)").run(name, order).lastInsertRowid);
  }
  const setupCtx = { db, user: null, now: new Date(now.getTime() - 60 * DAY) };
  const ids = {};
  for (const item of items(refs, cat)) ids[item.name] = saveItem(setupCtx, null, item).id;

  const user = (key) => db.prepare('SELECT * FROM users WHERE id = ?').get(refs.users[key]);
  const agentOf = (task) => {
    const members = db.prepare('SELECT u.* FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY u.id').all(task.assignment_group_id);
    return members[task.id % members.length];
  };
  const isoDay = (offsetDays) => new Date(now.getTime() + offsetDays * DAY).toISOString().slice(0, 10);

  let count = 0;
  for (const [daysAgo, who, itemName, vars, fate] of ORDERS) {
    let t = new Date(now.getTime() - daysAgo * DAY);
    const requester = user(who);
    const variables = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, typeof v === 'number' && ['date_besoin', 'arrivee'].includes(k) ? isoDay(v) : v]));
    const req = orderItem({ db, user: requester, now: t }, ids[itemName], { variables });
    count += 1;
    if (fate === 'pending') continue;

    const approval = db.prepare("SELECT * FROM approvals WHERE ticket_id = ? AND state = 'requested'").get(req.id);
    if (approval) {
      t = new Date(t.getTime() + 3 * H);
      const approver = db.prepare('SELECT * FROM users WHERE id = ?').get(approval.approver_id);
      if (fate === 'rejected') {
        decide({ db, user: approver, now: t }, approval.id, 'rejected', 'Pas de besoin professionnel identifié : le poste fixe suffit.');
        continue;
      }
      decide({ db, user: approver, now: t }, approval.id, 'approved', 'OK pour moi.');
    }

    // Exécution : les tâches ouvertes sont prises en charge puis terminées, étape par étape.
    for (let guard = 0; guard < 6; guard += 1) {
      const open = tasksOf(db, req.id).filter((x) => x.state === 'open');
      if (!open.length) break;
      for (const task of open) {
        const agent = agentOf(task);
        t = new Date(t.getTime() + 2 * H);
        updateTicket({ db, user: agent, now: t }, task.id, { state: 'in_progress' });
        if (fate === 'started') break;
        t = new Date(t.getTime() + 5 * H);
        addEntry({ db, user: agent, now: t }, task.id, { kind: 'work_note', body: 'Fait, vérifié avec le demandeur.' });
        updateTicket({ db, user: agent, now: t }, task.id, { state: 'closed_complete' });
      }
      if (fate === 'started' || (fate === 'partial' && guard === 0)) break;
    }
    if (fate === 'done') {
      const done = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.id);
      if (done.state === 'fulfilled' && now.getTime() - new Date(done.resolved_at).getTime() > 3 * DAY) {
        updateTicket({ db, user: null, now: new Date(new Date(done.resolved_at).getTime() + 3 * DAY) }, req.id, { state: 'closed' });
      }
    }
  }
  const states = db.prepare("SELECT state, COUNT(*) AS n FROM tickets WHERE type = 'request' GROUP BY state").all();
  return `catalogue de ${Object.keys(ids).length} articles, ${count} demandes (${states.map((s) => `${s.state} ${s.n}`).join(', ')})`;
}

module.exports = { seedCatalog };
