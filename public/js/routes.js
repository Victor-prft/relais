import { route } from './router.js';
import { homeView } from './views/home.js';
import { portalHomeView } from './views/portal/home.js';
import { adminUsersView, adminGroupsView } from './views/admin/people.js';

/**
 * Table des routes et de la navigation. `space` choisit la coquille (console
 * ou portail) ; `role` est le rôle minimal (vérifié aussi côté serveur).
 */
export const CONSOLE_NAV = [
  { items: [{ path: '/', label: 'Tableau de bord', icon: 'grid' }] },
  {
    title: 'Administration',
    role: 'admin',
    items: [
      { path: '/admin/users', label: 'Utilisateurs', icon: 'users', role: 'admin' },
      { path: '/admin/groups', label: 'Groupes', icon: 'users', role: 'admin' }
    ]
  }
];

export const PORTAL_NAV = [{ path: '/portal', label: 'Accueil', icon: 'home' }];

export function registerRoutes() {
  route('/', homeView, { title: 'Tableau de bord', role: 'agent' });
  route('/portal', portalHomeView, { title: 'Accueil', space: 'portal' });
  route('/admin/users', adminUsersView, { title: 'Utilisateurs', role: 'admin' });
  route('/admin/groups', adminGroupsView, { title: 'Groupes', role: 'admin' });
}
