'use strict';

/**
 * Charge les abonnés aux événements des tickets. Requis par tickets/service.js
 * après ses exports : où que le service soit utilisé (API, jobs, seed, tests),
 * les abonnés sont branchés.
 */
require('../incidents/hooks');
require('../sla/subscribers');
require('../notifications/subscribers');
