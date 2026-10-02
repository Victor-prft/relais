# Relais

Plateforme ITSM (gestion des services IT) inspirée du module ITSM de ServiceNow :
incidents, demandes de service, changements, CMDB, SLA, base de connaissances.
On reprend les **concepts métier ITIL**, pas l'identité visuelle : l'interface est originale.
Projet solo, deux buts : portfolio et apprentissage d'ITIL. Petite échelle (dizaines
d'utilisateurs) : on privilégie la simplicité et la lisibilité, pas la scalabilité.

## Stack

- Back : Node.js 22 + Express 5, API REST JSON sous `/api/*` (Node 20 n'est plus maintenu depuis le 30/04/2026)
- Base : SQLite via `better-sqlite3` (API **synchrone**, requêtes préparées uniquement)
  - chemin : `DATABASE_PATH` (défaut `./db/relais.db`, prod `/data/relais.db` sur le volume Railway)
  - migrations versionnées `db/migrations/NNN_description.sql` + `db/seed.js`
- Auth : comptes locaux email + mot de passe (`bcryptjs`, JS pur : pas de compilation native),
  `express-session` avec un store SQLite maison (`auth/session-store.js`, table `sessions`)
- Validation : `zod` (entrées d'API et JSON renvoyé par le LLM)
- `better-sqlite3` **12.x** : la 13.0.3 plante à l'ouverture (0xC0000005) sous Windows / Node 22.12
- Front : HTML/CSS/JS vanilla (modules ES) dans `public/`, PWA (manifest + service worker), responsive
- Dashboard : Gridstack.js ; graphiques : Chart.js ; graphe CMDB : cytoscape.js ; Markdown : marked + DOMPurify
  — copiés de node_modules vers `public/vendor/` au postinstall (`tools/copy-vendor.js`), pas de CDN :
  CSP `script-src 'self'` et shell PWA hors ligne
- IA : API Anthropic, **côté serveur uniquement** (`ANTHROPIC_API_KEY`)
- Tâches planifiées : `node-cron` (SLA, clôture auto)
- Tests : `node --test` natif, fichiers `test/*.test.js`
- Déploiement : Railway (`npm start`, `railway.json`, healthcheck `/api/health`)

## Rôles

| Rôle      | Accès |
|-----------|-------|
| `user`    | portail self-service : ses tickets, catalogue, base de connaissances publiée |
| `agent`   | console : tickets de ses groupes, CMDB, rédaction d'articles |
| `manager` | + approbations (demandes, CAB), statistiques, changements |
| `admin`   | + configuration (catalogue, SLA, calendrier, groupes, utilisateurs) |

Chaque route API déclare le rôle minimal exigé (`requireRole`). Un `user` ne voit que
les tickets dont il est demandeur ou bénéficiaire.

## Règles à ne jamais oublier

- **SQL paramétré uniquement.** Les noms de colonnes de tri/filtre des listes passent
  par une liste blanche, jamais par concaténation de saisie.
- **Validation serveur sur toutes les routes** (corps, query, params). Le front ne protège rien.
- **Secrets** : jamais en dur, toujours `.env` (non commité). `.env.example` à jour.
- **Clé Anthropic** : jamais envoyée au navigateur. Toute réponse du LLM est validée par
  un schéma ; si l'appel ou la validation échoue, l'utilisateur retombe sur le formulaire
  manuel (jamais d'erreur bloquante).
- **Migrations** : ne jamais modifier ni retirer une migration jouée — on la défait par
  une migration de plus.
- **Dates** : stockées en UTC ISO 8601 (`TEXT`). Les heures ouvrées se calculent dans le
  fuseau du calendrier (Europe/Paris par défaut, changements d'heure compris).
- **Horloge injectable** : la logique métier (priorité, transitions, SLA) reçoit `now`
  en paramètre, pour être testable sans attendre.
- **CSRF** : toute requête API qui modifie exige `X-Requested-With: relais` (posé par `public/js/api.js`).
- **Contexte de requête** : les services reçoivent `ctx = { db, user, now }` (`req.ctx`). `user: null` = système (jobs, seed).
- **DOM** : jamais d'`innerHTML` avec une donnée ; `h()` de `public/js/ui/dom.js`. Seul le Markdown passe par DOMPurify.
- **Audit trail** : toute modification d'un ticket passe par `tickets/service.js`
  (`createTicket` / `updateTicket`), qui vérifie le workflow, recalcule la priorité, écrit
  l'audit (libellés figés dans `*_display`) et émet les événements (`tickets/hooks.js`) dans
  la même transaction. Pas d'`UPDATE tickets` ailleurs (seule exception : `updated_at` au journal).
- **Nouveau type de ticket** = une définition (`extTable`, `extFields`, `workflow`, `tracked`,
  `prepareCreate`, `beforeUpdate`, `decorate`) enregistrée dans `tickets/types.js`.
- **Abonnés aux événements** (SLA, notifications, relance auto) : déclarés dans
  `tickets/subscribers.js`, chargé par le service lui-même — actifs partout (API, jobs, seed, tests).
- **Verrou optimiste** : `tickets.version` ; le front envoie `version` à chaque PATCH, 409 sinon.
- **Visibilité** : `tickets/access.js`. Un `user` ne voit que ses tickets ; un ticket invisible → 404.
- **Formulaires dynamiques** : `lib/form-schema.js` (validation serveur) ↔ `public/js/ui/form-renderer.js`
  (rendu). Même format pour les attributs de classe de CI et le catalogue de services.
- **Propagation d'impact CMDB** : portée par `ci_relation_types.impact` (`to_source` / `to_target`),
  pas codée en dur ; `cmdb/graph.js` borne la récursion (`MAX_DEPTH`).
- **Cytoscape** : identifiants de nœuds préfixés (`n12`) — `#12` n'est pas un sélecteur valide.
- **Listes** : `lib/list-query.js` — champs, opérateurs et tri en liste blanche (définition par
  liste, ex. `incidents/list.js`), valeurs en paramètres nommés. Symboles `@me`, `@mygroups`, `@days:-7`.

## Conventions

- CommonJS, `'use strict'`, un dossier par domaine métier, routes fines dans `routes/`.
- Code et identifiants en anglais ; textes d'interface, commentaires et commits en français.
- Commits atomiques, état fonctionnel à chaque commit ; un tag par phase (`v0.x.0`).
- Un bug corrigé = un test qui échoue avant et passe après.
- Réponses d'erreur : `{ error: { code, message, details? } }` avec le bon statut HTTP.

## Arborescence

```
relais/
├── server.js          # createApp() (testable) + start() : CSP, sessions, /api, fallback SPA
├── config.js          # lecture et contrôle des variables d'env (seul lecteur de process.env)
├── db/                # connexion, migrate, seed (+ seed/ données), bootstrap, storage (volume), migrations/
├── jobs/              # branchement node-cron des tâches planifiées
├── auth/              # mots de passe, sessions, middlewares de rôle
├── lib/               # validation, erreurs HTTP, requêtes de liste, horloge
├── tickets/           # socle commun INC/REQ/TASK/CHG : numérotation, journal, audit
├── incidents/         # priorité, cycle de vie, service
├── requests/          # catalogue, formulaires dynamiques, tâches
├── changes/           # workflow, conflits, calendrier
├── approvals/         # approbations (demandes, CAB)
├── cmdb/              # CI, relations, graphe
├── sla/               # heures ouvrées, moteur SLA, job cron
├── kb/                # articles, recherche FTS5
├── notifications/     # in-app + canal email (stub)
├── ai/                # client Anthropic, prompts, schémas de sortie
├── dashboard/         # requêtes des widgets, layouts
├── routes/            # un fichier par ressource
├── public/            # PWA (portail + console)
├── test/
└── tools/
```

## Commandes

```
npm install
npm run dev          # serveur avec rechargement
npm start            # production
npm test             # node --test
npm run db:migrate
npm run db:seed      # base de démo (efface et recrée la base ; refusé en prod sans --force)
npm run icons        # régénère les icônes PWA
```

Port par défaut **3100** (3000 est souvent pris par Cairn). Comptes de démo : `*@relais.test`,
mot de passe `relais2026` (affichés sur /login quand `DEMO_MODE` est actif).

## Variables d'environnement

`PORT`, `NODE_ENV`, `APP_URL`, `DATABASE_PATH`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`,
`ANTHROPIC_MODEL`, `DEMO_MODE`, `SEED_ON_EMPTY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CRON_ENABLED`,
`EMAIL_ENABLED` — tout est documenté dans `.env.example`.

## Journal d'avancement

| Phase | Contenu | Version | État |
|-------|---------|---------|------|
| 0 | Cadrage : CLAUDE.md, schéma, arborescence | — | fait |
| 1 | Socle : structure, migrations, seed, auth, rôles, layout, PWA | v0.1.0 | fait |
| 2 | Incidents : liste, formulaire, cycle de vie, audit trail | v0.2.0 | fait |
| 3 | CMDB + liens incidents/CI + graphe | v0.3.0 | fait |
| 4 | SLA + job planifié + notifications | v0.4.0 | à faire |
| 5 | Dashboard Gridstack + widgets | v0.5.0 | à faire |
| 6 | Catalogue de services + approbations | v0.6.0 | à faire |
| 7 | Changements + calendrier | v0.7.0 | à faire |
| 8 | Base de connaissances + IA | v0.8.0 | à faire |
| 9 | Prod Railway (volume, env, healthcheck) | v1.0.0 | à faire |

### Phase 0 — cadrage (02/10/2026)
- Schéma et arborescence validés : table commune `tickets` + tables d'extension, Node 22, bcryptjs,
  vendor local, zod.

### Phase 1 — socle (02/10/2026)
- Migration `001_socle` : users, support_groups, group_members, categories, number_sequences, settings, sessions.
- Auth : login (limité à 10 essais / 15 min par IP+email, même réponse compte connu ou non), logout,
  /me, préférences (thème), changement de mot de passe. Désactiver un compte ou changer son rôle coupe ses sessions.
- Rôles cumulatifs `user < agent < manager < admin` (`auth/roles.js`), `requireRole` sur chaque route.
- Admin : utilisateurs, groupes (membres), catégories, réglages. Le dernier admin actif est protégé.
- Front : coquille console (barre latérale) et portail (navigation haute), routeur par hash, thème
  clair/sombre, page de connexion avec comptes de démo, PWA (manifest, sw.js, icônes générées).
- Tests : `test/auth.test.js` (401, énumération, CSRF, rôles, dernier admin, sessions coupées, healthcheck).

### Phase 2 — incidents (03/10/2026)
- Migration `002` : tickets (table commune), incidents, journal_entries, audit_entries,
  ticket_relations, list_preferences, saved_filters + 16 catégories d'incident.
- Priorité ITIL `incidents/priority.js` (matrice explicite), workflow déclaratif `lib/workflow.js`
  + `incidents/workflow.js` (transitions support / demandeur, frise, alias En attente → En cours).
- Règles : agent assigné = support actif membre du groupe (groupe déduit sinon), Nouveau + agent
  → Assigné, attente avec motif, résolution avec code + notes, réouverture comptée, première prise
  en charge datée, ticket clos/annulé figé. Réponse du demandeur à un « En attente du demandeur »
  → En cours (`incidents/hooks.js`). Clôture auto après `incident.auto_close_days` (job horaire).
- API : `/api/incidents` (liste, création routée par catégorie, PATCH versionné),
  `/api/tickets/:id` (+ activity, journal, relations), `/api/tickets/by-number`, `/api/tickets/search`,
  `/api/lists/:key` (colonnes, vues enregistrées), `/api/portal/tickets`.
- Front : vue liste réutilisable (`ui/list-view.js` : vues prédéfinies + enregistrées, filtres
  combinables, colonnes, tri, pagination, état gardé en sessionStorage), fiche à onglets
  (`ui/record.js`, `ui/activity.js`, `ui/relations.js`), console incidents, portail (déclaration
  sans jargon ITIL, mes tickets, fiche avec confirmer / rouvrir / répondre), `#/go/NUMÉRO`, recherche.
- Seed : 150 incidents joués étape par étape sur 60 jours (heures ouvrées de Paris, `lib/tz.js`),
  dont 3 incidents majeurs P1 avec doublons liés ; les tickets récents restent en file.
- Tests : priorité, transitions, cycle de vie complet via le service, API (visibilité, routage,
  version, injection dans les filtres et le tri, @me/@mygroups, journal, liens, vues).

### Phase 3 — CMDB (03/10/2026)
- Migration `003` : ci_classes (6 classes, schéma d'attributs JSON), cis, ci_relation_types
  (dépend de / héberge / est connecté à, avec sens de propagation), ci_relations, `tickets.ci_id`
  (ALTER : une FK vers une table absente bloque toute écriture), ticket_cis.
- `cmdb/service.js` : CRUD avec audit (entité `ci`), attributs validés contre la classe, relations
  (ni soi-même, ni doublon, ni hébergement réciproque). `cmdb/graph.js` : voisinage borné et analyse
  d'impact par CTE récursive.
- API `/api/cis` (agent+) : liste, fiche + relations, graphe, impact, tickets liés, historique.
- Front : liste CMDB (vues par classe, « avec incidents ouverts »), fiche CI (attributs dynamiques,
  graphe concentrique cytoscape, relations, incidents, changements, historique, analyse d'impact),
  CI sur la fiche incident, « Déclarer un incident » depuis un CI, CI dans la recherche globale.
- Seed : 30 CI, 37 relations ; les incidents pointent vers des CI plausibles.
- Tests : formulaires dynamiques, règles de relation, propagation d'impact (dépendance, hébergement,
  réseau, boucle), voisinage, audit CI, API (accès, liste, graphe, incidents liés, CI inexistant → 400).
