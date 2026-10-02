'use strict';

/**
 * 150 incidents sur les 60 derniers jours, joués comme dans la vraie vie :
 * chaque étape (assignation, prise en charge, attente, résolution, clôture)
 * passe par le service des tickets avec l'horloge réglée sur sa date. Une
 * étape qui tomberait dans le futur n'a pas lieu : les incidents récents
 * restent donc naturellement ouverts, à divers stades.
 */

const { createTicket, updateTicket } = require('../../tickets/service');
const { addEntry } = require('../../tickets/journal');
const { recordEvent } = require('../../tickets/audit');
const { setSetting } = require('../../lib/settings');
const { zonedParts, zonedToUtc, localDateString, shiftDay, weekdayOf } = require('../../lib/tz');
const { TEMPLATES, MAJOR, COMMENTS_AGENT, COMMENTS_USER, WORK_NOTES, RESOLUTIONS } = require('./incident-templates');

const TZ = 'Europe/Paris';
const DAY_START = 8;
const DAY_END = 18;
const MIN = 60000;

const REQUESTERS = [['lea', 6], ['marc', 6], ['chloe', 6], ['julien', 1], ['helene', 1], ['karim', 1], ['ines', 1], ['admin', 1]];
const CONTACTS = [['portal', 55], ['phone', 25], ['email', 15], ['chat', 5]];

/** Durées en minutes ouvrées [min, max] selon la priorité. */
const ASSIGN_DELAY = { 1: [3, 10], 2: [8, 30], 3: [15, 120], 4: [30, 300], 5: [60, 600] };
const RESOLVE_EFFORT = { 1: [40, 200], 2: [90, 420], 3: [180, 1100], 4: [400, 2400], 5: [900, 4500] };

