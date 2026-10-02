import { h } from './dom.js';

/**
 * Graphiques Chart.js (script global `Chart`). Règles :
 * - couleurs lues dans les jetons CSS → elles suivent le thème ;
 * - traits fins (2 px), barres ≤ 24 px aux extrémités arrondies, quadrillage
 *   fin et plein, un seul axe des valeurs ;
 * - info-bulle au survol, étiquettes directes sélectives (fin de courbe,
 *   bout de barre) pour ne jamais dépendre de la couleur seule ;
 * - toujours une vue tableau à côté (cf. dataTable).
 */

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function theme() {
  return {
    s1: css('--series-1'),
    s2: css('--series-2'),
    grid: css('--chart-grid'),
    text: css('--text'),
    muted: css('--text-muted'),
    surface: css('--surface'),
    font: css('--font-sans') || 'system-ui'
  };
}

/** Étiquette du nom de série au bout de chaque courbe. */
const endLabels = {
  id: 'endLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const t = theme();
    ctx.save();
    ctx.font = `600 11px ${t.font}`;
    ctx.textBaseline = 'middle';
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      if (meta.hidden || !meta.data.length) return;
      const last = meta.data[meta.data.length - 1];
      ctx.fillStyle = t.text;
      ctx.fillText(ds.label, last.x + 6, last.y);
    });
    ctx.restore();
  }
};

/** Valeur écrite au bout de chaque barre horizontale. */
const barValues = {
  id: 'barValues',
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx } = chart;
    const t = theme();
    ctx.save();
    ctx.font = `600 11px ${t.font}`;
    ctx.fillStyle = t.text;
    ctx.textBaseline = 'middle';
    const meta = chart.getDatasetMeta(0);
    meta.data.forEach((bar, i) => {
      const value = chart.data.datasets[0].data[i];
      ctx.fillText(opts?.format ? opts.format(value) : String(value), bar.x + 6, bar.y);
    });
    ctx.restore();
  }
};

function baseOptions(t) {
  window.Chart.defaults.font.family = t.font;
  window.Chart.defaults.color = t.muted;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    font: { family: t.font },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: t.text,
        titleColor: t.surface,
        bodyColor: t.surface,
        padding: 10,
        cornerRadius: 8,
        displayColors: true,
        boxPadding: 4
      }
    }
  };
}

/** Courbe(s) dans le temps, axe Y partagé (une seule échelle). */
export function lineChart(canvas, { labels, series }) {
  const t = theme();
  const colors = [t.s1, t.s2];
  return new window.Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: series.map((s, i) => ({
        label: s.label,
        data: s.data,
        borderColor: colors[i],
        backgroundColor: colors[i],
        borderWidth: 2,
        // Monotone : la courbe ne dépasse jamais ses points (pas de pics inventés).
        cubicInterpolationMode: 'monotone',
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBorderWidth: 2,
        pointHoverBorderColor: t.surface
      }))
    },
    plugins: [endLabels],
    options: {
      ...baseOptions(t),
      layout: { padding: { right: 64, top: 8 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        ...baseOptions(t).plugins,
        legend: { display: series.length > 1, position: 'top', align: 'start', labels: { color: t.muted, usePointStyle: true, pointStyle: 'line', boxWidth: 18 } }
      },
      scales: {
        x: { grid: { display: false }, border: { color: t.grid }, ticks: { color: t.muted, maxTicksLimit: 8, maxRotation: 0 } },
        y: { beginAtZero: true, grid: { color: t.grid, lineWidth: 1 }, border: { display: false }, ticks: { color: t.muted, precision: 0 } }
      }
    }
  });
}

/** Barres horizontales, une seule série (une couleur, pas de rampe sur des catégories). */
export function barChart(canvas, { labels, values, label, format = (v) => String(v) }) {
  const t = theme();
  return new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label, data: values, backgroundColor: t.s1, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24, categoryPercentage: 0.7 }]
    },
    plugins: [barValues],
    options: {
      ...baseOptions(t),
      indexAxis: 'y',
      layout: { padding: { right: 48 } },
      plugins: {
        ...baseOptions(t).plugins,
        barValues: { format },
        tooltip: { ...baseOptions(t).plugins.tooltip, callbacks: { label: (c) => ` ${label} : ${format(c.raw)}` } }
      },
      scales: {
        x: { beginAtZero: true, grid: { color: t.grid }, border: { display: false }, ticks: { color: t.muted, precision: 0 } },
        y: { grid: { display: false }, border: { color: t.grid }, ticks: { color: t.text } }
      }
    }
  });
}

/** Vue tableau des mêmes données (accessibilité, lecture exacte). */
export function dataTable(columns, rows) {
  return h('div', { class: 'table-wrap', style: { maxHeight: '100%', overflow: 'auto' } },
    h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.numeric ? 'right' : '' }, c.label)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, columns.map((c, i) => h('td', { class: c.numeric ? 'right' : '' }, r[i])))))
    )
  );
}

export const chartsAvailable = () => typeof window.Chart === 'function';
