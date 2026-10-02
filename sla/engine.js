'use strict';

const { loadCalendar, businessMinutesBetween, addBusinessMinutes } = require('./business-time');
const { getSetting } = require('../lib/settings');

/**
 * Moteur SLA. Appelé par les abonnés aux événements des tickets (dans la
 * transaction de l'écriture) et par le job périodique.
 *
 * Règles (par type de ticket, cf. RULES) :
 * - démarrage à l'ouverture (rétroactif : started_at = opened_at) ;
 * - pause pendant les états d'attente (« En attente ») : le temps ne court plus ;
 * - « prise en charge » : s'arrête au premier passage En cours (ou Résolu) ;
 * - « résolution » : s'arrête à Résolu ; une réouverture le relance là où il s'était arrêté ;
 * - annulation du ticket : SLA annulés ;
 * - changement de priorité : le SLA en cours est annulé et remplacé par celui de
 *   la nouvelle priorité, qui reprend le temps déjà écoulé (comme si la bonne
 *   priorité avait été posée dès l'ouverture).
 */

const RULES = {
  incident: {
    pause: ['on_hold'],
    stop: { response: ['in_progress', 'resolved', 'closed'], resolution: ['resolved', 'closed'] },
    cancel: ['canceled'],
    reopenFrom: ['resolved']
  },
  request: {
    pause: ['pending_approval'],
    stop: { resolution: ['fulfilled', 'closed'] },
    cancel: ['canceled', 'rejected'],
    reopenFrom: []
  }
};

const ACTIVE = ['running', 'paused'];

function createEngine(db) {
  const calendars = new Map();
  const calendar = (id) => {
    if (!calendars.has(id)) calendars.set(id, loadCalendar(db, id));
    return calendars.get(id);
  };
  const definition = db.prepare('SELECT * FROM sla_definitions WHERE id = ?');
  return { calendar, definition: (id) => definition.get(id) };
}

/** Minutes ouvrées écoulées à `now`, pause comprise. */
function elapsedAt(engine, sla, def, now) {
  const running = sla.stage === 'running' && sla.last_resumed_at;
  return sla.elapsed_minutes + (running ? businessMinutesBetween(engine.calendar(def.calendar_id), sla.last_resumed_at, now) : 0);
}

/** État lisible d'un SLA à un instant donné. */
function describe(engine, sla, now, threshold) {
  const def = engine.definition(sla.sla_definition_id);
  const elapsed = elapsedAt(engine, sla, def, now);
  const percent = elapsed / def.duration_minutes;
  let status;
  if (sla.stage === 'canceled') status = 'canceled';
  else if (sla.stage === 'completed') status = sla.has_breached ? 'breached' : 'achieved';
  else if (percent >= 1) status = 'breached';
  else if (percent >= threshold) status = 'at_risk';
  else status = 'on_track';
  return {
    ...sla,
    name: def.name,
    target: def.target,
    duration_minutes: def.duration_minutes,
    calendar_id: def.calendar_id,
    elapsed_minutes_now: elapsed,
    remaining_minutes: def.duration_minutes - elapsed,
    percent_now: percent,
    status,
    paused: sla.stage === 'paused'
  };
}

function writeSla(db, sla, now) {
  db.prepare(
    `UPDATE ticket_slas SET stage = @stage, last_resumed_at = @last_resumed_at, elapsed_minutes = @elapsed_minutes,
            due_at = @due_at, stopped_at = @stopped_at, has_breached = @has_breached, percent = @percent, updated_at = @now
      WHERE id = @id`
  ).run({ ...sla, now: now.toISOString() });
}

