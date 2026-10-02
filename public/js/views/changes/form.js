import { h, mount, loading, debounce } from '../../ui/dom.js';
import { icons } from '../../ui/icons.js';
import { api } from '../../api.js';
import { modal, toast, toastError, confirmDialog } from '../../ui/feedback.js';
import { field, textInput, textArea, selectInput, referenceInput, numberOrNull } from '../../ui/fields.js';
import { workflowBar, tabbed, keyValues, sideCard } from '../../ui/record.js';
import { activityPanel } from '../../ui/activity.js';
import { relationsPanel } from '../../ui/relations.js';
import { stateBadge, priorityBadge } from '../../ui/badges.js';
import { approvalsBlock } from '../../ui/request-parts.js';
import { formatDateTime, toLocalInput, fromLocalInput } from '../../format.js';
import { navigate } from '../../router.js';
import { getGroups, cached } from '../../state.js';
import { setTitle } from '../../app.js';

export const getChangeMeta = () => cached('change-meta', () => api.get('/api/changes/meta'));
export const RISK_TONES = { low: 'ok', moderate: 'warn', high: 'danger' };

/** Sélecteur de plusieurs CI (puces + recherche). */
function ciPicker(initial = [], { disabled = false, onChange = () => {} } = {}) {
  let items = [...initial];
  const chips = h('div', { class: 'chips', style: { padding: 0 } });
  const search = referenceInput({
    endpoint: '/api/cis',
    placeholder: 'Ajouter un CI…',
    labelOf: (c) => c.name,
    sublabelOf: (c) => c.class_label,
    disabled,
    onChange: (ci) => {
      if (ci && !items.some((x) => x.id === ci.id)) {
        items.push({ id: ci.id, name: ci.name });
        paint();
        onChange(items);
      }
      search.setValue(null);
    }
  });
  const paint = () =>
    mount(chips,
      items.map((ci) =>
        h('span', { class: 'chip' }, ci.name, disabled ? null : h('button', { type: 'button', 'aria-label': `Retirer ${ci.name}`, onclick: () => { items = items.filter((x) => x.id !== ci.id); paint(); onChange(items); } }, '×'))
      )
    );
  paint();
  const el = h('div', { class: 'stack' }, chips, disabled ? null : search);
  el.getValue = () => items.map((x) => x.id);
  return el;
}

function conflictList(conflicts) {
  if (!conflicts.length) return h('p', { class: 'small muted', style: { margin: 0 } }, 'Aucun conflit sur cette fenêtre.');
  return h('ul', { class: 'stack', style: { listStyle: 'none', padding: 0, margin: 0 } },
    conflicts.map((c) =>
      h('li', { class: `callout ${c.level === 'conflict' ? 'danger' : 'warn'}`, style: { padding: '8px 10px' } },
        h('div', { class: 'row', style: { gap: '6px' } }, (c.level === 'conflict' ? icons.alert : icons.clock)({ size: 15 }), h('strong', {}, c.level === 'conflict' ? 'Conflit' : 'Dépendance'), h('a', { href: `#/changes/${c.id}`, class: 'number' }, c.number)),
        h('div', { class: 'small' }, c.title),
        h('div', { class: 'small muted' }, `${formatDateTime(c.planned_start)} → ${formatDateTime(c.planned_end)} · ${c.cis.map((x) => x.name || x).join(', ')}`)
      )
    )
  );
}

export async function changeFormView(el, { id }, query = {}) {
  mount(el, loading());
  const isNew = id === 'new';
  const [meta, groups, change] = await Promise.all([getChangeMeta(), getGroups(), isNew ? null : api.get(`/api/changes/${id}`)]);
  render(el, { meta, groups, change, query });
}

