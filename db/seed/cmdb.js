'use strict';

const { createCi, addRelation } = require('../../cmdb/service');

/** 30 CI de la société Tessel et leurs relations. */
const CIS = [
  // Serveurs
  { name: 'SRV-WEB-01', cls: 'server', group: 'infra', crit: 1, loc: 'Salle serveur A', attrs: { os: 'Debian 12', ip_address: '10.0.10.11', cpu: 4, ram_gb: 16, virtual: true }, desc: 'Frontal web : intranet et CRM.' },
  { name: 'SRV-APP-01', cls: 'server', group: 'infra', crit: 1, loc: 'Salle serveur A', attrs: { os: 'Windows Server 2022', ip_address: '10.0.10.21', cpu: 8, ram_gb: 32, virtual: true }, desc: 'Serveur applicatif ERP et paie.' },
  { name: 'SRV-DB-01', cls: 'server', group: 'infra', crit: 1, loc: 'Salle serveur A', attrs: { os: 'Windows Server 2022', ip_address: '10.0.10.31', cpu: 16, ram_gb: 128, virtual: false }, desc: 'Serveur de bases de données principal.' },
  { name: 'SRV-FILE-01', cls: 'server', group: 'infra', crit: 2, loc: 'Salle serveur A', attrs: { os: 'Windows Server 2019', ip_address: '10.0.10.41', cpu: 4, ram_gb: 16, virtual: true }, desc: 'Partages de fichiers des services.' },
  { name: 'SRV-AD-01', cls: 'server', group: 'infra', crit: 1, loc: 'Salle serveur A', attrs: { os: 'Windows Server 2022', ip_address: '10.0.10.5', cpu: 2, ram_gb: 8, virtual: true }, desc: 'Annuaire Active Directory, DNS, authentification.' },
  { name: 'SRV-MAIL-01', cls: 'server', group: 'infra', crit: 1, loc: 'Salle serveur A', attrs: { os: 'Windows Server 2022', ip_address: '10.0.10.51', cpu: 8, ram_gb: 64, virtual: true }, desc: 'Serveur de messagerie.' },
  { name: 'SRV-TOIP', cls: 'server', group: 'infra', crit: 2, loc: 'Salle serveur A', attrs: { os: 'Debian 12', ip_address: '10.0.10.61', cpu: 2, ram_gb: 4, virtual: true }, desc: 'Autocommutateur de téléphonie IP.' },
  // Bases de données
  { name: 'DB-ERP', cls: 'database', group: 'apps', crit: 1, attrs: { engine: 'SQL Server', version: '2022', size_gb: 420 }, desc: 'Base de l’ERP (comptabilité, achats, paie).' },
  { name: 'DB-CRM', cls: 'database', group: 'apps', crit: 2, attrs: { engine: 'PostgreSQL', version: '16', size_gb: 85 } },
  { name: 'DB-INTRANET', cls: 'database', group: 'apps', crit: 3, attrs: { engine: 'MySQL', version: '8.0', size_gb: 12 } },
  // Applications
  { name: 'APP-ERP', cls: 'application', group: 'apps', crit: 1, owner: 'julien', attrs: { version: '11.4', vendor: 'Logisoft', users: 60 }, desc: 'Progiciel de gestion : comptabilité, achats, stocks.' },
  { name: 'APP-PAIE', cls: 'application', group: 'apps', crit: 1, owner: 'julien', attrs: { version: '2026.2', vendor: 'Logisoft', users: 6 } },
  { name: 'APP-CRM', cls: 'application', group: 'apps', crit: 2, owner: 'julien', attrs: { version: '8.2', vendor: 'Relatia', url: 'https://crm.tessel.local', users: 25 } },
  { name: 'APP-MESSAGERIE', cls: 'application', group: 'apps', crit: 1, owner: 'helene', attrs: { version: '2019 CU14', vendor: 'Microsoft', users: 120 } },
  { name: 'APP-INTRANET', cls: 'application', group: 'apps', crit: 3, attrs: { version: '6.4', url: 'https://intranet.tessel.local', users: 120 } },
  { name: 'APP-VPN', cls: 'application', group: 'infra', crit: 2, owner: 'helene', attrs: { version: '7.2', vendor: 'Fortinet', users: 70 }, desc: 'Accès distant des télétravailleurs.' },
  { name: 'APP-GED', cls: 'application', group: 'apps', crit: 2, attrs: { version: '4.1', vendor: 'Docuflow', users: 80 }, desc: 'Gestion électronique des documents.' },
  { name: 'APP-BUREAUTIQUE', cls: 'application', group: 'sd', crit: 3, attrs: { version: '365', vendor: 'Microsoft', users: 120 } },
  // Réseau
  { name: 'RTR-WAN', cls: 'network', group: 'infra', crit: 1, loc: 'Baie réseau', attrs: { model: 'Cisco ISR 1100', ip_address: '10.0.0.1', firmware: '17.9' }, desc: 'Routeur d’accès opérateur (lien principal + secours 4G).' },
  { name: 'FW-01', cls: 'network', group: 'infra', crit: 1, loc: 'Baie réseau', attrs: { model: 'FortiGate 100F', ip_address: '10.0.0.2', firmware: '7.2.8' } },
  { name: 'SW-CORE-01', cls: 'network', group: 'infra', crit: 1, loc: 'Baie réseau', attrs: { model: 'Aruba 6300M', ip_address: '10.0.0.3', firmware: '10.13' } },
  { name: 'SW-ETAGE-1', cls: 'network', group: 'infra', crit: 2, loc: '1er étage', attrs: { model: 'Aruba 6100', ip_address: '10.0.1.2', firmware: '10.13' } },
  { name: 'WIFI-CTRL', cls: 'network', group: 'infra', crit: 2, loc: 'Baie réseau', attrs: { model: 'Aruba 7010', ip_address: '10.0.0.10', firmware: '8.11' } },
  // Postes de travail
  { name: 'PC-LFONTAINE', cls: 'workstation', group: 'sd', crit: 3, owner: 'lea', loc: '1er étage', attrs: { model: 'Dell OptiPlex 7010', os: 'Windows 11', serial: 'DL7010-4821', user: 'Léa Fontaine' } },
  { name: 'PC-MDUBOIS', cls: 'workstation', group: 'sd', crit: 3, owner: 'marc', loc: '1er étage', attrs: { model: 'Dell OptiPlex 7010', os: 'Windows 11', serial: 'DL7010-4822', user: 'Marc Dubois' } },
  { name: 'PC-CGIRARD', cls: 'workstation', group: 'sd', crit: 3, owner: 'chloe', loc: 'RDC', attrs: { model: 'HP EliteDesk 800', os: 'Windows 11', serial: 'HP800-1177', user: 'Chloé Girard' } },
  { name: 'LAPTOP-SBENALI', cls: 'workstation', group: 'sd', crit: 3, owner: 'sarah', attrs: { model: 'Lenovo T14', os: 'Windows 11', serial: 'LNT14-0931', user: 'Sarah Benali' } },
  { name: 'LAPTOP-KHADDAD', cls: 'workstation', group: 'sd', crit: 3, owner: 'karim', attrs: { model: 'Lenovo T14', os: 'Ubuntu 24.04', serial: 'LNT14-0932', user: 'Karim Haddad' } },
  // Périphériques
  { name: 'IMP-ETAGE2', cls: 'peripheral', group: 'sd', crit: 3, loc: '2e étage', attrs: { model: 'Ricoh IM C3000', ip_address: '10.0.2.50' } },
  { name: 'IMP-RDC', cls: 'peripheral', group: 'sd', crit: 3, loc: 'RDC', attrs: { model: 'Ricoh IM C2000', ip_address: '10.0.0.50' } }
];

