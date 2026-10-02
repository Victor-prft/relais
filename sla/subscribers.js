'use strict';

const hooks = require('../tickets/hooks');
const engine = require('./engine');

/** Les SLA suivent le ticket, dans la même transaction que son écriture. */
hooks.on('created', (ctx, ticket) => engine.onTicketCreated(ctx, ticket));
hooks.on('updated', (ctx, before, after) => engine.onTicketUpdated(ctx, before, after));
