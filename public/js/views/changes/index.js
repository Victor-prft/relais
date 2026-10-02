import { h, mount, loading } from '../../ui/dom.js';
import { icons } from '../../ui/icons.js';
import { api } from '../../api.js';
import { popover } from '../../ui/feedback.js';
import { listView } from '../../ui/list-view.js';
import { stateBadge } from '../../ui/badges.js';
import { formatDateTime, formatTime } from '../../format.js';
import { navigate } from '../../router.js';
import { getGroups } from '../../state.js';
import { getChangeMeta, RISK_TONES } from './form.js';

const TZ = 'Europe/Paris';
const dayKey = (date) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

function newMenu(anchor, meta) {
  popover(anchor, (pop, close) => {
    pop.classList.add('menu');
    pop.append(
      h('a', { href: '#/changes/new', onclick: close }, icons.change({ size: 16 }), 'Changement normal'),
      h('a', { href: '#/changes/new?type=emergency', onclick: close }, icons.alert({ size: 16 }), 'Changement urgent'),
      h('div', { class: 'nav-section', style: { color: 'var(--text-faint)', padding: '8px 10px 2px' } }, 'Standard (pré-autorisé)'),
      meta.templates.map((tpl) => h('a', { href: `#/changes/new?template=${tpl.id}`, onclick: close }, icons.task({ size: 16 }), tpl.name))
    );
  });
}

export async function changeListView(el) {
  const [meta, groups] = await Promise.all([getChangeMeta(), getGroups()]);
  const active = { field: 'active', op: 'eq', value: true, label: 'oui' };
  const newButton = h('button', { class: 'btn primary', type: 'button' }, icons.plus(), 'Nouveau changement');
  newButton.addEventListener('click', () => newMenu(newButton, meta));
  mount(el,
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Changements'), h('div', { class: 'sub' }, 'Modifications planifiées de l’infrastructure et des applications')),
      h('div', { class: 'actions btn-group' }, h('a', { class: 'btn', href: '#/changes/calendar' }, icons.calendar({ size: 16 }), 'Calendrier'), newButton)
    ),
    listView({
      key: 'changes',
      endpoint: '/api/changes',
      columns: [
        { key: 'number', label: 'Numéro', render: (r) => h('span', { class: 'number' }, r.number) },
        { key: 'title', label: 'Titre', className: 'title-cell' },
        { key: 'state', label: 'État', render: (r) => stateBadge(r.state, meta.states[r.state]) },
        { key: 'change_type', label: 'Type', render: (r) => meta.types[r.change_type] },
        { key: 'risk', label: 'Risque', render: (r) => h('span', { class: `badge dot ${RISK_TONES[r.risk]}` }, meta.risks[r.risk]) },
        { key: 'planned_start', label: 'Début prévu', defaultDir: 'desc', render: (r) => formatDateTime(r.planned_start) },
        { key: 'planned_end', label: 'Fin prévue', render: (r) => formatDateTime(r.planned_end) },
        { key: 'cis', label: 'CI', sortable: false, className: 'title-cell' },
        { key: 'assigned_to', label: 'Responsable' },
        { key: 'assignment_group', label: 'Groupe' },
        { key: 'close_code', label: 'Résultat', render: (r) => meta.close_codes[r.close_code] || '—' }
      ],
      defaultColumns: ['number', 'title', 'state', 'change_type', 'risk', 'planned_start', 'cis'],
      filterFields: [
        { key: 'state', label: 'État', type: 'enum', options: Object.entries(meta.states).map(([value, label]) => ({ value, label })) },
        { key: 'change_type', label: 'Type', type: 'enum', options: Object.entries(meta.types).map(([value, label]) => ({ value, label })) },
        { key: 'risk', label: 'Risque', type: 'enum', options: Object.entries(meta.risks).map(([value, label]) => ({ value, label })) },
        { key: 'assignment_group_id', label: 'Groupe', type: 'group', options: groups.map((g) => ({ value: g.id, label: g.name })) },
        { key: 'planned_start', label: 'Début prévu', type: 'date' },
        { key: 'active', label: 'En cours', type: 'bool' }
      ],
      presets: [
        { id: 'active', label: 'Changements en cours', filters: [active], sort: 'planned_start', dir: 'asc' },
        { id: 'cab', label: 'En évaluation CAB', filters: [{ field: 'state', op: 'in', value: ['assess'], label: 'Évaluation CAB' }] },
        { id: 'upcoming', label: 'À venir (7 jours)', filters: [{ field: 'planned_start', op: 'gte', value: '@days:0', label: 'aujourd’hui' }, { field: 'planned_start', op: 'lte', value: '@days:7', label: 'd’ici 7 jours' }], sort: 'planned_start', dir: 'asc' },
        { id: 'all', label: 'Tous les changements', filters: [] }
      ],
      onOpen: (row) => navigate(`/changes/${row.id}`)
    })
  );
}

