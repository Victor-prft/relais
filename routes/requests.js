'use strict';

const express = require('express');
const { z, parse, params, query, idParam, optionalId, level } = require('../lib/validate');
const { requireAuth, requireRole } = require('../auth/middleware');
const { forbidden } = require('../lib/http-errors');
const { runListQuery, listQuerySchema } = require('../lib/list-query');
const { updateTicket, requireTicket, isStaffActor } = require('../tickets/service');
const { assertCanView, scopeClause, canView } = require('../tickets/access');
const { ticketView } = require('../tickets/view');
const { requestList, taskList } = require('../requests/list');
const { requestWorkflow, taskWorkflow, APPROVAL_STATES } = require('../requests/workflow');
const { listForTicket } = require('../approvals/service');
const { tasksOf } = require('../requests/fulfillment');

const version = z.number().int().positive();

/** Demandes de service (REQ) et tâches (TASK). */
module.exports = function requestRoutes({ db }) {
  const requests = express.Router();
  requests.use(requireAuth);

  requests.get('/meta', (_req, res) => res.json({ states: requestWorkflow.states, task_states: taskWorkflow.states, approval_states: APPROVAL_STATES }));

  requests.get('/', query(listQuerySchema), (req, res) => {
    res.json(runListQuery(db, requestList, req.validQuery, req.ctx, scopeClause(req.user)));
  });

  function requestDetail(req, ticket) {
    return {
      ...ticketView(req.ctx, ticket),
      approvals: listForTicket(db, ticket.id),
      tasks: tasksOf(db, ticket.id).map((t) => ({
        id: t.id,
        number: t.number,
        title: t.title,
        state: t.state,
        state_label: taskWorkflow.label(t.state),
        sequence: t.sequence,
        assigned_to_name: t.assigned_to_id ? db.prepare('SELECT full_name FROM users WHERE id = ?').get(t.assigned_to_id)?.full_name : null,
        assignment_group_name: t.assignment_group_id ? db.prepare('SELECT name FROM support_groups WHERE id = ?').get(t.assignment_group_id)?.name : null
      }))
    };
  }

  requests.get('/:id', params(idParam), (req, res) => {
    const ticket = requireTicket(db, req.validParams.id);
    if (ticket.type !== 'request') throw forbidden('Ce ticket n’est pas une demande');
    assertCanView(db, req.user, ticket);
    res.json(requestDetail(req, ticket));
  });

  requests.patch('/:id', params(idParam), (req, res) => {
    const ticket = requireTicket(db, req.validParams.id);
    if (ticket.type !== 'request') throw forbidden('Ce ticket n’est pas une demande');
    assertCanView(db, req.user, ticket);
    const staff = isStaffActor(req.ctx);
    const schema = staff
      ? z.object({ state: z.enum(Object.keys(requestWorkflow.states)), impact: level, urgency: level, assignment_group_id: optionalId, assigned_to_id: optionalId, version }).partial().strict()
      : z.object({ state: z.enum(Object.keys(requestWorkflow.states)), version: version.optional() }).strict();
    const { version: v, ...patch } = parse(schema, req.body);
    if (!staff && ticket.requester_id !== req.user.id && ticket.requested_for_id !== req.user.id) throw forbidden();
    res.json(requestDetail(req, updateTicket(req.ctx, ticket.id, patch, { expectedVersion: v ?? null })));
  });

  // --- Tâches : réservées au support ------------------------------------
  const tasks = express.Router();
  tasks.use(requireRole('agent'));

  tasks.get('/', query(listQuerySchema), (req, res) => res.json(runListQuery(db, taskList, req.validQuery, req.ctx)));

  function taskDetail(req, ticket) {
    const parent = ticket.parent_id ? requireTicket(db, ticket.parent_id) : null;
    return {
      ...ticketView(req.ctx, ticket),
      parent: parent && canView(db, req.user, parent) ? ticketView(req.ctx, parent) : null,
      siblings: parent ? tasksOf(db, parent.id).map((t) => ({ id: t.id, number: t.number, title: t.title, state: t.state, sequence: t.sequence })) : []
    };
  }

  tasks.get('/:id', params(idParam), (req, res) => {
    const ticket = requireTicket(db, req.validParams.id);
    if (ticket.type !== 'request_task') throw forbidden('Ce ticket n’est pas une tâche');
    res.json(taskDetail(req, ticket));
  });

  tasks.patch(
    '/:id',
    params(idParam),
    (req, res) => {
      const ticket = requireTicket(db, req.validParams.id);
      if (ticket.type !== 'request_task') throw forbidden('Ce ticket n’est pas une tâche');
      const { version: v, ...patch } = parse(
        z.object({ state: z.enum(Object.keys(taskWorkflow.states)), assignment_group_id: optionalId, assigned_to_id: optionalId, version }).partial().strict(),
        req.body
      );
      res.json(taskDetail(req, updateTicket(req.ctx, ticket.id, patch, { expectedVersion: v ?? null })));
    }
  );

  return { requests, tasks };
};
