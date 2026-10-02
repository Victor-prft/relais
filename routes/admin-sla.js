'use strict';

const express = require('express');
const { z, body, params, idParam, text } = require('../lib/validate');
const { requireRole } = require('../auth/middleware');
const { notFound, badRequest } = require('../lib/http-errors');

/**
 * Configuration des SLA et des calendriers ouvrés (admin). Une modification
 * vaut pour les SLA démarrés ensuite : un SLA en cours garde sa définition,
 * les tickets ouverts ne changent pas d'échéance sous les pieds de l'agent.
 */
module.exports = function adminSlaRoutes({ db }) {
  const router = express.Router();
  router.use(requireRole('admin'));

  router.get('/', (_req, res) => {
    const definitions = db
      .prepare(
        `SELECT d.*, c.name AS calendar_name,
                (SELECT COUNT(*) FROM ticket_slas s WHERE s.sla_definition_id = d.id AND s.stage IN ('running', 'paused')) AS active_count
           FROM sla_definitions d JOIN business_calendars c ON c.id = d.calendar_id
          ORDER BY d.ticket_type, d.priority, d.target DESC`
      )
      .all();
    const calendars = db.prepare('SELECT * FROM business_calendars ORDER BY id').all().map((c) => ({
      ...c,
      hours: db.prepare('SELECT weekday, start_minute, end_minute FROM business_hours WHERE calendar_id = ? ORDER BY weekday, start_minute').all(c.id),
      holidays: db.prepare('SELECT date, label FROM holidays WHERE calendar_id = ? ORDER BY date').all(c.id)
    }));
    res.json({ definitions, calendars });
  });

  router.patch(
    '/definitions/:id',
    params(idParam),
    body(
      z
        .object({
          duration_minutes: z.number().int().min(1).max(60 * 24 * 60),
          calendar_id: z.number().int().positive(),
          is_active: z.boolean(),
          name: text(80)
        })
        .partial()
        .strict()
    ),
    (req, res) => {
      const def = db.prepare('SELECT * FROM sla_definitions WHERE id = ?').get(req.validParams.id);
      if (!def) throw notFound('Définition introuvable');
      const next = { ...def, ...req.body };
      db.prepare('UPDATE sla_definitions SET name = ?, duration_minutes = ?, calendar_id = ?, is_active = ? WHERE id = ?').run(
        next.name,
        next.duration_minutes,
        next.calendar_id,
        Number(next.is_active),
        def.id
      );
      res.json({ ok: true });
    }
  );

  const slot = z.object({
    weekday: z.number().int().min(0).max(6),
    start_minute: z.number().int().min(0).max(1439),
    end_minute: z.number().int().min(1).max(1440)
  });

  router.put(
    '/calendars/:id',
    params(idParam),
    body(
      z.object({
        name: text(80),
        timezone: z.string().max(60).refine((tz) => {
          try {
            new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
            return true;
          } catch {
            return false;
          }
        }, 'Fuseau horaire inconnu'),
        hours: z.array(slot).max(50),
        holidays: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), label: text(80) })).max(200)
      })
    ),
    (req, res) => {
      const { id } = req.validParams;
      if (!db.prepare('SELECT 1 FROM business_calendars WHERE id = ?').get(id)) throw notFound('Calendrier introuvable');
      const { name, timezone, hours, holidays } = req.body;
      for (const h of hours) if (h.end_minute <= h.start_minute) throw badRequest('Une plage doit finir après son début');
      if (!hours.length) throw badRequest('Un calendrier doit avoir au moins une plage ouvrée');
      db.transaction(() => {
        db.prepare('UPDATE business_calendars SET name = ?, timezone = ? WHERE id = ?').run(name, timezone, id);
        db.prepare('DELETE FROM business_hours WHERE calendar_id = ?').run(id);
        db.prepare('DELETE FROM holidays WHERE calendar_id = ?').run(id);
        const insertHour = db.prepare('INSERT INTO business_hours (calendar_id, weekday, start_minute, end_minute) VALUES (?, ?, ?, ?)');
        for (const h of hours) insertHour.run(id, h.weekday, h.start_minute, h.end_minute);
        const insertHoliday = db.prepare('INSERT OR REPLACE INTO holidays (calendar_id, date, label) VALUES (?, ?, ?)');
        for (const d of holidays) insertHoliday.run(id, d.date, d.label);
      })();
      res.json({ ok: true });
    }
  );

  return router;
};
