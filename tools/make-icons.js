'use strict';

/**
 * Génère les icônes de la PWA sans dépendance : rendu par fonctions de
 * distance, suréchantillonné 4×4, encodé en PNG avec zlib.
 * Motif : deux nœuds reliés — un « relais » entre l'utilisateur et le support.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');

const BG_TOP = [13, 122, 104];
const BG_BOTTOM = [20, 25, 32];
const WHITE = [255, 255, 255];
const AMBER = [224, 155, 45];

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // profondeur
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function roundedBox(x, y, half, radius) {
  const qx = Math.abs(x - 0.5) - half + radius;
  const qy = Math.abs(y - 0.5) - half + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function segment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Couleur d'un point (coordonnées 0..1) ; `scale` < 1 laisse une marge (maskable). */
function shade(x, y, { maskable }) {
  const inBg = maskable ? true : roundedBox(x, y, 0.5, 0.22) <= 0;
  if (!inBg) return null;
  let color = mix(BG_TOP, BG_BOTTOM, Math.min(1, Math.max(0, (x * 0.4 + y * 0.8) / 1.1)));

  const s = maskable ? 0.72 : 1;
  const u = (x - 0.5) / s + 0.5;
  const v = (y - 0.5) / s + 0.5;

  const a = [0.3, 0.7];
  const b = [0.7, 0.3];
  // Arc de relais : deux segments qui passent par un coude.
  const elbow = [0.3, 0.3];
  const line = Math.min(segment(u, v, a[0], a[1], elbow[0], elbow[1]), segment(u, v, elbow[0], elbow[1], b[0], b[1]));
  if (line < 0.045) color = WHITE;
  if (Math.hypot(u - a[0], v - a[1]) < 0.11) color = WHITE;
  if (Math.hypot(u - b[0], v - b[1]) < 0.11) color = AMBER;
  if (Math.hypot(u - 0.66, v - 0.7) < 0.06) color = mix(WHITE, BG_TOP, 0.35);
  return color;
}

function render(size, opts = {}) {
  const SS = 4;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let alpha = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const c = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, opts);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          alpha += 1;
        }
      }
      const i = (py * size + px) * 4;
      if (alpha) {
        rgba[i] = Math.round(r / alpha);
        rgba[i + 1] = Math.round(g / alpha);
        rgba[i + 2] = Math.round(b / alpha);
      }
      rgba[i + 3] = Math.round((alpha / (SS * SS)) * 255);
    }
  }
  return encodePng(size, rgba);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
    <stop offset="0" stop-color="#0d7a68"/><stop offset="1" stop-color="#141920"/></linearGradient></defs>
  <rect width="100" height="100" rx="22" fill="url(#g)"/>
  <path d="M30 70 V30 H70" fill="none" stroke="#fff" stroke-width="9" stroke-linejoin="round"/>
  <circle cx="30" cy="70" r="11" fill="#fff"/><circle cx="70" cy="30" r="11" fill="#e09b2d"/>
  <circle cx="66" cy="70" r="6" fill="#a8d3cb"/>
</svg>
`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon-192.png'), render(192));
fs.writeFileSync(path.join(OUT, 'icon-512.png'), render(512));
fs.writeFileSync(path.join(OUT, 'icon-maskable-512.png'), render(512, { maskable: true }));
fs.writeFileSync(path.join(OUT, 'favicon.svg'), SVG);
console.log('icônes générées dans public/icons/');
