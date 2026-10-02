import { route } from './router.js';
import { dashboardView } from './views/dashboard/index.js';
import { portalHomeView } from './views/portal/home.js';
import { portalTicketsView } from './views/portal/tickets.js';
import { portalTicketView } from './views/portal/ticket.js';
import { portalIncidentNewView } from './views/portal/incident-new.js';
import { adminUsersView, adminGroupsView } from './views/admin/people.js';
import { incidentListView } from './views/incidents/list.js';
import { incidentFormView } from './views/incidents/form.js';
import { goView, searchView } from './views/search.js';
import { cmdbListView } from './views/cmdb/list.js';
import { ciFormView } from './views/cmdb/form.js';
import { adminSlaView } from './views/admin/sla.js';
import { adminCatalogView, adminCatalogItemView } from './views/admin/catalog.js';
import { requestListView, requestFormView, taskListView, taskFormView } from './views/requests/index.js';
import { approvalsView } from './views/approvals.js';
import { portalCatalogView, portalCatalogItemView } from './views/portal/catalog.js';

/**
 * Table des routes et de la navigation. `space` choisit la coquille (console
 * ou portail) ; `role` est le rôle minimal (vérifié aussi côté serveur).
 */
export const CONSOLE_NAV = [
  { items: [{ path: '/', label: 'Tableau de bord', icon: 'grid' }] },
  {
    title: 'Service',
    items: [
      { path: '/incidents', label: 'Incidents', icon: 'alert' },
      { path: '/requests', label: 'Demandes', icon: 'inbox' },
      { path: '/tasks', label: 'Tâches', icon: 'task' },
      { path: '/approvals', label: 'Approbations', icon: 'approve', role: 'manager' }
    ]
  },
  {
    title: 'Configuration',
    items: [{ path: '/cmdb', label: 'CMDB', icon: 'server' }]
  },
  {
    title: 'Administration',
    role: 'admin',
    items: [
      { path: '/admin/users', label: 'Utilisateurs', icon: 'users', role: 'admin' },
      { path: '/admin/groups', label: 'Groupes', icon: 'users', role: 'admin' },
      { path: '/admin/sla', label: 'SLA et délais', icon: 'clock', role: 'admin' },
      { path: '/admin/catalog', label: 'Catalogue', icon: 'package', role: 'admin' }
    ]
  }
];

export const PORTAL_NAV = [
  { path: '/portal', label: 'Accueil', icon: 'home' },
  { path: '/portal/incident/new', label: 'Signaler un problème', icon: 'alert' },
  { path: '/portal/catalog', label: 'Catalogue', icon: 'package' },
  { path: '/portal/tickets', label: 'Mes tickets', icon: 'inbox' }
];

export function registerRoutes() {
  route('/', dashboardView, { title: 'Tableau de bord', role: 'agent' });
  route('/go/:number', goView, { title: 'Recherche' });
  route('/search', searchView, { title: 'Recherche', role: 'agent' });

  route('/incidents', incidentListView, { title: 'Incidents', role: 'agent' });
  route('/incidents/:id', incidentFormView, { title: 'Incident', role: 'agent' });

  route('/requests', requestListView, { title: 'Demandes', role: 'agent' });
  route('/requests/:id', requestFormView, { title: 'Demande', role: 'agent' });
  route('/tasks', taskListView, { title: 'Tâches', role: 'agent' });
  route('/tasks/:id', taskFormView, { title: 'Tâche', role: 'agent' });
  route('/approvals', approvalsView, { title: 'Approbations', role: 'agent' });

  route('/cmdb', cmdbListView, { title: 'CMDB', role: 'agent' });
  route('/cmdb/:id', ciFormView, { title: 'Élément de configuration', role: 'agent' });

  route('/portal', portalHomeView, { title: 'Accueil', space: 'portal' });
  route('/portal/incident/new', portalIncidentNewView, { title: 'Signaler un problème', space: 'portal' });
  route('/portal/catalog', portalCatalogView, { title: 'Catalogue', space: 'portal' });
  route('/portal/catalog/:id', portalCatalogItemView, { title: 'Catalogue', space: 'portal' });
  route('/portal/tickets', portalTicketsView, { title: 'Mes tickets', space: 'portal' });
  route('/portal/tickets/:id', portalTicketView, { title: 'Ticket', space: 'portal' });

  route('/admin/users', adminUsersView, { title: 'Utilisateurs', role: 'admin' });
  route('/admin/groups', adminGroupsView, { title: 'Groupes', role: 'admin' });
  route('/admin/sla', adminSlaView, { title: 'SLA et délais', role: 'admin' });
  route('/admin/catalog', adminCatalogView, { title: 'Catalogue', role: 'admin' });
  route('/admin/catalog/:id', adminCatalogItemView, { title: 'Article du catalogue', role: 'admin' });
}
