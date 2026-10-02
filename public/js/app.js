import { api } from './api.js';
import { h, mount, initials } from './ui/dom.js';
import { icons } from './ui/icons.js';
import { popover, toastError } from './ui/feedback.js';
import { startRouter, navigate, setNotFound, currentPath } from './router.js';
import { session, hasRole, applyTheme } from './state.js';
import { registerRoutes, CONSOLE_NAV, PORTAL_NAV } from './routes.js';
import { mountBell } from './ui/notifications.js';

const root = document.getElementById('app');
let currentSpace = null;
let contentEl = null;
let titleEl = null;
const navLinks = [];

function navLink(item, className = '') {
  const link = h('a', { href: `#${item.path}`, class: className }, item.icon ? icons[item.icon]() : null, h('span', {}, item.label));
  link.dataset.path = item.path;
  navLinks.push(link);
  return link;
}

function themeButton() {
  const btn = h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': 'Changer de thème' });
  const paint = () => {
    const dark = document.documentElement.dataset.theme === 'dark' ||
      (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    btn.replaceChildren(dark ? icons.sun() : icons.moon());
  };
  btn.addEventListener('click', async () => {
    const dark = document.documentElement.dataset.theme === 'dark' ||
      (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    const theme = dark ? 'light' : 'dark';
    applyTheme(theme);
    paint();
    api.patch('/api/auth/me/preferences', { theme }).catch(toastError);
  });
  paint();
  return btn;
}

function userMenu() {
  const user = session.user;
  const btn = h('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Mon compte' }, h('span', { class: 'avatar' }, initials(user.full_name)));
  btn.addEventListener('click', () =>
    popover(btn, (pop, close) => {
      pop.classList.add('menu');
      pop.append(
        h('div', { style: { padding: '8px 10px' } }, h('strong', {}, user.full_name), h('div', { class: 'small muted' }, `${user.email} · ${user.role}`)),
        h('hr', { style: { margin: '4px 0' } }),
        hasRole('agent') && currentSpace === 'console'
          ? h('a', { href: '#/portal', onclick: close }, icons.home(), 'Portail self-service')
          : null,
        hasRole('agent') && currentSpace === 'portal'
          ? h('a', { href: '#/', onclick: close }, icons.grid(), 'Console agent')
          : null,
        h('button', {
          type: 'button',
          onclick: async () => {
            await api.post('/api/auth/logout').catch(() => {});
            window.location.assign('/login');
          }
        }, icons.logout(), 'Se déconnecter')
      );
    })
  );
  return btn;
}

function searchBox() {
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Rechercher, ou INC0001001…', 'aria-label': 'Recherche globale' });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    const q = input.value.trim();
    if (/^(INC|REQ|TASK|CHG|KB)\d{7}$/i.test(q)) navigate(`/go/${q.toUpperCase()}`);
    else navigate(`/search?q=${encodeURIComponent(q)}`);
    input.value = '';
  });
  return h('div', { class: 'search' }, input);
}

function buildConsole() {
  navLinks.length = 0;
  const sidebar = h('aside', { class: 'sidebar' },
    h('a', { class: 'brand', href: '#/' }, h('img', { src: '/icons/icon-192.png', alt: '' }), h('span', {}, 'Relais', h('small', {}, 'Console'))),
    CONSOLE_NAV.filter((s) => hasRole(s.role || 'agent')).map((section) =>
      h('nav', { class: 'nav' },
        section.title ? h('div', { class: 'nav-section' }, section.title) : null,
        section.items.filter((i) => hasRole(i.role || 'agent')).map((item) => navLink(item))
      )
    )
  );
  titleEl = h('div', { class: 'title' });
  contentEl = h('main', { class: 'content', id: 'content' });
  const app = h('div', { class: 'app' },
    sidebar,
    h('div', { class: 'main' },
      h('header', { class: 'topbar' },
        h('button', { class: 'btn ghost icon menu-toggle', type: 'button', 'aria-label': 'Menu', onclick: () => app.classList.toggle('nav-open') }, icons.menu()),
        titleEl,
        searchBox(),
        mountBell(),
        themeButton(),
        userMenu()
      ),
      contentEl
    )
  );
  app.addEventListener('click', (e) => {
    if (e.target === app || e.target.closest('.sidebar a')) app.classList.remove('nav-open');
  });
  mount(root, app);
}

function buildPortal() {
  navLinks.length = 0;
  titleEl = h('div', { class: 'sr-only' });
  contentEl = h('main', { class: 'content narrow', id: 'content' });
  const mobileMenu = h('button', { class: 'btn ghost icon menu-toggle', type: 'button', 'aria-label': 'Menu' }, icons.menu());
  mobileMenu.addEventListener('click', () =>
    popover(mobileMenu, (pop, close) => {
      pop.classList.add('menu');
      for (const item of PORTAL_NAV) pop.append(h('a', { href: `#${item.path}`, onclick: close }, icons[item.icon](), item.label));
    })
  );
  mount(root,
    h('div', { class: 'portal' },
      h('header', { class: 'topbar' },
        mobileMenu,
        h('a', { class: 'brand', href: '#/portal' }, h('img', { src: '/icons/icon-192.png', alt: '' }), h('span', {}, 'Relais', h('small', {}, 'Support'))),
        h('nav', { class: 'portal-nav' }, PORTAL_NAV.map((item) => navLink(item))),
        h('div', { style: { marginLeft: 'auto' } }),
        mountBell(),
        themeButton(),
        userMenu(),
        titleEl
      ),
      contentEl
    )
  );
}

function highlightNav(path) {
  let best = null;
  for (const link of navLinks) {
    const p = link.dataset.path;
    const match = p === path || (p !== '/' && p !== '/portal' && path.startsWith(`${p}/`)) || (p === path.split('?')[0]);
    if (match && (!best || p.length > best.dataset.path.length)) best = link;
  }
  for (const link of navLinks) link.classList.toggle('active', link === best);
}

/** Titre de page (barre du haut + onglet du navigateur). */
export function setTitle(text) {
  if (titleEl) titleEl.textContent = text;
  document.title = text ? `${text} · Relais` : 'Relais';
}

async function boot() {
  try {
    const { user } = await api.get('/api/auth/me');
    session.user = user;
  } catch {
    return; // api.js redirige vers /login sur 401
  }
  applyTheme(session.user.preferences?.theme);
  registerRoutes();
  setNotFound((el) => mount(el, h('div', { class: 'empty' }, h('h2', {}, 'Page introuvable'), h('a', { href: '#/' }, 'Retour à l’accueil'))));

  // Un utilisateur simple n'a que le portail.
  if (!hasRole('agent') && !currentPath().startsWith('/portal')) {
    window.location.hash = '/portal';
  }

  const holder = document.createElement('div');
  startRouter(holder, (matched, path) => {
    const space = matched?.meta.space || (path.startsWith('/portal') ? 'portal' : 'console');
    if (matched?.meta.role && !hasRole(matched.meta.role)) {
      navigate(hasRole('agent') ? '/' : '/portal');
      return false;
    }
    if (space !== currentSpace) {
      currentSpace = space;
      if (space === 'portal' || !hasRole('agent')) buildPortal();
      else buildConsole();
      contentEl.append(holder);
    }
    setTitle(matched?.meta.title || '');
    highlightNav(path);
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

boot();
