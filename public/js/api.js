/** Client de l'API : JSON, en-tête anti-CSRF, erreurs typées. */

export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error?.message || `Erreur ${status}`);
    this.status = status;
    this.code = payload?.error?.code;
    this.details = payload?.error?.details;
  }
}

async function request(method, url, body) {
  const options = {
    method,
    headers: { Accept: 'application/json', 'X-Requested-With': 'relais' },
    credentials: 'same-origin'
  };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new ApiError(0, { error: { code: 'offline', message: 'Serveur injoignable (hors ligne ?)' } });
  }

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    // Session perdue : retour à la connexion, sauf pendant la connexion elle-même.
    if (response.status === 401 && !url.startsWith('/api/auth/login')) {
      window.location.assign('/login');
    }
    throw new ApiError(response.status, payload);
  }
  return payload;
}

/** Construit une query string en ignorant les valeurs vides. */
export function qs(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const api = {
  get: (url, params) => request('GET', url + qs(params)),
  post: (url, body = {}) => request('POST', url, body),
  patch: (url, body = {}) => request('PATCH', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url)
};
