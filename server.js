'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');

const { config, assertConfig } = require('./config');
const { openDatabase } = require('./db/index');
const { SqliteSessionStore } = require('./auth/session-store');
const { loadUser, requireAjaxHeader } = require('./auth/middleware');
const { HttpError } = require('./lib/http-errors');
const { version } = require('./package.json');

const PUBLIC_DIR = path.join(__dirname, 'public');

function securityHeaders(_req, res, next) {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      // Gridstack et cytoscape posent des styles en ligne (positions).
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self'",
      "manifest-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });
  next();
}

function errorHandler(err, req, res, _next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'bad_json', message: 'JSON invalide' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'too_large', message: 'Requête trop volumineuse' } });
  }
  if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return res.status(400).json({ error: { code: 'bad_reference', message: 'Référence invalide (élément inexistant)' } });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  console.error(`[${req.method} ${req.originalUrl}]`, err);
  res.status(500).json({ error: { code: 'internal', message: 'Erreur interne' } });
}

/**
 * Construit l'application sans écouter de port : les tests l'utilisent
 * avec une base en mémoire.
 */
function createApp({ db, appConfig = config, ai = null }) {
  const app = express();
  app.disable('x-powered-by');
  if (appConfig.isProd) app.set('trust proxy', 1);

  const sessionStore = new SqliteSessionStore(db);
  // Client IA : injectable (tests) ; sans clé, il répond « indisponible ».
  const aiClient = ai || require('./ai/client').createAiClient({ apiKey: appConfig.anthropicApiKey, model: appConfig.anthropicModel });
  const deps = { db, config: appConfig, sessionStore, version, ai: aiClient };

  app.use(securityHeaders);
  app.use(express.json({ limit: '200kb' }));
  app.use(
    session({
      name: 'relais.sid',
      secret: appConfig.sessionSecret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: appConfig.isProd,
        maxAge: 1000 * 60 * 60 * 24 * 7
      }
    })
  );
  app.use(loadUser(db));

  app.use('/api', requireAjaxHeader, (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', require('./routes')(deps));

  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      setHeaders(res, file) {
        // Le service worker et le shell doivent toujours être relus.
        if (file.endsWith('sw.js') || file.endsWith('.html')) res.set('Cache-Control', 'no-cache');
      }
    })
  );

  app.get('/login', (req, res) => (req.user ? res.redirect('/') : res.sendFile(path.join(PUBLIC_DIR, 'login.html'))));
  // Fallback SPA : toute autre route GET renvoie le shell (routage côté client).
  // Un fichier absent (chemin avec extension) répond 404 : servi en 200, le
  // HTML du shell serait mis en cache par le service worker à la place du script.
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (path.extname(req.path)) return res.status(404).type('text/plain').send('Introuvable');
    if (!req.user) return res.redirect('/login');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.use(errorHandler);
  app.locals.deps = deps;
  return app;
}

async function start() {
  assertConfig();
  require('./db/storage').report(config.databasePath);
  const db = openDatabase(config.databasePath, { log: console });

  await require('./db/bootstrap').bootstrap(db, config);

  const { configureChannels } = require('./notifications/service');
  const { createEmailChannel } = require('./notifications/channels/email');
  configureChannels([createEmailChannel({ enabled: config.emailEnabled, appUrl: config.appUrl, log: console })]);

  const app = createApp({ db });
  if (config.cronEnabled) require('./jobs').startJobs(db);

  app.listen(config.port, () => {
    console.log(`Relais ${version} sur ${config.appUrl} (${config.env})`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createApp };
