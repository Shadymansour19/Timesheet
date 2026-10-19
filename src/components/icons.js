// Small inline SVG icons (drawn paths, so they look identical in every font and text direction).
const SVG = 'http://www.w3.org/2000/svg';

export function icon(paths, size = 20) {
  const s = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) s.setAttribute(k, v);
  for (const d of paths) { const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}

export const EYE = ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 15a3 3 0 100-6 3 3 0 000 6z'];
export const EYE_OFF = ['M3 3l18 18', 'M10.6 5.1A10.7 10.7 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.2', 'M6.6 6.6A17 17 0 002 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1', 'M9.9 9.9a3 3 0 004.2 4.2'];
export const CHEVRON_LEFT = ['M15 6l-6 6 6 6'];
export const CHEVRON_RIGHT = ['M9 6l6 6-6 6'];