function createSimulator(db, refs, now, rnd) {
  const users = Object.fromEntries(
    Object.entries(refs.users).map(([key, id]) => [key, db.prepare('SELECT * FROM users WHERE id = ?').get(id)])
  );
  const members = {};
  for (const [key, gid] of Object.entries(refs.groups)) {
    members[key] = db.prepare('SELECT u.* FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?').all(gid);
  }
  const ctx = (user, at) => ({ db, user, now: at });
  const system = (at) => ({ db, user: null, now: at });

  const local = (date) => zonedParts(date, TZ);
  const at = (ymd, hour, minute) => {
    const [year, month, day] = ymd.split('-').map(Number);
    return zonedToUtc({ year, month, day, hour, minute }, TZ);
  };
  const isWorkday = (ymd) => ![0, 6].includes(weekdayOf(ymd));

  /** Prochain instant ouvré (lun–ven, 8 h–18 h, heure de Paris). */
  function toBusiness(date) {
    let ymd = localDateString(date, TZ);
    const p = local(date);
    const minutes = p.hour * 60 + p.minute;
    if (isWorkday(ymd) && minutes >= DAY_START * 60 && minutes < DAY_END * 60) return date;
    if (!isWorkday(ymd) || minutes >= DAY_END * 60) ymd = shiftDay(ymd, 1);
    while (!isWorkday(ymd)) ymd = shiftDay(ymd, 1);
    return at(ymd, DAY_START, rnd.int(0, 50));
  }

  /** Ajoute des minutes ouvrées. */
  function addWork(date, minutes) {
    let cur = toBusiness(date);
    let left = minutes;
    for (let guard = 0; guard < 400; guard += 1) {
      const ymd = localDateString(cur, TZ);
      const end = at(ymd, DAY_END, 0);
      const avail = (end - cur) / MIN;
      if (left <= avail) return new Date(cur.getTime() + left * MIN);
      left -= avail;
      cur = toBusiness(new Date(end.getTime() + MIN));
    }
    return cur;
  }

  const later = (date, [min, max], { allHours = false } = {}) => {
    const minutes = rnd.int(min, max);
    return allHours ? new Date(date.getTime() + minutes * MIN) : addWork(date, minutes);
  };

  /** Exécute l'étape si elle n'est pas dans le futur. */
  const happens = (when) => when.getTime() <= now.getTime();

  function link(fromId, toId, kind, user, when) {
    db.prepare('INSERT OR IGNORE INTO ticket_relations (from_id, to_id, kind, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(
      fromId,
      toId,
      kind,
      user.id,
      when.toISOString()
    );
    const target = db.prepare('SELECT number FROM tickets WHERE id = ?').get(toId).number;
    recordEvent(db, { entity: 'ticket', entityId: fromId, event: 'link', display: `Doublon de ${target}`, userId: user.id, at: when.toISOString() });
  }

  /**
   * Joue la vie d'un incident. Renvoie le ticket (et la date de résolution
   * pour les incidents majeurs, dont les doublons suivent le sort).
   */
  function play(spec) {
    const { opened, template, groupKey, requester, contact, impact, urgency, title, description, ciId } = spec;
    const sdAgent = rnd.pick(members.sd);
    const creator = contact === 'portal' ? requester : sdAgent;
    let ticket = createTicket(ctx(creator, opened), 'incident', {
      title,
      description,
      impact,
      urgency,
      category_id: template.cat,
      requester_id: requester.id,
      contact_type: contact,
      assignment_group_id: refs.groups[groupKey],
      ci_id: ciId ?? undefined
    });
    const p = ticket.priority;
    const allHours = p === 1;
    // Ticket récent resté en file : la simulation s'arrête à l'étape `stopAt`.
    const stop = spec.stopAt || null;
    if (stop === 'new') return { ticket };
    const agent = spec.agent || rnd.pick(members[groupKey]);
    const lead = users[groupKey === 'apps' ? 'julien' : 'helene'];

    let t = later(opened, ASSIGN_DELAY[p], { allHours });
    if (!happens(t)) return { ticket };
    ticket = updateTicket(ctx(rnd.chance(0.5) ? agent : lead, t), ticket.id, { assigned_to_id: agent.id });
    if (stop === 'assigned') return { ticket };

    t = later(t, [2, p <= 2 ? 15 : 60], { allHours });
    if (!happens(t)) return { ticket };
    if (rnd.chance(0.6)) addEntry(ctx(agent, t), ticket.id, { kind: 'comment', body: rnd.pick(COMMENTS_AGENT.slice(0, 3)) });
    ticket = updateTicket(ctx(agent, t), ticket.id, { state: 'in_progress' });
    if (stop === 'on_hold') {
      t = later(t, [20, 120]);
      if (!happens(t)) return { ticket };
      const reason = rnd.weighted([['awaiting_user', 5], ['awaiting_vendor', 4], ['awaiting_change', 1]]);
      addEntry(ctx(agent, t), ticket.id, { kind: 'comment', body: reason === 'awaiting_user' ? COMMENTS_AGENT[1] : 'Nous attendons une intervention externe, nous revenons vers vous.' });
      return { ticket: updateTicket(ctx(agent, t), ticket.id, { state: 'on_hold', on_hold_reason: reason }) };
    }
    if (stop === 'in_progress') {
      const noteAt = later(t, [10, 90]);
      if (happens(noteAt)) addEntry(ctx(agent, noteAt), ticket.id, { kind: 'work_note', body: rnd.pick(WORK_NOTES) });
      return { ticket };
    }

    // Mise en attente (un quart des cas, jamais pour un P1).
    if (p > 1 && !spec.noHold && rnd.chance(0.27)) {
      t = later(t, [20, 180]);
      if (!happens(t)) return { ticket };
      const reason = rnd.weighted([['awaiting_user', 7], ['awaiting_vendor', 3]]);
      addEntry(ctx(agent, t), ticket.id, { kind: 'comment', body: reason === 'awaiting_user' ? COMMENTS_AGENT[1] : 'Nous attendons le retour du fournisseur.' });
      ticket = updateTicket(ctx(agent, t), ticket.id, { state: 'on_hold', on_hold_reason: reason });
      t = later(t, reason === 'awaiting_user' ? [30, 900] : [300, 2400]);
      if (!happens(t)) return { ticket };
      if (reason === 'awaiting_user') {
        // La réponse du demandeur relance l'incident (abonné du journal).
        addEntry(ctx(requester, t), ticket.id, { kind: 'comment', body: rnd.pick(COMMENTS_USER.slice(0, 2)) });
      } else {
        addEntry(ctx(agent, t), ticket.id, { kind: 'work_note', body: 'Retour fournisseur reçu, reprise du traitement.' });
        ticket = updateTicket(ctx(agent, t), ticket.id, { state: 'in_progress' });
      }
    }

    if (rnd.chance(0.5)) {
      const noteAt = later(t, [10, 120], { allHours });
      if (happens(noteAt)) addEntry(ctx(agent, noteAt), ticket.id, { kind: 'work_note', body: rnd.pick(WORK_NOTES) });
    }

    // Résolution : 15 % des tickets traînent assez pour dépasser leur SLA.
    let [rmin, rmax] = RESOLVE_EFFORT[p];
    if (rnd.chance(0.15)) [rmin, rmax] = [rmax, rmax * 2.5];
    // Une date de résolution imposée (incident majeur) ne précède jamais la prise en charge.
    const resolvedAt = spec.resolveAt
      ? new Date(Math.max(spec.resolveAt.getTime(), t.getTime() + 5 * MIN))
      : later(t, [rmin, Math.round(rmax)], { allHours });
    if (!happens(resolvedAt)) return { ticket };
    const code = spec.resolutionCode || rnd.weighted([['permanent_fix', 6], ['workaround', 2], ['user_error', 1], ['not_reproducible', 1]]);
    const own = ['permanent_fix', 'workaround'].includes(code) ? template.fixes : null;
    const notes = spec.resolutionNotes || (own ? `${code === 'workaround' ? 'Contournement : ' : ''}${rnd.pick(own)}` : rnd.pick(RESOLUTIONS[code]));
    if (rnd.chance(0.5)) addEntry(ctx(agent, resolvedAt), ticket.id, { kind: 'comment', body: COMMENTS_AGENT[5] });
    ticket = updateTicket(ctx(agent, resolvedAt), ticket.id, { state: 'resolved', resolution_code: code, resolution_notes: notes });

    // Après résolution : confirmation, réouverture ou clôture automatique.
    const fate = rnd.weighted([['confirm', 35], ['reopen', 5], ['auto', 60]]);
    if (fate === 'confirm') {
      const when = later(resolvedAt, [10, 500]);
      if (happens(when)) {
        addEntry(ctx(requester, when), ticket.id, { kind: 'comment', body: COMMENTS_USER[2] });
        ticket = updateTicket(ctx(requester, when), ticket.id, { state: 'closed' });
      }
    } else if (fate === 'reopen') {
      let when = later(resolvedAt, [30, 600]);
      if (happens(when)) {
        addEntry(ctx(requester, when), ticket.id, { kind: 'comment', body: COMMENTS_USER[4] });
        ticket = updateTicket(ctx(requester, when), ticket.id, { state: 'in_progress' });
        when = later(when, [60, 600]);
        if (happens(when)) {
          ticket = updateTicket(ctx(agent, when), ticket.id, { state: 'resolved', resolution_code: 'permanent_fix', resolution_notes: `${notes} Cause racine corrigée après réouverture.` });
        }
      }
    }
    if (ticket.state === 'resolved') {
      const when = new Date(new Date(ticket.resolved_at).getTime() + 3 * 86400000 + rnd.int(1, 60) * MIN);
      if (happens(when)) {
        addEntry(system(when), ticket.id, { kind: 'comment', body: 'Clôture automatique : résolu depuis plus de 3 jour(s) sans réouverture.' });
        ticket = updateTicket(system(when), ticket.id, { state: 'closed' });
      }
    }
    return { ticket, resolvedAt };
  }

  return { play, toBusiness, at, users, members, link, later, happens };
}

