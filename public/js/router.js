/**
 * Routeur par hash : '#/incidents/42' → route '/incidents/:id' avec { id: '42' }.
 * Une vue est une fonction (container, params, query) qui peut renvoyer une
 * fonction de nettoyage, appelée au changement de page.
 */

const routes = [];
let cleanup = null;
let notFoundView = null;

export function route(pattern, view, meta = {}) {
  const keys = [];
  const regex = new RegExp(
    `^${pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    })}$`
  );
  routes.push({ pattern, regex, keys, view, meta });
}

export function setNotFound(view) {
  notFoundView = view;
}

export function navigate(path) {
  if (window.location.hash === `#${path}`) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else window.location.hash = path;
}

export function currentPath() {
  return (window.location.hash.slice(1) || '/').split('?')[0];
}

export function currentQuery() {
  return Object.fromEntries(new URLSearchParams(window.location.hash.split('?')[1] || ''));
}

export function startRouter(container, onRoute) {
  const render = async () => {
    const path = currentPath();
    const query = currentQuery();
    if (typeof cleanup === 'function') cleanup();
    cleanup = null;
    let matched = null;
    let params = {};
    for (const r of routes) {
      const m = path.match(r.regex);
      if (m) {
        matched = r;
        params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        break;
      }
    }
    if (onRoute?.(matched, path) === false) return;
    container.replaceChildren();
    window.scrollTo(0, 0);
    const view = matched ? matched.view : notFoundView;
    try {
      cleanup = await view(container, params, query);
    } catch (err) {
      console.error(err);
      container.textContent = `Erreur : ${err.message}`;
    }
  };
  window.addEventListener('hashchange', render);
  render();
}
