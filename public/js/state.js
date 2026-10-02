import { api } from './api.js';

/** État partagé de la session et caches des données de référence. */
export const session = { user: null };

const ROLE_RANK = { user: 0, agent: 1, manager: 2, admin: 3 };
export const hasRole = (minimum, user = session.user) => Boolean(user) && ROLE_RANK[user.role] >= ROLE_RANK[minimum];
export const isStaff = () => hasRole('agent');

const cache = new Map();

/** Données de référence peu changeantes, chargées une fois par session. */
export function cached(key, loader) {
  if (!cache.has(key)) {
    const promise = loader().catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, promise);
  }
  return cache.get(key);
}

export function invalidate(prefix) {
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}

export const getGroups = () => cached('groups', () => api.get('/api/groups').then((r) => r.items));
export const getCategories = (scope) =>
  cached(`categories:${scope}`, () => api.get('/api/categories', { scope }).then((r) => r.items));

/** Catégories → libellés « Parent › Enfant », pour les listes déroulantes. */
export function categoryOptions(categories, { leavesOnly = false } = {}) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const hasChildren = new Set(categories.filter((c) => c.parent_id).map((c) => c.parent_id));
  return categories
    .filter((c) => c.is_active && (!leavesOnly || !hasChildren.has(c.id)))
    .map((c) => ({ value: c.id, label: c.parent_id ? `${byId.get(c.parent_id)?.name} › ${c.name}` : c.name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  try {
    localStorage.setItem('relais.theme', theme || 'system');
  } catch {
    /* stockage indisponible : le thème reste celui du compte */
  }
}
