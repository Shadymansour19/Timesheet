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
// Up/down chevrons: the usual "switcher" affordance (account, workspace pickers).
export const CHEVRON_UPDOWN = ['M7 15l5 5 5-5', 'M7 9l5-5 5 5'];
export const PLUS = ['M12 5v14', 'M5 12h14'];
export const KEY = ['M21 2l-2 2', 'M15.5 7.5l3 3L22 7l-3-3', 'M11.4 11.6a5.5 5.5 0 11-7.8 7.8 5.5 5.5 0 017.8-7.8z', 'M11.4 11.6L15.5 7.5'];
export const LOGOUT = ['M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4', 'M16 17l5-5-5-5', 'M21 12H9'];
export const ARROW_LEFT = ['M19 12H5', 'M12 19l-7-7 7-7'];

