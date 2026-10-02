'use strict';

/** Société fictive « Tessel » : 10 comptes, 3 groupes de support. */

const USERS = [
  { key: 'admin', email: 'admin@relais.test', full_name: 'Camille Martin', role: 'admin', department: 'DSI' },
  { key: 'helene', email: 'helene.marchand@relais.test', full_name: 'Hélène Marchand', role: 'manager', department: 'DSI' },
  { key: 'julien', email: 'julien.roux@relais.test', full_name: 'Julien Roux', role: 'manager', department: 'DSI' },
  { key: 'sarah', email: 'sarah.benali@relais.test', full_name: 'Sarah Benali', role: 'agent', department: 'DSI', manager: 'helene' },
  { key: 'thomas', email: 'thomas.lefevre@relais.test', full_name: 'Thomas Lefèvre', role: 'agent', department: 'DSI', manager: 'helene' },
  { key: 'ines', email: 'ines.moreau@relais.test', full_name: 'Inès Moreau', role: 'agent', department: 'DSI', manager: 'helene' },
  { key: 'karim', email: 'karim.haddad@relais.test', full_name: 'Karim Haddad', role: 'agent', department: 'DSI', manager: 'julien' },
  { key: 'lea', email: 'lea.fontaine@relais.test', full_name: 'Léa Fontaine', role: 'user', department: 'Comptabilité', manager: 'julien' },
  { key: 'marc', email: 'marc.dubois@relais.test', full_name: 'Marc Dubois', role: 'user', department: 'Commercial', manager: 'helene' },
  { key: 'chloe', email: 'chloe.girard@relais.test', full_name: 'Chloé Girard', role: 'user', department: 'Ressources humaines', manager: 'julien' }
];

const GROUPS = [
  { key: 'sd', name: 'Service Desk', description: 'Premier niveau : prise en charge, postes de travail, comptes', manager: 'helene', members: ['sarah', 'thomas'] },
  { key: 'infra', name: 'Infrastructure', description: 'Serveurs, réseau, sauvegardes', manager: 'helene', members: ['ines', 'thomas'] },
  { key: 'apps', name: 'Applications', description: 'ERP, CRM, messagerie, applications métier', manager: 'julien', members: ['karim', 'sarah'] }
];

const DEMO_PASSWORD = 'relais2026';

module.exports = { USERS, GROUPS, DEMO_PASSWORD };
