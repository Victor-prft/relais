import { h } from '../../ui/dom.js';
import { icons } from '../../ui/icons.js';
import { priorityBadge, stateBadge, ticketPath } from '../../ui/badges.js';
import { slaCell } from '../../ui/sla.js';
import { lineChart, barChart, dataTable, chartsAvailable } from '../../ui/charts.js';
import { formatRelative, formatDateTime, PRIORITY_LABELS } from '../../format.js';
import { navigate } from '../../router.js';

/**
 * Rendu des widgets : (corps, données, { table }) → fonction de nettoyage
 * éventuelle (destruction des graphiques). `table` : afficher la vue tableau
 * à la place du graphique.
 */

const empty = (text) => h('div', { class: 'empty small' }, text);

function ticketList(items, { meta = (t) => formatRelative(t.opened_at), showSla = true } = {}) {
  if (!items.length) return empty('Rien à signaler.');
  return h('ul', { class: 'widget-list' },
    items.map((t) =>
      h('li', { onclick: () => navigate(ticketPath(t.type, t.id)), tabIndex: 0, onkeydown: (e) => { if (e.key === 'Enter') navigate(ticketPath(t.type, t.id)); } },
        h('div', { class: 'grow', style: { minWidth: 0 } },
          h('div', { class: 'row small muted', style: { flexWrap: 'nowrap', gap: '6px' } }, h('span', { class: 'number' }, t.number), priorityBadge(t.priority, { short: true }), h('span', { class: 'nowrap' }, meta(t))),
          h('div', { class: 'ellipsis' }, t.title)
        ),
        showSla ? h('div', { style: { width: '84px', flex: 'none' } }, slaCell({ sla: t.sla })) : null
      )
    )
  );
}

function stat(value, label, { tone = '', icon = null, hint = null } = {}) {
  return h('div', { class: `kpi ${tone}` },
    h('div', { class: 'kpi-value' }, icon ? icons[icon]({ size: 18 }) : null, value),
    h('div', { class: 'kpi-label' }, label),
    hint ? h('div', { class: 'kpi-hint' }, hint) : null
  );
}

