'use strict';

const { refreshRunning } = require('./engine');
const { notify, groupMembers, groupManager } = require('../notifications/service');
const { loadTicket } = require('../tickets/service');
const { formatMinutes } = require('./format');

/**
 * Job SLA (toutes les 5 minutes) : met à jour l'avancement et prévient
 * - à risque (seuil `sla.at_risk_threshold`) : l'agent assigné, à défaut le groupe ;
 * - dépassé : l'agent (ou le groupe) et le manager du groupe.
 */
function runSlaJob(db, now = new Date()) {
  const ctx = { db, user: null, now };
  return refreshRunning(db, now, (sla, kind) => {
    const ticket = loadTicket(db, sla.ticket_id);
    if (!ticket) return;
    const owners = ticket.assigned_to_id ? [ticket.assigned_to_id] : groupMembers(db, ticket.assignment_group_id);
    const what = sla.target === 'response' ? 'prise en charge' : 'résolution';
    if (kind === 'at_risk') {
      notify(ctx, {
        userIds: owners,
        type: 'sla_at_risk',
        title: `SLA à risque : ${ticket.number}`,
        body: `${sla.name} — reste ${formatMinutes(sla.remaining_minutes)} ouvrées avant l’échéance de ${what}.`,
        ticket
      });
    } else {
      notify(ctx, {
        userIds: [...owners, groupManager(db, ticket.assignment_group_id)],
        type: 'sla_breached',
        title: `SLA dépassé : ${ticket.number}`,
        body: `${sla.name} — délai de ${what} dépassé (${ticket.title}).`,
        ticket
      });
    }
  });
}

module.exports = { runSlaJob };