const RELATIONS = [
  ['SRV-APP-01', 'hosts', 'APP-ERP'],
  ['SRV-APP-01', 'hosts', 'APP-PAIE'],
  ['SRV-DB-01', 'hosts', 'DB-ERP'],
  ['SRV-DB-01', 'hosts', 'DB-CRM'],
  ['SRV-DB-01', 'hosts', 'DB-INTRANET'],
  ['SRV-WEB-01', 'hosts', 'APP-CRM'],
  ['SRV-WEB-01', 'hosts', 'APP-INTRANET'],
  ['SRV-MAIL-01', 'hosts', 'APP-MESSAGERIE'],
  ['SRV-FILE-01', 'hosts', 'APP-GED'],
  ['APP-ERP', 'depends_on', 'DB-ERP'],
  ['APP-PAIE', 'depends_on', 'DB-ERP'],
  ['APP-CRM', 'depends_on', 'DB-CRM'],
  ['APP-CRM', 'depends_on', 'APP-MESSAGERIE'],
  ['APP-INTRANET', 'depends_on', 'DB-INTRANET'],
  ['APP-MESSAGERIE', 'depends_on', 'SRV-AD-01'],
  ['APP-VPN', 'depends_on', 'FW-01'],
  ['APP-VPN', 'depends_on', 'SRV-AD-01'],
  ['APP-GED', 'depends_on', 'SRV-AD-01'],
  ['APP-BUREAUTIQUE', 'depends_on', 'SRV-AD-01'],
  ['FW-01', 'connects_to', 'RTR-WAN'],
  ['SW-CORE-01', 'connects_to', 'FW-01'],
  ['SW-ETAGE-1', 'connects_to', 'SW-CORE-01'],
  ['WIFI-CTRL', 'connects_to', 'SW-CORE-01'],
  ...['SRV-WEB-01', 'SRV-APP-01', 'SRV-DB-01', 'SRV-FILE-01', 'SRV-AD-01', 'SRV-MAIL-01', 'SRV-TOIP'].map((s) => [s, 'connects_to', 'SW-CORE-01']),
  ...['PC-LFONTAINE', 'PC-MDUBOIS', 'PC-CGIRARD', 'IMP-ETAGE2', 'IMP-RDC'].map((s) => [s, 'connects_to', 'SW-ETAGE-1']),
  ['LAPTOP-SBENALI', 'connects_to', 'WIFI-CTRL'],
  ['LAPTOP-KHADDAD', 'connects_to', 'WIFI-CTRL']
];

function seedCmdb(db, refs, now) {
  const classes = Object.fromEntries(db.prepare('SELECT code, id FROM ci_classes').all().map((c) => [c.code, c.id]));
  const ctx = { db, user: null, now: new Date(now.getTime() - 90 * 86400000) };
  const ids = {};
  for (const ci of CIS) {
    ids[ci.name] = createCi(ctx, {
      name: ci.name,
      class_id: classes[ci.cls],
      criticality: ci.crit,
      support_group_id: refs.groups[ci.group],
      owner_id: ci.owner ? refs.users[ci.owner] : null,
      location: ci.loc || null,
      description: ci.desc || null,
      attributes: ci.attrs
    }).id;
  }
  for (const [source, type, target] of RELATIONS) addRelation(ctx, ids[source], ids[target], type);
  refs.cis = ids;
  return `${CIS.length} CI, ${RELATIONS.length} relations`;
}

module.exports = { seedCmdb, CIS, RELATIONS };