function render(el, { meta, groups, change, query }) {
  const isNew = !change;
  const t = change || { change_type: query.type === 'emergency' ? 'emergency' : 'normal', risk: 'moderate', state: 'draft', cis: [], approvals: [], conflicts: [], permissions: { edit: true, work_notes: true } };
  const draft = t.state === 'draft' || t.state === 'rejected';
  const contentEditable = isNew || (t.state === 'draft' && t.permissions.edit);
  const windowEditable = isNew || ['draft', 'authorized', 'scheduled', 'rejected'].includes(t.state);
  setTitle(isNew ? 'Nouveau changement' : `${t.number} · ${t.title}`);

  const c = {
    title: textInput({ value: t.title, maxlength: 160, readOnly: !contentEditable }),
    description: textArea({ value: t.description, rows: 3, readOnly: !contentEditable }),
    change_type: selectInput(Object.entries(meta.types).filter(([k]) => k !== 'standard' || t.change_type === 'standard').map(([value, label]) => ({ value, label })), { value: t.change_type, disabled: !contentEditable || t.change_type === 'standard' }),
    risk: selectInput(Object.entries(meta.risks).map(([value, label]) => ({ value, label })), { value: t.risk, disabled: !contentEditable }),
    justification: textArea({ value: t.justification, rows: 3, readOnly: !contentEditable }),
    implementation_plan: textArea({ value: t.implementation_plan, rows: 6, readOnly: !contentEditable }),
    backout_plan: textArea({ value: t.backout_plan, rows: 4, readOnly: !contentEditable }),
    test_plan: textArea({ value: t.test_plan, rows: 3, readOnly: !contentEditable }),
    planned_start: h('input', { class: 'input', type: 'datetime-local', value: toLocalInput(t.planned_start), readOnly: !windowEditable }),
    planned_end: h('input', { class: 'input', type: 'datetime-local', value: toLocalInput(t.planned_end), readOnly: !windowEditable }),
    assignment_group_id: selectInput(groups.map((g) => ({ value: g.id, label: g.name })), { value: t.assignment_group_id, empty: '— Aucun —', disabled: !t.permissions.edit }),
    assigned_to_id: referenceInput({ endpoint: '/api/users', params: { staff: '1', group_id: t.assignment_group_id || undefined }, value: t.assigned_to_id ? { id: t.assigned_to_id, label: t.assigned_to_name } : null, disabled: !t.permissions.edit })
  };
  c.assignment_group_id.addEventListener('change', () => c.assigned_to_id.setParams({ group_id: c.assignment_group_id.value || undefined }));

  // Conflits et risque recalculés à la volée quand la fenêtre ou les CI changent.
  const conflictHost = h('div', {}, conflictList(t.conflicts));
  const riskHint = h('div', { class: 'hint' });
  const paintRisk = (s) => { riskHint.textContent = s ? `Risque conseillé : ${s.label} (criticité max ${s.max_criticality}, ${s.impacted} élément(s) dépendant(s))` : ''; };
  paintRisk(t.risk_suggestion);
  const recheck = debounce(async () => {
    const ciIds = cis.getValue();
    const start = fromLocalInput(c.planned_start.value);
    const end = fromLocalInput(c.planned_end.value);
    if (!ciIds.length || !start || !end || end <= start) return mount(conflictHost, conflictList([]));
    try {
      const res = await api.get('/api/changes/conflicts', { ci_ids: ciIds.join(','), start, end, exclude: t.id });
      mount(conflictHost, conflictList(res.items));
      paintRisk(res.risk);
    } catch {
      /* vérification indicative : on n'interrompt pas la saisie */
    }
  }, 400);
  const cis = ciPicker(t.cis, { disabled: !windowEditable, onChange: recheck });
  c.planned_start.addEventListener('change', recheck);
  c.planned_end.addEventListener('change', recheck);

  const payload = () => {
    const out = {
      planned_start: fromLocalInput(c.planned_start.value),
      planned_end: fromLocalInput(c.planned_end.value),
      assignment_group_id: numberOrNull(c.assignment_group_id.value),
      assigned_to_id: c.assigned_to_id.getValue()
    };
    if (contentEditable) {
      Object.assign(out, {
        title: c.title.value.trim(),
        description: c.description.value.trim() || null,
        risk: c.risk.value,
        justification: c.justification.value.trim() || null,
        implementation_plan: c.implementation_plan.value.trim() || null,
        backout_plan: c.backout_plan.value.trim() || null,
        test_plan: c.test_plan.value.trim() || null
      });
      if (t.change_type !== 'standard') out.change_type = c.change_type.value;
    }
    return out;
  };

  const reload = (fresh) => (fresh ? render(el, { meta, groups, change: fresh, query: {} }) : changeFormView(el, { id: t.id }));

  async function save(extra = {}) {
    try {
      if (isNew) {
        const created = await api.post('/api/changes', { ...payload(), ci_ids: cis.getValue(), template_id: query.template ? Number(query.template) : undefined });
        toast(`${created.number} créé`);
        navigate(`/changes/${created.id}`);
        return null;
      }
      if (windowEditable && String(cis.getValue()) !== String(t.cis.map((x) => x.id))) {
        await api.put(`/api/changes/${t.id}/cis`, { ci_ids: cis.getValue() });
        t.version = (await api.get(`/api/changes/${t.id}`)).version;
      }
      const updated = await api.patch(`/api/changes/${t.id}`, { ...(t.permissions.edit ? payload() : {}), ...extra, version: t.version });
      toast('Changement enregistré');
      reload(updated);
      return updated;
    } catch (err) {
      toastError(err);
      if (err.status === 409) reload();
      return null;
    }
  }

  async function submit() {
    const boxes = meta.cab.map((m) => {
      const box = h('input', { type: 'checkbox', checked: m.role === 'manager', value: m.id });
      return { box, el: h('label', { class: 'checkbox' }, box, m.full_name, h('span', { class: 'small faint' }, m.role === 'admin' ? 'admin' : 'manager')) };
    });
    const ok = await modal({
      title: 'Soumettre au CAB',
      build: (body) => body.append(h('div', { class: 'stack' },
        h('p', { class: 'small muted' }, t.change_type === 'emergency' ? 'Changement urgent : le premier avis rendu tranche.' : 'Changement normal : tous les approbateurs doivent approuver ; un refus suffit à rejeter.'),
        boxes.map((b) => b.el)
      )),
      actions: [{ label: 'Annuler', onClick: (close) => close(false) }, { label: 'Soumettre', class: 'primary', onClick: (close) => close(true) }]
    });
    if (!ok) return;
    const saved = await save();
    if (!saved) return;
    try {
      const res = await api.post(`/api/changes/${t.id}/submit`, { approver_ids: boxes.filter((b) => b.box.checked).map((b) => Number(b.box.value)) });
      toast('Soumis au CAB');
      reload(res);
    } catch (err) {
      toastError(err);
    }
  }

  async function closeChange() {
    const code = selectInput(Object.entries(meta.close_codes).map(([value, label]) => ({ value, label })));
    const notes = textArea({ rows: 4, placeholder: 'Déroulé, écarts au plan, suites à donner…' });
    const ok = await modal({
      title: 'Clore le changement',
      build: (body) => body.append(h('div', { class: 'stack' }, field('Résultat', code, { required: true }), field('Bilan', notes))),
      actions: [{ label: 'Annuler', onClick: (close) => close(false) }, { label: 'Clore', class: 'primary', onClick: (close) => close(true) }]
    });
    if (ok) save({ state: 'closed', close_code: code.value, close_notes: notes.value.trim() || null });
  }

  // --- Actions selon l'état ------------------------------------------
  const allowed = new Set((t.allowed_transitions || []).map((x) => x.state));
  const actions = [];
  if (!isNew) {
    if (allowed.has('assess') && t.change_type !== 'standard') actions.push(h('button', { class: 'btn primary', type: 'button', onclick: submit }, 'Soumettre au CAB'));
    if (allowed.has('scheduled') && (t.state === 'authorized' || t.change_type === 'standard')) actions.push(h('button', { class: 'btn primary', type: 'button', onclick: () => save({ state: 'scheduled' }) }, icons.calendar({ size: 16 }), 'Planifier'));
    if (allowed.has('draft')) actions.push(h('button', { class: 'btn', type: 'button', onclick: () => save({ state: 'draft' }) }, t.state === 'rejected' ? 'Retravailler' : 'Retirer du CAB'));
    if (allowed.has('implement')) actions.push(h('button', { class: 'btn primary', type: 'button', onclick: () => save({ state: 'implement' }) }, 'Démarrer la mise en œuvre'));
    if (allowed.has('review')) actions.push(h('button', { class: 'btn primary', type: 'button', onclick: () => save({ state: 'review' }) }, 'Terminer la mise en œuvre'));
    if (allowed.has('closed')) actions.push(h('button', { class: 'btn primary', type: 'button', onclick: closeChange }, 'Clore'));
    if (allowed.has('canceled')) actions.push(h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmDialog('Annuler ce changement ?', { danger: true, confirmLabel: 'Annuler le changement' })) save({ state: 'canceled' }); } }, 'Annuler'));
  }
  const saveButton = h('button', { class: `btn ${isNew ? 'primary' : ''}`, type: 'button', onclick: () => save() }, icons.save({ size: 16 }), isNew ? 'Créer le brouillon' : 'Enregistrer');

  const head = h('div', { class: 'record-head' },
    h('div', { class: 'grow' },
      h('div', { class: 'row' },
        h('span', { class: 'number' }, isNew ? 'Nouveau changement' : t.number),
        !isNew ? stateBadge(t.state, t.state_label) : null,
        h('span', { class: 'badge' }, meta.types[t.change_type]),
        h('span', { class: `badge dot ${RISK_TONES[t.risk]}` }, `Risque ${meta.risks[t.risk].toLowerCase()}`),
        t.template ? h('span', { class: 'badge accent' }, `Modèle : ${t.template.name}`) : null
      ),
      h('h1', {}, isNew ? (query.template ? 'Changement standard' : 'Nouveau changement') : t.title)
    ),
    h('div', { class: 'btn-group' }, actions, t.permissions.edit || isNew ? saveButton : null)
  );

  const details = (panel) => mount(panel,
    !draft && !isNew && t.state !== 'closed' ? h('div', { class: 'callout small', style: { marginBottom: '16px' } }, 'Contenu figé depuis la soumission : seules la fenêtre, les CI et l’assignation restent modifiables avant la mise en œuvre.') : null,
    h('div', { class: 'grid-2' },
      field('Titre', c.title, { required: true, className: 'span-2' }),
      field('Type', c.change_type),
      h('div', { class: 'field' }, h('label', {}, 'Risque'), c.risk, riskHint),
      field('Début de la fenêtre', c.planned_start, { required: true }),
      field('Fin de la fenêtre', c.planned_end, { required: true }),
      field('CI impactés', cis, { className: 'span-2' }),
      field('Groupe', c.assignment_group_id),
      field('Responsable', c.assigned_to_id),
      field('Description', c.description, { className: 'span-2' }),
      field('Justification', c.justification, { className: 'span-2', required: true })
    ),
    h('h4', { style: { marginTop: '20px' } }, 'Conflits de planification'),
    conflictHost
  );
  const planning = (panel) => mount(panel,
    h('div', { class: 'stack' },
      field('Plan de mise en œuvre', c.implementation_plan, { required: true }),
      field('Plan de retour arrière', c.backout_plan, { required: true, hint: 'Comment revenir à l’état initial si la mise en œuvre échoue.' }),
      field('Plan de test', c.test_plan)
    )
  );

  const tabs = isNew
    ? [{ id: 'details', label: 'Détails', render: details }, { id: 'planning', label: 'Plans', render: planning }]
    : [
        { id: 'details', label: 'Détails', render: details },
        { id: 'planning', label: 'Plans', render: planning },
        { id: 'cab', label: 'CAB', count: t.approvals.length, render: (panel) => panel.append(approvalsBlock(t.approvals)) },
        { id: 'activity', label: 'Activité', render: (panel) => panel.append(activityPanel({ ticketId: t.id, canWorkNote: true })) },
        { id: 'links', label: 'Liens', render: (panel) => panel.append(relationsPanel({ ticketId: t.id, canEdit: true })) }
      ];

  mount(el,
    head,
    isNew || ['canceled', 'rejected'].includes(t.state) ? null : workflowBar(t.workflow_steps, t.workflow_step),
    t.state === 'rejected' ? h('div', { class: 'callout danger', style: { marginBottom: '16px' } }, 'Rejeté par le CAB. Retravaillez le changement puis soumettez-le à nouveau.') : null,
    h('div', { class: 'record' },
      h('div', { class: 'card' }, tabbed(tabs)),
      isNew
        ? h('aside', { class: 'record-aside' }, sideCard('Types de changement', h('dl', { class: 'kv small' },
            h('dt', {}, 'Standard'), h('dd', {}, 'Pré-autorisé, à partir d’un modèle. Pas de CAB.'),
            h('dt', {}, 'Normal'), h('dd', {}, 'Évalué par le CAB : tous les approbateurs doivent approuver.'),
            h('dt', {}, 'Urgent'), h('dd', {}, 'Pour rétablir un service : le premier avis du CAB tranche.')
          )))
        : h('aside', { class: 'record-aside' },
            sideCard('Fenêtre', keyValues([
              ['Prévue', t.planned_start ? `${formatDateTime(t.planned_start)} → ${formatDateTime(t.planned_end)}` : '—'],
              ['Réelle', t.actual_start ? `${formatDateTime(t.actual_start)} → ${t.actual_end ? formatDateTime(t.actual_end) : '…'}` : '—'],
              ['Priorité', priorityBadge(t.priority)],
              ['Résultat', t.close_code_label]
            ])),
            t.approvals.length ? sideCard('CAB', approvalsBlock(t.approvals)) : null
          )
    )
  );
}
