import { h } from './dom.js';
import { navigate } from '../router.js';

/**
 * Graphe des dépendances d'un CI (cytoscape.js, chargé en <script> global).
 * Couleurs lues dans les jetons CSS : le graphe suit le thème clair / sombre.
 */
const CLASS_SHAPES = {
  server: 'round-rectangle',
  application: 'ellipse',
  database: 'barrel',
  workstation: 'round-tag',
  network: 'diamond',
  peripheral: 'round-pentagon'
};
const CLASS_COLORS = {
  server: '#3a76cf',
  application: '#0d7a68',
  database: '#8a5cc7',
  workstation: '#7f8998',
  network: '#dd7535',
  peripheral: '#a08a3a'
};

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function ciGraph({ nodes, edges }, { height = 460 } = {}) {
  const container = h('div', { class: 'ci-graph', style: { height: `${height}px` }, role: 'img', 'aria-label': `Graphe de ${nodes.length} éléments de configuration` });
  if (typeof window.cytoscape !== 'function') {
    container.append(h('div', { class: 'empty' }, 'Bibliothèque de graphe indisponible.'));
    return container;
  }

  const text = css('--text');
  const muted = css('--text-muted');
  const surface = css('--surface');
  const accent = css('--signal');

  requestAnimationFrame(() => {
    const cy = window.cytoscape({
      container,
      // Identifiants préfixés : « #3 » n'est pas un sélecteur valide, « #n3 » l'est.
      elements: [
        ...nodes.map((n) => ({ data: { id: `n${n.id}`, ciId: n.id, depth: n.depth, label: n.name, cls: n.class_code, root: n.root ? 1 : 0, retired: n.status === 'retired' ? 1 : 0 } })),
        ...edges.map((e) => ({ data: { id: `e${e.id}`, source: `n${e.source}`, target: `n${e.target}`, label: e.label, type: e.type } }))
      ],
      wheelSensitivity: 0.25,
      minZoom: 0.3,
      maxZoom: 2.5,
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'font-size': 11,
            'font-family': 'system-ui, sans-serif',
            color: text,
            'text-valign': 'bottom',
            'text-margin-y': 6,
            'text-background-color': surface,
            'text-background-opacity': 0.85,
            'text-background-padding': 2,
            width: 30,
            height: 30,
            'border-width': 2,
            'border-color': surface
          }
        },
        ...Object.entries(CLASS_COLORS).map(([cls, color]) => ({
          selector: `node[cls = "${cls}"]`,
          style: { 'background-color': color, shape: CLASS_SHAPES[cls] }
        })),
        { selector: 'node[root = 1]', style: { width: 44, height: 44, 'border-width': 4, 'border-color': accent, 'font-weight': 700 } },
        { selector: 'node[retired = 1]', style: { opacity: 0.4 } },
        {
          selector: 'edge',
          style: {
            width: 1.6,
            'line-color': muted,
            'target-arrow-color': muted,
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'font-size': 10,
            color: muted,
            'text-rotation': 'autorotate',
            'text-background-color': surface,
            'text-background-opacity': 0.9,
            'text-background-padding': 1
          }
        },
        // Libellé de la relation au survol seulement : à 20 nœuds, tout afficher devient illisible.
        { selector: 'edge.hover', style: { label: 'data(label)', width: 2.6, color: text } },
        { selector: 'edge[type = "connects_to"]', style: { 'line-style': 'dashed', 'target-arrow-shape': 'none' } },
        { selector: 'edge[type = "hosts"]', style: { 'target-arrow-shape': 'square' } }
      ],
      // Anneaux concentriques : le CI au centre, puis un anneau par niveau de distance.
      layout: {
        name: 'concentric',
        concentric: (node) => 10 - Number(node.data('depth')),
        levelWidth: () => 1,
        minNodeSpacing: 46,
        padding: 28,
        animate: false
      }
    });
    cy.on('tap', 'node', (evt) => {
      if (!Number(evt.target.data('root'))) navigate(`/cmdb/${evt.target.data('ciId')}`);
    });
    cy.on('mouseover', 'node', (evt) => {
      container.style.cursor = 'pointer';
      evt.target.connectedEdges().addClass('hover');
    });
    cy.on('mouseout', 'node', (evt) => evt.target.connectedEdges().removeClass('hover'));
    cy.on('mouseover', 'edge', (evt) => evt.target.addClass('hover'));
    cy.on('mouseout', 'edge', (evt) => evt.target.removeClass('hover'));
    cy.on('mouseout', 'node', () => { container.style.cursor = ''; });
  });

  return container;
}

export function graphLegend() {
  const labels = { server: 'Serveur', application: 'Application', database: 'Base de données', network: 'Réseau', workstation: 'Poste', peripheral: 'Périphérique' };
  return h('div', { class: 'row small muted', style: { gap: '14px' } },
    Object.entries(labels).map(([cls, label]) => h('span', { class: 'row', style: { gap: '5px' } }, h('span', { style: { width: '10px', height: '10px', borderRadius: '3px', background: CLASS_COLORS[cls], display: 'inline-block' } }), label)),
    h('span', {}, '— — connexion réseau'),
    h('span', {}, '→ dépendance · ■ hébergement')
  );
}
