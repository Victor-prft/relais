import { h, mount, loading } from './dom.js';
import { api } from '../api.js';
import { formatDateTime, formatMinutes, formatRelative } from '../format.js';

const RISK = 0.75;
const STATUS = {
  on_track: { label: 'Dans les temps', tone: 'ok' },
  at_risk: { label: 'À risque', tone: 'warn' },
  breached: { label: 'Dépassé', tone: 'danger' },
  achieved: { label: 'Respecté', tone: 'ok' },
  canceled: { label: 'Remplacé', tone: '' }
};
const TARGETS = { response: 'Prise en charge', resolution: 'Résolution' };
const hours = (m) => formatMinutes(m, { days: false });

function bar(percent, cls) {
  return h('div', { class: `sla ${cls}` }, h('div', { class: 'bar' }, h('span', { style: { width: `${Math.min(100, Math.round(percent * 100))}%` } })));
}

/** Cellule de liste : avancement du SLA actif le plus entamé. */
export function slaCell(row) {
  if (row.sla === null || row.sla === undefined) return h('span', { class: 'faint' }, '—');
  const p = row.sla;
  const paused = row.sla_paused > 0 && p < 1;
  const cls = paused ? 'paused' : p >= 1 ? 'breached' : p >= RISK ? 'at-risk' : '';
  return h('div', { style: { minWidth: '90px' }, title: paused ? 'En pause' : row.sla_due ? `Échéance ${formatDateTime(row.sla_due)}` : '' },
    bar(p, cls),
    h('span', { class: `small ${p >= 1 ? '' : 'muted'}`, style: p >= 1 ? { color: 'var(--danger)', fontWeight: 600 } : null },
      p >= 1 ? 'Dépassé' : paused ? `${Math.round(p * 100)} % · pause` : `${Math.round(p * 100)} %`)
  );
}

/** Carte d'un SLA (onglet SLA, portail). */
export function slaCard(s) {
  const st = STATUS[s.status];
  const cls = s.paused ? 'paused' : s.status === 'breached' ? 'breached' : s.status === 'at_risk' ? 'at-risk' : '';
  return h('div', { class: 'card card-body stack', style: { opacity: s.status === 'canceled' ? 0.6 : 1 } },
    h('div', { class: 'row' },
      h('strong', { class: 'grow' }, `${TARGETS[s.target]} · ${s.name}`),
      s.paused ? h('span', { class: 'badge' }, 'En pause') : null,
      h('span', { class: `badge dot ${st.tone}` }, st.label)
    ),
    bar(s.percent_now, cls),
    h('div', { class: 'row small muted', style: { justifyContent: 'space-between' } },
      h('span', {}, `${Math.round(s.percent_now * 100)} % · ${hours(s.elapsed_minutes_now)} sur ${hours(s.duration_minutes)} ${s.calendar_id === 2 ? '(24 h/24)' : 'ouvrées'}`),
      s.stage === 'running'
        ? h('span', {}, s.remaining_minutes > 0 ? `Échéance ${formatDateTime(s.due_at)} (${formatRelative(s.due_at)})` : `Dépassé de ${hours(-s.remaining_minutes)}`)
        : s.stage === 'completed'
          ? h('span', {}, `Atteint le ${formatDateTime(s.stopped_at)}`)
          : s.stage === 'paused'
            ? h('span', {}, `Reste ${hours(s.remaining_minutes)}`)
            : null
    )
  );
}

export function slaPanel(ticketId) {
  const el = h('div', { class: 'stack' }, loading());
  api.get(`/api/tickets/${ticketId}/slas`).then(({ items }) => {
    const active = items.filter((s) => s.stage !== 'canceled');
    const replaced = items.filter((s) => s.stage === 'canceled');
    mount(el,
      active.length ? active.map(slaCard) : h('p', { class: 'muted' }, 'Aucun SLA sur ce ticket.'),
      replaced.length
        ? h('details', {}, h('summary', { class: 'small muted' }, `${replaced.length} SLA remplacé(s) (changement de priorité ou annulation)`), h('div', { class: 'stack', style: { marginTop: '8px' } }, replaced.map(slaCard)))
        : null,
      h('p', { class: 'small faint' }, 'Le temps ne court pas pendant « En attente ». La prise en charge s’arrête au passage En cours, la résolution à Résolu.')
    );
  }).catch((err) => mount(el, h('p', {}, err.message)));
  return el;
}
