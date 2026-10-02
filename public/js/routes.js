import { route } from './router.js';
import { homeView } from './views/home.js';
import { portalHomeView } from './views/portal/home.js';
import { portalTicketsView } from './views/portal/tickets.js';
import { portalTicketView } from './views/portal/ticket.js';
import { portalIncidentNewView } from './views/portal/incident-new.js';
import { adminUsersView, adminGroupsView } from './views/admin/people.js';
import { incidentListView } from './views/incidents/list.js';
import { incidentFormView } from './views/incidents/form.js';
import { goView, searchView } from './views/search.js';

/**
 * Table des routes et de la navigation. `space` choisit la coquille (console
 * ou portail) ; `role` est le rôle minimal (vérifié aussi côté serveur).
 */
export const CONSOLE_NAV = [
  { items: [{ path: '/', label: 'Tableau de bord', icon: 'grid' }] },
  {
    title: 'Service',
    items: [{ path: '/incidents', label: 'Incidents', icon: 'alert' }]
  },
  {
    title: 'Administration',
    role: 'admin',
    items: [
      { path: '/admin/users', label: 'Utilisateurs', icon: 'users', role: 'admin' },
      { path: '/admin/groups', label: 'Groupes', icon: 'users', role: 'admin' }
    ]
  }
];

export const PORTAL_NAV = [
  { path: '/portal', label: 'Accueil', icon: 'home' },
  { path: '/portal/incident/new', label: 'Signaler un problème', icon: 'alert' },
  { path: '/portal/tickets', label: 'Mes tickets', icon: 'inbox' }
];

export function registerRoutes() {
  route('/', homeView, { title: 'Tableau de bord', role: 'agent' });
  route('/go/:number', goView, { title: 'Recherche' });
  route('/search', searchView, { title: 'Recherche', role: 'agent' });

  route('/incidents', incidentListView, { title: 'Incidents', role: 'agent' });
  route('/incidents/:id', incidentFormView, { title: 'Incident', role: 'agent' });

  route('/portal', portalHomeView, { title: 'Accueil', space: 'portal' });
  route('/portal/incident/new', portalIncidentNewView, { title: 'Signaler un problème', space: 'portal' });
  route('/portal/tickets', portalTicketsView, { title: 'Mes tickets', space: 'portal' });
  route('/portal/tickets/:id', portalTicketView, { title: 'Ticket', space: 'portal' });

  route('/admin/users', adminUsersView, { title: 'Utilisateurs', role: 'admin' });
  route('/admin/groups', adminGroupsView, { title: 'Groupes', role: 'admin' });
}
