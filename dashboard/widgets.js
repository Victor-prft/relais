'use strict';

const { localDateString, shiftDay, zonedToUtc } = require('../lib/tz');
const { getSetting } = require('../lib/settings');
const { hasRole } = require('../auth/roles');

/**
 * Registre des widgets du tableau de bord. Chaque widget déclare son rôle
 * minimal, sa taille par défaut (grille de 12 colonnes) et sa requête.
 * Les données sont calculées côté serveur ; le front ne fait que dessiner.
 */

const TZ = 'Europe/Paris';
const OPEN = "('new', 'assigned', 'in_progress', 'on_hold', 'open', 'pending_approval', 'approved')";

const tableExists = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
const myGroups = (db, userId) => db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').all(userId).map((r) => r.group_id);
const inList = (ids) => (ids.length ? ids.map(Number).join(', ') : 'NULL');

/** Minuit local (Paris) il y a `days` jours, en ISO UTC. */
function localMidnight(now, days = 0) {
  const [year, month, day] = shiftDay(localDateString(now, TZ), -days).split('-').map(Number);
  return zonedToUtc({ year, month, day }, TZ).toISOString();
}

const TICKET_ROW = `t.id, t.number, t.type, t.title, t.state, t.priority, t.opened_at,
  a.full_name AS assigned_to,
  (SELECT MAX(s.percent) FROM ticket_slas s WHERE s.ticket_id = t.id AND s.stage IN ('running', 'paused')) AS sla`;

