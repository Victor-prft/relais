'use strict';

const { getType } = require('./types');
const { nextNumber } = require('./numbering');
const { recordChanges, recordEvent } = require('./audit');
const { computePriority } = require('../incidents/priority');
const { notFound, conflict, badRequest, unprocessable } = require('../lib/http-errors');
const hooks = require('./hooks');

/**
 * Service commun des tickets : seul endroit qui écrit dans `tickets` et les
 * tables d'extension. Chaque écriture vérifie le workflow, recalcule la
 * priorité, écrit l'audit trail et prévient les abonnés (SLA, notifications)
 * dans la même transaction.
 */

const BASE_FIELDS = [
  'title',
  'description',
  'state',
  'impact',
  'urgency',
  'priority',
  'requester_id',
  'opened_by_id',
  'assignment_group_id',
  'assigned_to_id',
  'category_id',
  'ci_id',
  'parent_id',
  'opened_at',
  'first_response_at',
  'resolved_at',
  'closed_at'
];

/** Champs communs suivis par l'audit, et leur type d'affichage. */
const BASE_TRACKED = {
  title: { kind: 'text' },
  description: { kind: 'text' },
  impact: { kind: 'level' },
  urgency: { kind: 'level' },
  priority: { kind: 'priority' },
  requester_id: { kind: 'user' },
  assignment_group_id: { kind: 'group' },
  assigned_to_id: { kind: 'user' },
  category_id: { kind: 'category' },
  ci_id: { kind: 'ci' }
};

const isStaffActor = (ctx) => !ctx.user || ctx.user.role !== 'user';

function trackedFor(def) {
  return { state: { kind: 'enum', labels: def.workflow.states }, ...BASE_TRACKED, ...def.tracked };
}

/** Ticket brut : ligne commune + ligne d'extension fusionnées. */
function loadTicket(db, id) {
  const base = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  if (!base) return null;
  const def = getType(base.type);
  const ext = def.extTable ? db.prepare(`SELECT * FROM ${def.extTable} WHERE ticket_id = ?`).get(id) || {} : {};
  const { ticket_id: _ignored, ...rest } = ext;
  return { ...base, ...rest };
}

function requireTicket(db, id) {
  const ticket = loadTicket(db, id);
  if (!ticket) throw notFound('Ticket introuvable');
  return ticket;
}

/**
 * Règles d'assignation communes à tous les types :
 * - l'agent assigné doit être un compte de support actif ;
 * - sans groupe, on prend le premier groupe de l'agent ;
 * - changer de groupe retire un agent qui n'en fait pas partie.
 */
function applyAssignmentRules(db, before, after) {
  if (after.assigned_to_id) {
    const agent = db.prepare('SELECT role, is_active FROM users WHERE id = ?').get(after.assigned_to_id);
    if (!agent || !agent.is_active || agent.role === 'user') {
      throw badRequest('L’assigné doit être un agent actif', [{ path: 'assigned_to_id', message: 'Agent invalide' }]);
    }
  }

  const groupChanged = before && after.assignment_group_id !== before.assignment_group_id;
  const agentChanged = !before || after.assigned_to_id !== before.assigned_to_id;

  if (after.assigned_to_id && !after.assignment_group_id) {
    const first = db
      .prepare('SELECT group_id FROM group_members WHERE user_id = ? ORDER BY group_id LIMIT 1')
      .get(after.assigned_to_id);
    after.assignment_group_id = first?.group_id ?? null;
  }

  if (after.assigned_to_id && after.assignment_group_id) {
    const member = db
      .prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?')
      .get(after.assignment_group_id, after.assigned_to_id);
    if (!member) {
      if (groupChanged && !agentChanged) after.assigned_to_id = null;
      else throw badRequest('L’agent ne fait pas partie du groupe d’assignation', [{ path: 'assigned_to_id', message: 'Hors du groupe' }]);
    }
  }
}

/**
 * Prise en charge sans agent : l'agent qui agit se l'attribue — s'il fait
 * partie du groupe d'assignation (ou s'il n'y en a pas). Sinon on refuse avec
 * une consigne claire plutôt que d'assigner un agent hors du groupe.
 */
function autoAssignActor(ctx, after) {
  if (after.assigned_to_id || !ctx.user || ctx.user.role === 'user') return;
  const { db } = ctx;
  if (after.assignment_group_id) {
    const member = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(after.assignment_group_id, ctx.user.id);
    if (!member) {
      const group = db.prepare('SELECT name FROM support_groups WHERE id = ?').get(after.assignment_group_id)?.name;
      throw badRequest(`Vous n’êtes pas membre du groupe « ${group} » : assignez un de ses agents, ou changez de groupe`, [
        { path: 'assigned_to_id', message: 'Obligatoire' }
      ]);
    }
  }
  after.assigned_to_id = ctx.user.id;
}