/** Calendrier mensuel : chaque changement s'affiche sur les jours que couvre sa fenêtre. */
export async function changeCalendarView(el, _params, query) {
  const meta = await getChangeMeta();
  const today = new Date();
  const [year, month] = (query.m || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`).split('-').map(Number);
  const showDrafts = query.drafts === '1';
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  // Grille du lundi précédant le 1er au dimanche suivant la fin du mois.
  const startOffset = (first.getUTCDay() + 6) % 7;
  const gridStart = new Date(first.getTime() - startOffset * 86400000);
  const days = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getTime() + i * 86400000));
  const from = new Date(gridStart.getTime() - 86400000).toISOString();
  const to = new Date(days[41].getTime() + 86400000).toISOString();
  const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(first);
  const shift = (n) => {
    const d = new Date(Date.UTC(year, month - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const link = (m, drafts = showDrafts) => `#/changes/calendar?m=${m}${drafts ? '&drafts=1' : ''}`;

  const gridHost = h('div', {}, loading());
  mount(el,
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Calendrier des changements'), h('div', { class: 'sub' }, 'Fenêtres planifiées et conflits sur un même élément de configuration')),
      h('div', { class: 'actions btn-group' },
        h('label', { class: 'checkbox small' }, h('input', { type: 'checkbox', checked: showDrafts, onchange: (e) => navigate(link(`${year}-${String(month).padStart(2, '0')}`, e.target.checked).slice(1)) }), 'Inclure les brouillons'),
        h('a', { class: 'btn', href: '#/changes' }, 'Liste')
      )
    ),
    h('div', { class: 'row', style: { marginBottom: '12px' } },
      h('a', { class: 'btn icon', href: link(shift(-1)), 'aria-label': 'Mois précédent' }, icons.chevronLeft()),
      h('h2', { style: { margin: 0, minWidth: '180px', textAlign: 'center', textTransform: 'capitalize' } }, monthLabel),
      h('a', { class: 'btn icon', href: link(shift(1)), 'aria-label': 'Mois suivant' }, icons.chevronRight()),
      h('a', { class: 'btn small', href: link(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`) }, 'Aujourd’hui'),
      h('div', { class: 'grow' }),
      h('span', { class: 'row small muted', style: { gap: '10px' } },
        Object.entries(meta.risks).map(([k, label]) => h('span', { class: `cal-legend risk-${k}` }, `Risque ${label.toLowerCase()}`)),
        h('span', { class: 'cal-legend conflict' }, 'Conflit')
      )
    ),
    gridHost
  );

  const { items } = await api.get('/api/changes/calendar', { from, to, drafts: showDrafts ? '1' : '0' });
  const byDay = new Map(days.map((d) => [dayKey(d), []]));
  for (const c of items) {
    const s = new Date(c.planned_start);
    const e = new Date(new Date(c.planned_end).getTime() - 1);
    for (let d = new Date(s); dayKey(d) <= dayKey(e); d = new Date(d.getTime() + 86400000)) {
      byDay.get(dayKey(d))?.push(c);
      if (byDay.size && d > new Date(to)) break;
    }
  }

  const todayKey = dayKey(today);
  mount(gridHost,
    h('div', { class: 'calendar card' },
      ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map((d) => h('div', { class: 'cal-head' }, d)),
      days.map((d) => {
        const key = dayKey(d);
        const inMonth = d.getUTCMonth() === month - 1;
        const list = byDay.get(key) || [];
        return h('div', { class: `cal-day ${inMonth ? '' : 'other'} ${key === todayKey ? 'today' : ''}` },
          h('div', { class: 'cal-date' }, String(Number(key.slice(8, 10)))),
          list.slice(0, 4).map((c) => {
            const chip = h('button', {
              type: 'button',
              class: `cal-chip risk-${c.risk} ${c.conflicts.some((x) => x.level === 'conflict') ? 'conflict' : ''} state-${c.state}`,
              title: `${c.number} · ${c.title}`
            }, h('span', { class: 'time' }, key === dayKey(new Date(c.planned_start)) ? formatTime(c.planned_start) : '…'), ' ', c.title);
            chip.addEventListener('click', () =>
              popover(chip, (pop) => {
                pop.style.width = '300px';
                pop.append(
                  h('div', { class: 'stack' },
                    h('div', { class: 'row small' }, h('a', { class: 'number', href: `#/changes/${c.id}` }, c.number), stateBadge(c.state, meta.states[c.state])),
                    h('strong', {}, c.title),
                    h('div', { class: 'small muted' }, `${formatDateTime(c.planned_start)} → ${formatDateTime(c.planned_end)}`),
                    h('div', { class: 'small' }, `${meta.types[c.change_type]} · risque ${meta.risks[c.risk].toLowerCase()}`),
                    c.cis ? h('div', { class: 'small muted' }, c.cis) : null,
                    c.conflicts.length
                      ? h('div', { class: 'callout danger small' }, c.conflicts.map((x) => h('div', {}, `${x.level === 'conflict' ? 'Conflit' : 'Dépendance'} avec `, h('a', { href: `#/changes/${x.id}` }, x.number), ` (${x.cis.join(', ')})`)))
                      : null,
                    h('a', { class: 'btn small primary', href: `#/changes/${c.id}` }, 'Ouvrir')
                  )
                );
              })
            );
            return chip;
          }),
          list.length > 4 ? h('div', { class: 'small faint' }, `+ ${list.length - 4} autre(s)`) : null
        );
      })
    ),
    items.length ? null : h('p', { class: 'muted', style: { marginTop: '12px' } }, 'Aucun changement planifié sur ce mois.')
  );
}
