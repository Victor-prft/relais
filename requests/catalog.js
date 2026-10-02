'use strict';

const { notFound, conflict, unprocessable } = require('../lib/http-errors');
const { parseFormSchema, validateValues, referenceCheckers } = require('../lib/form-schema');
const { createTicket } = require('../tickets/service');
const { requestApprovals } = require('../approvals/service');
const { createTasks } = require('./fulfillment');

/** Catalogue de services : articles, formulaires, commande. */

function hydrate(db, row) {
  if (!row) return null;
  return {
    ...row,
    form_schema: JSON.parse(row.form_schema),
    requires_approval: Boolean(row.requires_approval),
    is_active: Boolean(row.is_active),
    tasks: db
      .prepare(
        `SELECT t.id, t.sequence, t.title, t.description, t.assignment_group_id, g.name AS assignment_group_name
           FROM catalog_item_tasks t LEFT JOIN support_groups g ON g.id = t.assignment_group_id
          WHERE t.catalog_item_id = ? ORDER BY t.sequence, t.id`
      )
      .all(row.id)
  };
}

function listItems(db, { includeInactive = false } = {}) {
  return db
    .prepare(
      `SELECT i.*, c.name AS category_name FROM catalog_items i LEFT JOIN categories c ON c.id = i.category_id
        ${includeInactive ? '' : 'WHERE i.is_active = 1'} ORDER BY c.sort_order, i.sort_order, i.name`
    )
    .all()
    .map((r) => hydrate(db, r));
}

function getItem(db, id) {
  const item = hydrate(db, db.prepare('SELECT i.*, c.name AS category_name FROM catalog_items i LEFT JOIN categories c ON c.id = i.category_id WHERE i.id = ?').get(id));
  if (!item) throw notFound('Article du catalogue introuvable');
  return item;
}

/** Création ou mise à jour d'un article (admin), modèles de tâches compris. */
function saveItem(ctx, id, input) {
  const { db } = ctx;
  const schema = parseFormSchema(input.form_schema || []);
  const now = ctx.now.toISOString();
  try {
    return db.transaction(() => {
      let itemId = id;
      const row = {
        name: input.name,
        short_description: input.short_description,
        description: input.description ?? null,
        category_id: input.category_id ?? null,
        icon: input.icon || 'package',
        form_schema: JSON.stringify(schema),
        requires_approval: Number(Boolean(input.requires_approval)),
        fulfillment_group_id: input.fulfillment_group_id ?? null,
        delivery_days: input.delivery_days ?? null,
        is_active: Number(input.is_active !== false),
        sort_order: input.sort_order ?? 0,
        now
      };
      if (id) {
        if (!db.prepare('SELECT 1 FROM catalog_items WHERE id = ?').get(id)) throw notFound('Article introuvable');
        db.prepare(
          `UPDATE catalog_items SET name = @name, short_description = @short_description, description = @description,
                  category_id = @category_id, icon = @icon, form_schema = @form_schema, requires_approval = @requires_approval,
                  fulfillment_group_id = @fulfillment_group_id, delivery_days = @delivery_days, is_active = @is_active,
                  sort_order = @sort_order, updated_at = @now WHERE id = @id`
        ).run({ ...row, id });
      } else {
        itemId = Number(
          db
            .prepare(
              `INSERT INTO catalog_items (name, short_description, description, category_id, icon, form_schema, requires_approval,
                                          fulfillment_group_id, delivery_days, is_active, sort_order, created_at, updated_at)
               VALUES (@name, @short_description, @description, @category_id, @icon, @form_schema, @requires_approval,
                       @fulfillment_group_id, @delivery_days, @is_active, @sort_order, @now, @now)`
            )
            .run(row).lastInsertRowid
        );
      }
      if (input.tasks) {
        // Les tâches déjà créées gardent leur lien (ON DELETE SET NULL) : remplacer les modèles est sûr.
        db.prepare('DELETE FROM catalog_item_tasks WHERE catalog_item_id = ?').run(itemId);
        const insert = db.prepare('INSERT INTO catalog_item_tasks (catalog_item_id, sequence, title, description, assignment_group_id) VALUES (?, ?, ?, ?, ?)');
        for (const t of input.tasks) insert.run(itemId, t.sequence, t.title, t.description ?? null, t.assignment_group_id ?? null);
      }
      return getItem(db, itemId);
    })();
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw conflict('Un article porte déjà ce nom');
    throw err;
  }
}

/**
 * Commande d'un article : valide le formulaire, crée la REQ puis, selon
 * l'article, demande l'approbation du manager du bénéficiaire ou génère
 * directement les tâches. Sans manager connu, pas d'approbation possible :
 * la demande part en exécution (et l'historique le dit).
 */
function orderItem(ctx, itemId, { requested_for_id: forId = null, variables = {} }) {
  const { db, user } = ctx;
  const item = getItem(db, itemId);
  if (!item.is_active) throw unprocessable('Cet article n’est plus proposé');
  const clean = validateValues(item.form_schema, variables, referenceCheckers(db));
  const beneficiary = db.prepare('SELECT id, full_name, manager_id, is_active FROM users WHERE id = ?').get(forId || user.id);
  if (!beneficiary || !beneficiary.is_active) throw unprocessable('Bénéficiaire inconnu', [{ path: 'requested_for_id', message: 'Inconnu' }]);

  const approverId = item.requires_approval ? beneficiary.manager_id : null;
  const needsApproval = Boolean(approverId) && approverId !== user.id;

  return db.transaction(() => {
    const ticket = createTicket(ctx, 'request', {
      title: beneficiary.id === user.id ? item.name : `${item.name} — pour ${beneficiary.full_name}`,
      description: item.short_description,
      requester_id: user.id,
      impact: 3,
      urgency: 2,
      category_id: item.category_id,
      assignment_group_id: item.fulfillment_group_id,
      catalog_item_id: item.id,
      requested_for_id: beneficiary.id,
      variables: JSON.stringify(clean),
      approval_state: needsApproval ? 'requested' : item.requires_approval ? 'approved' : 'not_required',
      state: needsApproval ? 'pending_approval' : 'in_progress'
    });
    if (needsApproval) requestApprovals(ctx, ticket, [approverId], { message: `${item.name} pour ${beneficiary.full_name}` });
    else createTasks(ctx, ticket);
    return ticket;
  })();
}

module.exports = { listItems, getItem, saveItem, orderItem };