function insertRow(db, table, row) {
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(
    ...keys.map((k) => row[k])
  );
}

function pick(source, fields) {
  const out = {};
  for (const f of fields) if (source[f] !== undefined) out[f] = source[f];
  return out;
}

function createTicket(ctx, type, input) {
  const def = getType(type);
  const { db } = ctx;
  return db.transaction(() => {
    const now = ctx.now.toISOString();
    const record = {
      state: def.initialState,
      impact: 3,
      urgency: 3,
      requester_id: ctx.user?.id ?? null,
      ...input,
      opened_by_id: input.opened_by_id ?? ctx.user?.id ?? null,
      opened_at: input.opened_at || now
    };

    def.prepareCreate?.(ctx, record);
    applyAssignmentRules(db, null, record);
    record.priority = computePriority(record.impact, record.urgency);
    if (!def.workflow.states[record.state]) throw unprocessable(`État initial invalide : ${record.state}`);

    const number = nextNumber(db, def.prefix);
    const info = db
      .prepare('INSERT INTO tickets (number, type, title, state, opened_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(number, type, record.title, record.state, record.opened_at, now);
    const id = Number(info.lastInsertRowid);

    const base = pick(record, BASE_FIELDS);
    const sets = Object.keys(base);
    db.prepare(`UPDATE tickets SET ${sets.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
      ...sets.map((k) => base[k]),
      id
    );
    if (def.extTable) insertRow(db, def.extTable, { ticket_id: id, ...pick(record, def.extFields) });

    recordEvent(db, {
      entity: 'ticket',
      entityId: id,
      event: 'created',
      display: def.workflow.label(record.state),
      userId: ctx.user?.id,
      at: now
    });

    const ticket = loadTicket(db, id);
    def.afterCreate?.(ctx, ticket);
    hooks.emit('created', ctx, ticket);
    return ticket;
  })();
}

/**
 * Met à jour un ticket.
 * @param {object} patch champs à modifier (déjà validés par la route)
 * @param {object} opts  { expectedVersion } : refus 409 si le ticket a changé entre-temps
 */
function updateTicket(ctx, id, patch, { expectedVersion = null } = {}) {
  const { db } = ctx;
  return db.transaction(() => {
    const before = requireTicket(db, id);
    const def = getType(before.type);
    const staff = isStaffActor(ctx);

    if (expectedVersion !== null && expectedVersion !== before.version) {
      throw conflict('Ce ticket a été modifié entre-temps : rechargez-le avant d’enregistrer', { version: before.version });
    }

    const after = { ...before, ...patch };
    if (patch.state !== undefined && patch.state !== before.state) {
      def.workflow.assert(before.state, patch.state, { staff, system: !ctx.user });
    }
    if (def.workflow.isTerminal(before.state)) {
      const touched = Object.keys(patch).filter((k) => patch[k] !== before[k]);
      if (touched.length) throw unprocessable(`Ticket ${def.workflow.label(before.state).toLowerCase()} : il n’est plus modifiable`);
    }

    def.beforeUpdate?.(ctx, before, after, patch);
    // Après les règles du type : elles peuvent poser l'agent (prise en charge).
    applyAssignmentRules(db, before, after);
    after.priority = computePriority(after.impact, after.urgency);

    const fields = [...BASE_FIELDS, ...def.extFields];
    const changed = fields.filter((f) => String(before[f] ?? '') !== String(after[f] ?? ''));
    if (!changed.length) return before;

    const now = ctx.now.toISOString();
    const baseChanged = changed.filter((f) => BASE_FIELDS.includes(f));
    const extChanged = changed.filter((f) => def.extFields.includes(f));

    const res = db
      .prepare(
        `UPDATE tickets SET ${[...baseChanged.map((f) => `${f} = ?`), 'updated_at = ?', 'version = version + 1'].join(', ')}
          WHERE id = ? AND version = ?`
      )
      .run(...baseChanged.map((f) => after[f]), now, id, before.version);
    if (res.changes !== 1) throw conflict('Ce ticket a été modifié entre-temps');

    if (extChanged.length) {
      db.prepare(`UPDATE ${def.extTable} SET ${extChanged.map((f) => `${f} = ?`).join(', ')} WHERE ticket_id = ?`).run(
        ...extChanged.map((f) => after[f]),
        id
      );
    }

    recordChanges(db, {
      entity: 'ticket',
      entityId: id,
      before,
      after,
      tracked: trackedFor(def),
      userId: ctx.user?.id,
      at: now
    });

    const ticket = loadTicket(db, id);
    def.afterUpdate?.(ctx, before, ticket);
    hooks.emit('updated', ctx, before, ticket);
    return ticket;
  })();
}

module.exports = { createTicket, updateTicket, loadTicket, requireTicket, isStaffActor, trackedFor, autoAssignActor, BASE_FIELDS };

// Après les exports : les abonnés requièrent ce module à leur tour.
require('./subscribers');
