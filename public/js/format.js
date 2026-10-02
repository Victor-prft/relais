/** Formats d'affichage (fr-FR). Les dates arrivent en ISO UTC. */

const TZ = 'Europe/Paris';
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: TZ });
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const relFmt = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });

export const formatDateTime = (iso) => (iso ? dateTimeFmt.format(new Date(iso)) : '—');
export const formatDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '—');
export const formatTime = (iso) => (iso ? timeFmt.format(new Date(iso)) : '—');

export function formatRelative(iso, now = Date.now()) {
  if (!iso) return '—';
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return relFmt.format(Math.round(diff), 'second');
  if (abs < 3600) return relFmt.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return relFmt.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return relFmt.format(Math.round(diff / 86400), 'day');
  return formatDate(iso);
}

/**
 * Durée en minutes → « 2 h 15 », « 3 j 4 h ». `days: false` garde les heures
 * (temps ouvré : 50 h ouvrées ne font pas « 2 j 2 h »).
 */
export function formatMinutes(minutes, { days: useDays = true } = {}) {
  if (minutes === null || minutes === undefined) return '—';
  const m = Math.round(Math.abs(minutes));
  const sign = minutes < 0 ? '−' : '';
  if (m < 60) return `${sign}${m} min`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  if (hours < 24 || !useDays) return `${sign}${hours} h${rest ? ` ${String(rest).padStart(2, '0')}` : ''}`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return `${sign}${days} j${h ? ` ${h} h` : ''}`;
}

/** Valeur ISO → valeur d'un <input type="datetime-local"> (heure de Paris). */
export function toLocalInput(iso) {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date(iso));
  return parts.replace(' ', 'T');
}

/** Valeur d'un <input type="datetime-local"> (heure du navigateur) → ISO. */
export function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : null;
}

export const PRIORITY_LABELS = { 1: 'P1 Critique', 2: 'P2 Haute', 3: 'P3 Moyenne', 4: 'P4 Basse', 5: 'P5 Planifiée' };
export const LEVEL_LABELS = { 1: '1 — Haute', 2: '2 — Moyenne', 3: '3 — Basse' };
