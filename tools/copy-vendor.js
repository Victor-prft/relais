'use strict';

/**
 * Copie les librairies front depuis node_modules vers public/vendor/.
 *
 * Pourquoi pas un CDN : la CSP n'autorise que 'self', et la PWA doit pouvoir
 * charger son shell hors ligne. Le dossier vendor/ n'est pas commité, il est
 * reconstruit à chaque `npm install` (postinstall).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEST = path.join(ROOT, 'public', 'vendor');

const FILES = [
  ['gridstack/dist/gridstack-all.js', 'gridstack.js'],
  ['gridstack/dist/gridstack.min.css', 'gridstack.css'],
  ['chart.js/dist/chart.umd.min.js', 'chart.js'],
  ['cytoscape/dist/cytoscape.min.js', 'cytoscape.js'],
  ['marked/lib/marked.umd.js', 'marked.js'],
  ['dompurify/dist/purify.min.js', 'purify.js']
];

fs.mkdirSync(DEST, { recursive: true });

let missing = 0;
for (const [from, to] of FILES) {
  const source = path.join(ROOT, 'node_modules', from);
  if (!fs.existsSync(source)) {
    console.warn(`vendor : introuvable ${from}`);
    missing += 1;
    continue;
  }
  fs.copyFileSync(source, path.join(DEST, to));
}

console.log(`vendor : ${FILES.length - missing}/${FILES.length} fichiers copiés dans public/vendor/`);