const WIDGETS = {
  kpis: {
    title: 'Indicateurs clés',
    role: 'agent',
    size: { w: 12, h: 2 },
    data(ctx) {
      const { db, now } = ctx;
      const since30 = localMidnight(now, 30);
      const one = (sql, ...args) => db.prepare(sql).get(...args).n ?? 0;
      const sla = db
        .prepare(
          `SELECT COUNT(*) AS total, SUM(s.has_breached) AS breached FROM ticket_slas s
             JOIN sla_definitions d ON d.id = s.sla_definition_id
            WHERE s.stage = 'completed' AND d.target = 'resolution' AND s.stopped_at >= ?`
        )
        .get(since30);
      const mttr = db
        .prepare(
          `SELECT AVG((julianday(resolved_at) - julianday(opened_at)) * 24) AS h FROM tickets
            WHERE type = 'incident' AND resolved_at >= ?`
        )
        .get(since30).h;
      return {
        open: one(`SELECT COUNT(*) AS n FROM tickets WHERE type = 'incident' AND state IN ${OPEN}`),
        unassigned: one(`SELECT COUNT(*) AS n FROM tickets WHERE type IN ('incident', 'request_task') AND state IN ${OPEN} AND assigned_to_id IS NULL`),
        critical: one(`SELECT COUNT(*) AS n FROM tickets WHERE type = 'incident' AND state IN ${OPEN} AND priority <= 2`),
        resolved_today: one("SELECT COUNT(*) AS n FROM tickets WHERE type = 'incident' AND resolved_at >= ?", localMidnight(now, 0)),
        sla_compliance: sla.total ? 1 - (sla.breached || 0) / sla.total : null,
        sla_sample: sla.total,
        mttr_hours: mttr
      };
    }
  },

  my_open: {
    title: 'Mes tickets ouverts',
    role: 'agent',
    size: { w: 4, h: 5 },
    data(ctx) {
      const { db, user } = ctx;
      const counts = Object.fromEntries([1, 2, 3, 4, 5].map((p) => [p, 0]));
      for (const r of db
        .prepare(`SELECT priority, COUNT(*) AS n FROM tickets WHERE assigned_to_id = ? AND state IN ${OPEN} GROUP BY priority`)
        .all(user.id)) counts[r.priority] = r.n;
      const items = db
        .prepare(
          `SELECT ${TICKET_ROW} FROM tickets t LEFT JOIN users a ON a.id = t.assigned_to_id
            WHERE t.assigned_to_id = ? AND t.state IN ${OPEN}
            ORDER BY t.priority, t.opened_at LIMIT 8`
        )
        .all(user.id);
      return { counts, items };
    }
  },

  group_queue: {
    title: 'File de mes groupes',
    role: 'agent',
    size: { w: 8, h: 5 },
    data(ctx) {
      const { db, user } = ctx;
      const groups = myGroups(db, user.id);
      const where = `t.assignment_group_id IN (${inList(groups)}) AND t.state IN ${OPEN} AND t.type IN ('incident', 'request_task')`;
      const total = db.prepare(`SELECT COUNT(*) AS n FROM tickets t WHERE ${where}`).get().n;
      const unassigned = db.prepare(`SELECT COUNT(*) AS n FROM tickets t WHERE ${where} AND t.assigned_to_id IS NULL`).get().n;
      const items = db
        .prepare(
          `SELECT ${TICKET_ROW}, g.name AS group_name FROM tickets t
             LEFT JOIN users a ON a.id = t.assigned_to_id LEFT JOIN support_groups g ON g.id = t.assignment_group_id
            WHERE ${where}
            ORDER BY (t.assigned_to_id IS NOT NULL), t.priority, t.opened_at LIMIT 10`
        )
        .all();
      return { total, unassigned, items, groups: groups.length };
    }
  },

  sla_risk: {
    title: 'SLA à risque ou dépassés',
    role: 'agent',
    size: { w: 6, h: 5 },
    data(ctx) {
      const { db, user } = ctx;
      const threshold = Number(getSetting(db, 'sla.at_risk_threshold', 0.75));
      // Un manager voit tout ; un agent, ses groupes.
      const scope = hasRole(user, 'manager') ? '1 = 1' : `t.assignment_group_id IN (${inList(myGroups(db, user.id))})`;
      const items = db
        .prepare(
          `SELECT t.id, t.number, t.type, t.title, t.priority, t.state, a.full_name AS assigned_to,
                  s.percent, s.due_at, s.stage, d.target, d.name AS sla_name
             FROM ticket_slas s JOIN sla_definitions d ON d.id = s.sla_definition_id
             JOIN tickets t ON t.id = s.ticket_id LEFT JOIN users a ON a.id = t.assigned_to_id
            WHERE s.stage IN ('running', 'paused') AND s.percent >= ? AND ${scope}
            ORDER BY s.percent DESC LIMIT 12`
        )
        .all(threshold);
      const count = (cond, ...args) =>
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM ticket_slas s JOIN tickets t ON t.id = s.ticket_id
              WHERE s.stage IN ('running', 'paused') AND ${cond} AND ${scope}`
          )
          .get(...args).n;
      return { threshold, items, at_risk: count('s.percent >= ? AND s.percent < 1', threshold), breached: count('s.percent >= 1') };
    }
  },

  incidents_daily: {
    title: 'Incidents par jour (30 jours)',
    role: 'agent',
    size: { w: 6, h: 5 },
    data(ctx) {
      const { db, now } = ctx;
      const since = localMidnight(now, 29);
      const days = Array.from({ length: 30 }, (_, i) => shiftDay(localDateString(now, TZ), i - 29));
      const opened = Object.fromEntries(days.map((d) => [d, 0]));
      const resolved = Object.fromEntries(days.map((d) => [d, 0]));
      for (const r of db.prepare("SELECT opened_at FROM tickets WHERE type = 'incident' AND opened_at >= ?").all(since)) {
        const d = localDateString(new Date(r.opened_at), TZ);
        if (d in opened) opened[d] += 1;
      }
      for (const r of db.prepare("SELECT resolved_at FROM tickets WHERE type = 'incident' AND resolved_at >= ?").all(since)) {
        const d = localDateString(new Date(r.resolved_at), TZ);
        if (d in resolved) resolved[d] += 1;
      }
      return { days, opened: days.map((d) => opened[d]), resolved: days.map((d) => resolved[d]) };
    }
  },

  incidents_by_category: {
    title: 'Incidents par catégorie (30 jours)',
    role: 'agent',
    size: { w: 6, h: 5 },
    data(ctx) {
      const rows = ctx.db
        .prepare(
          `SELECT COALESCE(p.name, c.name, 'Sans catégorie') AS label, COUNT(*) AS value
             FROM tickets t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories p ON p.id = c.parent_id
            WHERE t.type = 'incident' AND t.opened_at >= ?
            GROUP BY label ORDER BY value DESC`
        )
        .all(localMidnight(ctx.now, 29));
      return { items: rows };
    }
  },

  mttr_by_group: {
    title: 'Temps moyen de résolution par groupe (30 jours)',
    role: 'agent',
    size: { w: 6, h: 4 },
    data(ctx) {
      const rows = ctx.db
        .prepare(
          `SELECT g.name AS label, COUNT(*) AS count,
                  AVG((julianday(t.resolved_at) - julianday(t.opened_at)) * 24) AS hours
             FROM tickets t JOIN support_groups g ON g.id = t.assignment_group_id
            WHERE t.type = 'incident' AND t.resolved_at >= ?
            GROUP BY g.id ORDER BY hours DESC`
        )
        .all(localMidnight(ctx.now, 29));
      return { items: rows.map((r) => ({ ...r, hours: Math.round(r.hours * 10) / 10 })) };
    }
  },

  changes_week: {
    title: 'Changements à venir (7 jours)',
    role: 'agent',
    size: { w: 6, h: 4 },
    data(ctx) {
      if (!tableExists(ctx.db, 'changes')) return { available: false, items: [] };
      const now = ctx.now.toISOString();
      const end = new Date(ctx.now.getTime() + 7 * 86400000).toISOString();
      const items = ctx.db
        .prepare(
          `SELECT t.id, t.number, t.title, t.state, c.change_type, c.risk, c.planned_start, c.planned_end,
                  (SELECT GROUP_CONCAT(ci.name, ', ') FROM ticket_cis tc JOIN cis ci ON ci.id = tc.ci_id WHERE tc.ticket_id = t.id) AS cis
             FROM tickets t JOIN changes c ON c.ticket_id = t.id
            WHERE t.state IN ('authorized', 'scheduled', 'implement') AND c.planned_end >= ? AND c.planned_start <= ?
            ORDER BY c.planned_start LIMIT 10`
        )
        .all(now, end);
      return { available: true, items };
    }
  },

  pending_approvals: {
    title: 'Mes approbations en attente',
    role: 'agent',
    size: { w: 6, h: 4 },
    data(ctx) {
      if (!tableExists(ctx.db, 'approvals')) return { available: false, items: [] };
      const items = ctx.db
        .prepare(
          `SELECT ap.id AS approval_id, t.id, t.number, t.type, t.title, t.priority, ap.requested_at,
                  r.full_name AS requester
             FROM approvals ap JOIN tickets t ON t.id = ap.ticket_id LEFT JOIN users r ON r.id = t.requester_id
            WHERE ap.approver_id = ? AND ap.state = 'requested'
            ORDER BY ap.requested_at LIMIT 10`
        )
        .all(ctx.user.id);
      return { available: true, items };
    }
  }
};

/** Disposition par défaut selon le rôle (un manager voit d'abord le pilotage). */
function defaultLayout(user) {
  const agent = [
    { id: 'kpis', x: 0, y: 0, w: 12, h: 2 },
    { id: 'my_open', x: 0, y: 2, w: 4, h: 5 },
    { id: 'group_queue', x: 4, y: 2, w: 8, h: 5 },
    { id: 'sla_risk', x: 0, y: 7, w: 6, h: 5 },
    { id: 'incidents_daily', x: 6, y: 7, w: 6, h: 5 },
    { id: 'changes_week', x: 0, y: 12, w: 6, h: 4 },
    { id: 'pending_approvals', x: 6, y: 12, w: 6, h: 4 }
  ];
  const manager = [
    { id: 'kpis', x: 0, y: 0, w: 12, h: 2 },
    { id: 'pending_approvals', x: 0, y: 2, w: 6, h: 4 },
    { id: 'sla_risk', x: 6, y: 2, w: 6, h: 4 },
    { id: 'incidents_daily', x: 0, y: 6, w: 6, h: 5 },
    { id: 'incidents_by_category', x: 6, y: 6, w: 6, h: 5 },
    { id: 'mttr_by_group', x: 0, y: 11, w: 6, h: 4 },
    { id: 'changes_week', x: 6, y: 11, w: 6, h: 4 }
  ];
  return hasRole(user, 'manager') ? manager : agent;
}

function availableWidgets(user) {
  return Object.entries(WIDGETS)
    .filter(([, w]) => hasRole(user, w.role))
    .map(([id, w]) => ({ id, title: w.title, size: w.size }));
}

module.exports = { WIDGETS, defaultLayout, availableWidgets };