const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)} %`);
const hoursLabel = (v) => (v === null || v === undefined ? '—' : `${v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v)} h`);

function chartHost(body) {
  const canvas = h('canvas', { role: 'img' });
  body.append(h('div', { class: 'chart-host' }, canvas));
  return canvas;
}

export const RENDERERS = {
  kpis(body, d) {
    body.append(
      h('div', { class: 'kpis' },
        stat(d.open, 'Incidents ouverts'),
        stat(d.critical, 'dont P1 / P2', { tone: d.critical ? 'danger' : '', icon: d.critical ? 'alert' : null }),
        stat(d.unassigned, 'Non assignés', { tone: d.unassigned ? 'warn' : '' }),
        stat(d.resolved_today, 'Résolus aujourd’hui', { tone: 'ok' }),
        stat(pct(d.sla_compliance), 'Résolutions dans les temps', { hint: `30 jours · ${d.sla_sample} SLA` }),
        stat(hoursLabel(d.mttr_hours), 'Temps moyen de résolution', { hint: '30 jours, heures calendaires' })
      )
    );
  },

  my_open(body, d) {
    body.append(
      h('div', { class: 'prio-counts' },
        [1, 2, 3, 4, 5].map((p) => h('div', { class: `prio-count prio-${p}`, title: PRIORITY_LABELS[p] }, h('strong', {}, String(d.counts[p])), h('span', {}, `P${p}`)))
      ),
      ticketList(d.items)
    );
  },

  group_queue(body, d) {
    if (!d.groups) return body.append(empty('Vous n’appartenez à aucun groupe de support.'));
    body.append(
      h('div', { class: 'row small muted', style: { marginBottom: '8px' } },
        h('span', {}, `${d.total} ticket${d.total > 1 ? 's' : ''} ouverts`), '·',
        h('span', { style: d.unassigned ? { color: 'var(--warn)', fontWeight: 600 } : null }, `${d.unassigned} non assigné${d.unassigned > 1 ? 's' : ''}`)
      ),
      ticketList(d.items, { meta: (t) => (t.assigned_to ? t.assigned_to : 'Non assigné') + ` · ${t.group_name}` })
    );
  },

  sla_risk(body, d) {
    body.append(
      h('div', { class: 'row', style: { marginBottom: '8px', gap: '12px' } },
        h('span', { class: 'badge danger' }, icons.alert({ size: 13 }), `${d.breached} dépassé${d.breached > 1 ? 's' : ''}`),
        h('span', { class: 'badge warn' }, icons.clock({ size: 13 }), `${d.at_risk} à risque`)
      ),
      d.items.length
        ? h('ul', { class: 'widget-list' },
            d.items.map((s) =>
              h('li', { onclick: () => navigate(ticketPath(s.type, s.id)), tabIndex: 0 },
                h('div', { class: 'grow', style: { minWidth: 0 } },
                  h('div', { class: 'row small muted', style: { flexWrap: 'nowrap', gap: '6px' } }, h('span', { class: 'number' }, s.number), priorityBadge(s.priority, { short: true }), h('span', { class: 'nowrap ellipsis' }, s.sla_name)),
                  h('div', { class: 'ellipsis' }, s.title)
                ),
                h('div', { style: { width: '96px', flex: 'none' }, title: s.due_at ? `Échéance ${formatDateTime(s.due_at)}` : 'En pause' }, slaCell({ sla: s.percent, sla_paused: s.stage === 'paused' ? 1 : 0 }))
              )
            )
          )
        : empty('Aucun SLA à risque.')
    );
  },

  incidents_daily(body, d, { table }) {
    const labels = d.days.map((day) => `${day.slice(8, 10)}/${day.slice(5, 7)}`);
    if (table || !chartsAvailable()) {
      return body.append(dataTable([{ label: 'Jour' }, { label: 'Ouverts', numeric: true }, { label: 'Résolus', numeric: true }], labels.map((l, i) => [l, d.opened[i], d.resolved[i]]).reverse()));
    }
    const total = d.opened.reduce((a, b) => a + b, 0);
    body.append(h('div', { class: 'small muted', style: { marginBottom: '4px' } }, `${total} incidents ouverts sur 30 jours`));
    const chart = lineChart(chartHost(body), { labels, series: [{ label: 'Ouverts', data: d.opened }, { label: 'Résolus', data: d.resolved }] });
    return () => chart.destroy();
  },

  incidents_by_category(body, d, { table }) {
    if (!d.items.length) return body.append(empty('Aucun incident sur la période.'));
    if (table || !chartsAvailable()) return body.append(dataTable([{ label: 'Catégorie' }, { label: 'Incidents', numeric: true }], d.items.map((r) => [r.label, r.value])));
    const chart = barChart(chartHost(body), { labels: d.items.map((r) => r.label), values: d.items.map((r) => r.value), label: 'Incidents' });
    return () => chart.destroy();
  },

  mttr_by_group(body, d, { table }) {
    if (!d.items.length) return body.append(empty('Aucun incident résolu sur la période.'));
    if (table || !chartsAvailable()) {
      return body.append(dataTable([{ label: 'Groupe' }, { label: 'Temps moyen', numeric: true }, { label: 'Incidents', numeric: true }], d.items.map((r) => [r.label, hoursLabel(r.hours), r.count])));
    }
    const chart = barChart(chartHost(body), { labels: d.items.map((r) => `${r.label} (${r.count})`), values: d.items.map((r) => r.hours), label: 'Temps moyen', format: hoursLabel });
    return () => chart.destroy();
  },

  changes_week(body, d) {
    if (!d.items.length) return body.append(empty(d.available ? 'Aucun changement planifié dans les 7 jours.' : 'Module Changements indisponible.'));
    body.append(
      h('ul', { class: 'widget-list' },
        d.items.map((c) =>
          h('li', { onclick: () => navigate(`/changes/${c.id}`), tabIndex: 0 },
            h('div', { class: 'grow', style: { minWidth: 0 } },
              h('div', { class: 'row small muted', style: { flexWrap: 'nowrap', gap: '6px' } }, h('span', { class: 'number' }, c.number), h('span', { class: 'nowrap' }, formatDateTime(c.planned_start))),
              h('div', { class: 'ellipsis' }, c.title),
              c.cis ? h('div', { class: 'small faint ellipsis' }, c.cis) : null
            ),
            stateBadge(c.state)
          )
        )
      )
    );
  },

  pending_approvals(body, d) {
    if (!d.items.length) return body.append(empty(d.available ? 'Aucune approbation en attente.' : 'Module Approbations indisponible.'));
    body.append(
      h('ul', { class: 'widget-list' },
        d.items.map((a) =>
          h('li', { onclick: () => navigate(ticketPath(a.type, a.id)), tabIndex: 0 },
            h('div', { class: 'grow', style: { minWidth: 0 } },
              h('div', { class: 'row small muted', style: { flexWrap: 'nowrap', gap: '6px' } }, h('span', { class: 'number' }, a.number), h('span', {}, a.requester || ''), h('span', { class: 'nowrap' }, formatRelative(a.requested_at))),
              h('div', { class: 'ellipsis' }, a.title)
            ),
            h('span', { class: 'badge warn' }, 'À approuver')
          )
        )
      )
    );
  }
};

/** Widgets graphiques : ils proposent la bascule graphique / tableau. */
export const CHART_WIDGETS = new Set(['incidents_daily', 'incidents_by_category', 'mttr_by_group']);