/** Instant d'ouverture : surtout en semaine aux heures de bureau, avec des pics. */
function openingTime(sim, rnd, now, daysAgo) {
  const today = localDateString(now, TZ);
  let ymd = shiftDay(today, -daysAgo);
  const weekend = [0, 6].includes(weekdayOf(ymd));
  if (weekend && rnd.chance(0.8)) ymd = shiftDay(ymd, weekdayOf(ymd) === 6 ? -1 : 1);
  const offHours = rnd.chance(0.08);
  const hour = offHours ? rnd.pick([6, 7, 19, 20, 21]) : rnd.weighted([[8, 2], [9, 5], [10, 5], [11, 4], [12, 1], [13, 2], [14, 5], [15, 4], [16, 3], [17, 2]]);
  return sim.at(ymd, hour, rnd.int(0, 59));
}

function seedIncidents(db, refs, now, rnd) {
  // Routage : groupe par défaut de chaque catégorie racine.
  const route = { 1: 'sd', 5: 'apps', 9: 'sd', 10: 'infra', 14: 'sd' };
  for (const [cat, key] of Object.entries(route)) db.prepare('UPDATE categories SET default_group_id = ? WHERE id = ?').run(refs.groups[key], cat);
  setSetting(db, 'incident.default_group_id', refs.groups.sd, now);

  const sim = createSimulator(db, refs, now, rnd);
  const ciId = (name) => (name && refs.cis ? refs.cis[name] ?? null : null);
  const specs = [];

  const REGULAR = 150 - MAJOR.length * 4;
  for (let i = 0; i < REGULAR; i += 1) {
    // Un peu plus de tickets récents que d'anciens (adoption de l'outil).
    const daysAgo = Math.min(59, Math.floor(Math.pow(rnd.next(), 1.35) * 60));
    const template = rnd.weighted(TEMPLATES.map((tpl) => [tpl, tpl.weight]));
    const [impact, urgency] = rnd.pick(template.iu);
    const title = rnd.pick(template.titles);
    specs.push({
      kind: 'regular',
      opened: openingTime(sim, rnd, now, daysAgo),
      template,
      groupKey: template.group,
      requester: sim.users[rnd.weighted(REQUESTERS)],
      contact: rnd.weighted(CONTACTS),
      impact,
      urgency,
      title,
      description: `${rnd.pick(template.details)} ${rnd.chance(0.5) ? rnd.pick(template.details) : ''}`.trim(),
      ciId: ciId(rnd.pick(template.ci)),
      // Les tickets des dix derniers jours ne sont pas tous traités : une file réaliste.
      stopAt: daysAgo <= 10 && rnd.chance(daysAgo <= 3 ? 0.55 : 0.3)
        ? rnd.weighted([['new', 2], ['assigned', 3], ['in_progress', 4], ['on_hold', 2]])
        : null
    });
  }

  for (const major of MAJOR) {
    const template = TEMPLATES.find((tpl) => tpl.cat === major.cat);
    const opened = sim.at(shiftDay(localDateString(now, TZ), -major.daysAgo), 9, rnd.int(5, 40));
    specs.push({ kind: 'major', major, opened, template });
  }

  specs.sort((a, b) => a.opened - b.opened);

  let count = 0;
  for (const spec of specs) {
    if (spec.kind === 'regular') {
      sim.play(spec);
      count += 1;
      continue;
    }
    // Incident majeur : P1 ouvert par le Service Desk, puis trois signalements en doublon.
    const { major, template, opened } = spec;
    const groupKey = template.group;
    const agent = sim.members[groupKey][0];
    const resolveAt = new Date(opened.getTime() + rnd.int(100, 200) * MIN);
    const main = sim.play({
      opened, template, groupKey, agent,
      requester: sim.users.helene,
      contact: 'phone',
      impact: 1,
      urgency: 1,
      title: major.title,
      description: 'Plusieurs services signalent le problème en même temps. Incident majeur déclaré, cellule de crise ouverte.',
      ciId: ciId(major.ci),
      noHold: true,
      resolveAt,
      resolutionCode: 'permanent_fix',
      resolutionNotes: major.fix
    }).ticket;
    count += 1;
    for (const [k, requesterKey] of ['lea', 'marc', 'chloe'].entries()) {
      const dupOpened = new Date(opened.getTime() + (k + 1) * rnd.int(4, 12) * MIN);
      const dup = sim.play({
        opened: dupOpened, template, groupKey, agent,
        requester: sim.users[requesterKey],
        contact: 'portal',
        impact: 3,
        urgency: 1,
        title: rnd.pick(template.titles),
        description: 'Ça ne marche plus du tout depuis quelques minutes.',
        ciId: ciId(major.ci),
        noHold: true,
        resolveAt: new Date(resolveAt.getTime() + (k + 1) * MIN),
        resolutionCode: 'duplicate',
        resolutionNotes: `Doublon de ${main.number} : ${major.fix}`
      }).ticket;
      const linkedAt = new Date(dupOpened.getTime() + 15 * MIN);
      if (sim.happens(linkedAt)) sim.link(dup.id, main.id, 'duplicate_of', agent, linkedAt);
      count += 1;
    }
  }

  const byState = db.prepare("SELECT state, COUNT(*) AS n FROM tickets WHERE type = 'incident' GROUP BY state").all();
  return `${count} incidents (${byState.map((r) => `${r.state} ${r.n}`).join(', ')})`;
}

module.exports = { seedIncidents, createSimulator, TZ };