function startSla(db, engine, ticket, def, { at, elapsed = 0, stage = 'running', now }) {
  const cal = engine.calendar(def.calendar_id);
  const startedAt = new Date(at);
  const left = Math.max(0, def.duration_minutes - elapsed);
  const due = stage === 'running' ? addBusinessMinutes(cal, now || startedAt, left).toISOString() : null;
  db.prepare(
    `INSERT INTO ticket_slas (ticket_id, sla_definition_id, stage, started_at, last_resumed_at, elapsed_minutes, due_at,
                              has_breached, percent, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    ticket.id,
    def.id,
    stage,
    startedAt.toISOString(),
    stage === 'running' ? (now || startedAt).toISOString() : null,
    elapsed,
    due,
    elapsed >= def.duration_minutes ? 1 : 0,
    elapsed / def.duration_minutes,
    (now || startedAt).toISOString()
  );
}

const activeSlas = (db, ticketId) =>
  db.prepare(`SELECT * FROM ticket_slas WHERE ticket_id = ? AND stage IN ('running', 'paused')`).all(ticketId);

function definitionsFor(db, type, priority) {
  return db.prepare('SELECT * FROM sla_definitions WHERE ticket_type = ? AND priority = ? AND is_active = 1').all(type, priority);
}

/** Arrête le compteur à `now` (point d'arrêt) sans changer d'étape. */
function checkpoint(engine, sla, now) {
  const def = engine.definition(sla.sla_definition_id);
  const elapsed = elapsedAt(engine, sla, def, now);
  return { ...sla, elapsed_minutes: elapsed, last_resumed_at: null, percent: elapsed / def.duration_minutes, has_breached: sla.has_breached || elapsed >= def.duration_minutes ? 1 : 0 };
}

function onTicketCreated(ctx, ticket) {
  if (!RULES[ticket.type]) return;
  const { db } = ctx;
  const engine = createEngine(db);
  for (const def of definitionsFor(db, ticket.type, ticket.priority)) {
    startSla(db, engine, ticket, def, { at: ticket.opened_at, now: new Date(ticket.opened_at) });
  }
  // Un ticket né dans un état d'arrêt (rare : créé déjà résolu) est traité comme une transition.
  if (ticket.state !== 'new') onTicketUpdated(ctx, { ...ticket, state: 'new' }, ticket);
}

function onTicketUpdated(ctx, before, after) {
  const rules = RULES[after.type];
  if (!rules) return;
  const { db, now } = ctx;
  const engine = createEngine(db);

  // 1. Priorité changée : on remplace les SLA actifs en gardant le temps écoulé.
  if (before.priority !== after.priority) {
    const carried = {};
    for (const sla of activeSlas(db, after.id)) {
      const def = engine.definition(sla.sla_definition_id);
      const stopped = checkpoint(engine, sla, now);
      carried[def.target] = { elapsed: stopped.elapsed_minutes, stage: sla.stage };
      writeSla(db, { ...stopped, stage: 'canceled', stopped_at: now.toISOString(), due_at: null }, now);
    }
    for (const def of definitionsFor(db, after.type, after.priority)) {
      const prior = carried[def.target];
      if (!prior) continue; // cible déjà atteinte (ex. prise en charge faite) : pas de nouveau SLA
      startSla(db, engine, after, def, { at: after.opened_at, elapsed: prior.elapsed, stage: prior.stage, now });
    }
  }

  if (before.state === after.state) return;

  const enteringPause = rules.pause.includes(after.state) && !rules.pause.includes(before.state);
  const leavingPause = rules.pause.includes(before.state) && !rules.pause.includes(after.state);

  // 2. Réouverture : le SLA de résolution reprend où il s'était arrêté.
  if (rules.reopenFrom.includes(before.state) && !rules.stop.resolution.includes(after.state) && !rules.cancel.includes(after.state)) {
    const last = db
      .prepare(
        `SELECT s.* FROM ticket_slas s JOIN sla_definitions d ON d.id = s.sla_definition_id
          WHERE s.ticket_id = ? AND d.target = 'resolution' AND s.stage = 'completed' ORDER BY s.id DESC LIMIT 1`
      )
      .get(after.id);
    if (last) {
      const def = engine.definition(last.sla_definition_id);
      const left = Math.max(0, def.duration_minutes - last.elapsed_minutes);
      writeSla(db, { ...last, stage: 'running', stopped_at: null, last_resumed_at: now.toISOString(), due_at: addBusinessMinutes(engine.calendar(def.calendar_id), now, left).toISOString() }, now);
    }
  }

  for (const sla of activeSlas(db, after.id)) {
    const def = engine.definition(sla.sla_definition_id);
    const stopStates = rules.stop[def.target] || [];

    if (rules.cancel.includes(after.state)) {
      writeSla(db, { ...checkpoint(engine, sla, now), stage: 'canceled', stopped_at: now.toISOString(), due_at: null }, now);
    } else if (stopStates.includes(after.state)) {
      const done = checkpoint(engine, sla, now);
      writeSla(db, { ...done, stage: 'completed', stopped_at: now.toISOString() }, now);
    } else if (enteringPause && sla.stage === 'running') {
      writeSla(db, { ...checkpoint(engine, sla, now), stage: 'paused', due_at: null }, now);
    } else if (leavingPause && sla.stage === 'paused') {
      const left = Math.max(0, def.duration_minutes - sla.elapsed_minutes);
      writeSla(db, { ...sla, stage: 'running', last_resumed_at: now.toISOString(), due_at: addBusinessMinutes(engine.calendar(def.calendar_id), now, left).toISOString() }, now);
    }
  }
}

/** SLA d'un ticket décrits à `now` (fiche, onglet SLA). */
function ticketSlas(db, ticketId, now = new Date()) {
  const engine = createEngine(db);
  const threshold = Number(getSetting(db, 'sla.at_risk_threshold', 0.75));
  return db
    .prepare('SELECT * FROM ticket_slas WHERE ticket_id = ? ORDER BY id')
    .all(ticketId)
    .map((sla) => describe(engine, sla, now, threshold));
}

/**
 * Job : rafraîchit l'avancement des SLA qui courent et signale une seule
 * fois le passage « à risque » puis « dépassé ». `notify(sla, kind)` est
 * fourni par l'appelant (couche notifications).
 */
function refreshRunning(db, now = new Date(), notify = () => {}) {
  const engine = createEngine(db);
  const threshold = Number(getSetting(db, 'sla.at_risk_threshold', 0.75));
  const counts = { refreshed: 0, at_risk: 0, breached: 0 };
  const rows = db.prepare("SELECT * FROM ticket_slas WHERE stage = 'running'").all();
  db.transaction(() => {
    for (const sla of rows) {
      const d = describe(engine, sla, now, threshold);
      const breached = d.percent_now >= 1 ? 1 : sla.has_breached;
      db.prepare('UPDATE ticket_slas SET percent = ?, has_breached = ?, updated_at = ? WHERE id = ?').run(d.percent_now, breached, now.toISOString(), sla.id);
      counts.refreshed += 1;
      if (d.status === 'breached' && !sla.breached_notified_at) {
        db.prepare('UPDATE ticket_slas SET breached_notified_at = ? WHERE id = ?').run(now.toISOString(), sla.id);
        notify(d, 'breached');
        counts.breached += 1;
      } else if (d.status === 'at_risk' && !sla.at_risk_notified_at) {
        db.prepare('UPDATE ticket_slas SET at_risk_notified_at = ? WHERE id = ?').run(now.toISOString(), sla.id);
        notify(d, 'at_risk');
        counts.at_risk += 1;
      }
    }
  })();
  return counts;
}

module.exports = { onTicketCreated, onTicketUpdated, ticketSlas, refreshRunning, RULES };
