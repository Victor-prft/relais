import { h, mount, loading } from '../../ui/dom.js';
import { icons } from '../../ui/icons.js';
import { api } from '../../api.js';
import { toast, toastError } from '../../ui/feedback.js';
import { selectInput, field } from '../../ui/fields.js';
import { priorityBadge } from '../../ui/badges.js';
import { formatMinutes } from '../../format.js';

const WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const TYPES = { incident: 'Incident', request: 'Demande' };
const TARGETS = { response: 'Prise en charge', resolution: 'Résolution' };

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const minutesOf = (s) => {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 1440 ? v : null;
};

/** Administration des SLA, calendriers ouvrés et délais. */
export async function adminSlaView(el) {
  mount(el, loading());
  const [{ definitions, calendars }, settings] = await Promise.all([api.get('/api/admin/sla'), api.get('/api/admin/settings')]);
  const calOptions = calendars.map((c) => ({ value: c.id, label: c.name }));

  const defRows = definitions.map((d) => {
    const hours = h('input', { class: 'input', type: 'number', min: '0.25', step: '0.25', value: d.duration_minutes / 60, style: { width: '90px' } });
    const cal = selectInput(calOptions, { value: d.calendar_id });
    const active = h('input', { type: 'checkbox', checked: Boolean(d.is_active) });
    const save = h('button', {
      class: 'btn small',
      type: 'button',
      onclick: async () => {
        try {
          await api.patch(`/api/admin/sla/definitions/${d.id}`, {
            duration_minutes: Math.round(Number(hours.value) * 60),
            calendar_id: Number(cal.value),
            is_active: active.checked
          });
          toast(`${d.name} enregistré`);
        } catch (err) {
          toastError(err);
        }
      }
    }, 'Enregistrer');
    return h('tr', {},
      h('td', { 'data-label': 'Type' }, TYPES[d.ticket_type]),
      h('td', { 'data-label': 'Priorité' }, priorityBadge(d.priority)),
      h('td', { 'data-label': 'Cible' }, TARGETS[d.target]),
      h('td', { 'data-label': 'Durée (h)' }, h('div', { class: 'row' }, hours, h('span', { class: 'small faint' }, formatMinutes(d.duration_minutes, { days: false })))),
      h('td', { 'data-label': 'Calendrier' }, cal),
      h('td', { 'data-label': 'Actif' }, active),
      h('td', { 'data-label': 'En cours' }, String(d.active_count)),
      h('td', {}, save)
    );
  });

  const calendarCards = calendars.map((c) => {
    const name = h('input', { class: 'input', value: c.name });
    const tz = h('input', { class: 'input', value: c.timezone });
    const dayInputs = WEEKDAYS.map((label, weekday) => {
      const ranges = c.hours.filter((x) => x.weekday === weekday).map((x) => `${hhmm(x.start_minute)}-${hhmm(x.end_minute)}`).join(', ');
      return { weekday, input: h('input', { class: 'input', value: ranges, placeholder: 'fermé' }), label };
    });
    const holidays = h('textarea', { class: 'input', rows: 6, value: c.holidays.map((x) => `${x.date} ${x.label}`).join('\n') });
    const save = async () => {
      const hours = [];
      for (const { weekday, input, label } of dayInputs) {
        for (const part of input.value.split(',').map((p) => p.trim()).filter(Boolean)) {
          const [a, b] = part.split('-');
          const start = minutesOf(a || '');
          const end = minutesOf(b || '');
          if (start === null || end === null || end <= start) return toastError({ message: `${label} : plage « ${part} » invalide (format 08:00-18:00)` });
          hours.push({ weekday, start_minute: start, end_minute: end });
        }
      }
      const days = [];
      for (const line of holidays.value.split('\n').map((l) => l.trim()).filter(Boolean)) {
        const m = line.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
        if (!m) return toastError({ message: `Jour férié « ${line} » : format AAAA-MM-JJ Libellé` });
        days.push({ date: m[1], label: m[2] });
      }
      try {
        await api.put(`/api/admin/sla/calendars/${c.id}`, { name: name.value.trim(), timezone: tz.value.trim(), hours, holidays: days });
        toast('Calendrier enregistré');
      } catch (err) {
        toastError(err);
      }
    };
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, icons.calendar(), h('h3', { class: 'grow' }, c.name), h('button', { class: 'btn small primary', type: 'button', onclick: save }, 'Enregistrer')),
      h('div', { class: 'card-body grid-2' },
        h('div', { class: 'stack' },
          h('div', { class: 'grid-2' }, field('Nom', name), field('Fuseau horaire', tz)),
          dayInputs.map(({ input, label }) => field(label, input))
        ),
        field('Jours fériés (un par ligne : AAAA-MM-JJ Libellé)', holidays)
      )
    );
  });

  const autoClose = h('input', { class: 'input', type: 'number', min: 1, max: 60, value: settings['incident.auto_close_days'] });
  const reqClose = h('input', { class: 'input', type: 'number', min: 1, max: 60, value: settings['request.auto_close_days'] });
  const risk = h('input', { class: 'input', type: 'number', min: 50, max: 95, value: Math.round(settings['sla.at_risk_threshold'] * 100) });

  mount(el,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'SLA et délais'), h('div', { class: 'sub' }, 'Les changements valent pour les SLA démarrés ensuite ; ceux en cours gardent leur définition.'))),
    h('section', { class: 'card', style: { marginBottom: '16px' } },
      h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Réglages'), h('button', {
        class: 'btn small primary',
        type: 'button',
        onclick: async () => {
          try {
            await api.put('/api/admin/settings', {
              'incident.auto_close_days': Number(autoClose.value),
              'request.auto_close_days': Number(reqClose.value),
              'sla.at_risk_threshold': Number(risk.value) / 100
            });
            toast('Réglages enregistrés');
          } catch (err) {
            toastError(err);
          }
        }
      }, 'Enregistrer')),
      h('div', { class: 'card-body grid-3' },
        field('Clôture auto des incidents résolus (jours)', autoClose),
        field('Clôture auto des demandes traitées (jours)', reqClose),
        field('Seuil « SLA à risque » (%)', risk)
      )
    ),
    h('section', { class: 'card', style: { marginBottom: '16px' } },
      h('div', { class: 'card-head' }, h('h3', {}, 'Définitions de SLA')),
      h('div', { class: 'table-wrap' },
        h('table', { class: 'table responsive' },
          h('thead', {}, h('tr', {}, ['Type', 'Priorité', 'Cible', 'Durée (h)', 'Calendrier', 'Actif', 'En cours', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, defRows)
        )
      )
    ),
    h('div', { class: 'stack' }, calendarCards)
  );
}
