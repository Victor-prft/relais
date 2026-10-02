'use strict';

const { createTicket, updateTicket, requireTicket } = require('../tickets/service');
const { recordEvent } = require('../tickets/audit');
const { requestApprovals } = require('../approvals/service');
const { impactOf } = require('../cmdb/graph');
const { notFound, badRequest, unprocessable } = require('../lib/http-errors');
const { RISKS } = require('./workflow');

/** Changements : création (éventuellement depuis un modèle standard), CI impactés, soumission au CAB. */

function getTemplate(db, id) {
  const tpl = db.prepare('SELECT * FROM standard_changes WHERE id = ? AND is_active = 1').get(id);
  if (!tpl) throw notFound('Modèle de changement standard introuvable');
  return tpl;
}

function setCis(ctx, changeId, ciIds) {
  const { db } = ctx;
  const ticket = requireTicket(db, changeId);
  if (!['draft', 'authorized', 'scheduled', 'rejected'].includes(ticket.state)) {
    throw unprocessable('Les CI impactés se modifient en brouillon ou avant la mise en œuvre');
  }
  const unique = [...new Set(ciIds)];
  const known = unique.length ? db.prepare(`SELECT id, name FROM cis WHERE id IN (${unique.map(() => '?').join(', ')})`).all(...unique) : [];
  if (known.length !== unique.length) throw badRequest('CI inconnu', [{ path: 'ci_ids', message: 'Référence inconnue' }]);
  db.transaction(() => {
    db.prepare('DELETE FROM ticket_cis WHERE ticket_id = ?').run(changeId);
    const insert = db.prepare('INSERT INTO ticket_cis (ticket_id, ci_id) VALUES (?, ?)');
    for (const id of unique) insert.run(changeId, id);
    recordEvent(db, {
      entity: 'ticket',
      entityId: changeId,
      event: 'ci',
      display: known.length ? `CI impactés : ${known.map((c) => c.name).join(', ')}` : 'CI impactés retirés',
      userId: ctx.user?.id,
      at: ctx.now.toISOString()
    });
  })();
}

/**
 * Risque conseillé, d'après les CI touchés : criticité la plus forte et
 * nombre d'éléments qui en dépendent (analyse d'impact de la CMDB).
 */
function suggestRisk(db, ciIds) {
  if (!ciIds.length) return null;
  const crit = db.prepare(`SELECT MIN(criticality) AS c FROM cis WHERE id IN (${ciIds.map(() => '?').join(', ')})`).get(...ciIds).c;
  const impacted = new Set();
  for (const id of ciIds) for (const hit of impactOf(db, id)) impacted.add(hit.id);
  const risk = crit === 1 || impacted.size >= 5 ? 'high' : crit === 2 || impacted.size >= 2 ? 'moderate' : 'low';
  return { risk, label: RISKS[risk], impacted: impacted.size, max_criticality: crit };
}

function createChange(ctx, input) {
  const { ci_ids: ciIds = [], template_id: templateId = null, ...fields } = input;
  const record = { ...fields, state: 'draft' };
  if (templateId) {
    const tpl = getTemplate(ctx.db, templateId);
    Object.assign(record, {
      change_type: 'standard',
      standard_template_id: tpl.id,
      title: fields.title || tpl.name,
      description: fields.description ?? tpl.description,
      implementation_plan: tpl.implementation_plan,
      backout_plan: tpl.backout_plan,
      test_plan: tpl.test_plan,
      risk: tpl.risk,
      justification: fields.justification || 'Changement standard pré-autorisé.'
    });
    if (record.planned_start && !record.planned_end) {
      record.planned_end = new Date(new Date(record.planned_start).getTime() + tpl.duration_minutes * 60000).toISOString();
    }
  }
  if (record.change_type === 'standard' && !templateId) throw badRequest('Un changement standard part d’un modèle', [{ path: 'template_id', message: 'Obligatoire' }]);
  // Le changement urgent naît en P2, les autres en P4 (impact × urgence ajustables ensuite).
  record.impact ??= 2;
  record.urgency ??= record.change_type === 'emergency' ? 1 : 3;
  return ctx.db.transaction(() => {
    const ticket = createTicket(ctx, 'change', record);
    if (ciIds.length) setCis(ctx, ticket.id, ciIds);
    return requireTicket(ctx.db, ticket.id);
  })();
}

function submitToCab(ctx, changeId, approverIds) {
  const { db } = ctx;
  const ticket = requireTicket(db, changeId);
  if (!approverIds.length) throw badRequest('Choisissez au moins un approbateur', [{ path: 'approver_ids', message: 'Obligatoire' }]);
  const approvers = db
    .prepare(`SELECT id FROM users WHERE is_active = 1 AND role IN ('manager', 'admin') AND id IN (${approverIds.map(() => '?').join(', ')})`)
    .all(...approverIds)
    .map((r) => r.id);
  if (approvers.length !== new Set(approverIds).size) throw badRequest('Les approbateurs du CAB sont des managers actifs', [{ path: 'approver_ids', message: 'Invalide' }]);
  return db.transaction(() => {
    const updated = updateTicket(ctx, ticket.id, { state: 'assess' });
    requestApprovals(ctx, updated, approvers, { message: `${updated.title} — ${updated.change_type === 'emergency' ? 'urgent' : 'à évaluer'}` });
    return updated;
  })();
}

module.exports = { createChange, setCis, submitToCab, suggestRisk, getTemplate };
