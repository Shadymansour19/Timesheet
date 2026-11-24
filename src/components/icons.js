// Small inline SVG icons (drawn paths, so they look identical in every font and text direction).
const SVG = 'http://www.w3.org/2000/svg';

let gradId = 0;   // each icon gets its own gradient id, so several icons can share a page

export function icon(paths, size = 20, stroke = 2, accent = null) {
  const mk = (tag, attrs = {}) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  const s = mk('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' });

  let grad = null;
  if (accent) {
    const id = `icon-fade-${gradId++}`;
    const g = mk('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: 5, y1: 0, x2: 19, y2: 0 });
    g.append(mk('stop', { offset: 0.35, 'stop-color': 'currentColor' }), mk('stop', { offset: 1, 'stop-color': accent }));
    const defs = mk('defs'); defs.append(g); s.append(defs);
    grad = `url(#${id})`;
  }

  for (const item of paths) {
    const obj = typeof item === 'object';
    const p = mk('path', { d: obj ? item.d : item });
    if (obj && item.fill) { p.setAttribute('fill', grad && item.fade ? grad : 'currentColor'); p.setAttribute('stroke', 'none'); }
    else if (obj && item.fade && grad) p.setAttribute('stroke', grad);
    s.append(p);
  }
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

export const BIOMETRIC = [
  // Outer corner brackets
  'M.6 5.6V1.6a1 1 0 011-1h4',
  'M18.4 .6h4a1 1 0 011 1v4',
  'M23.4 18.4v4a1 1 0 01-1 1h-4',
  'M5.6 23.4H1.6a1 1 0 01-1-1v-4',

  // Outer ridge (flows into the face start)
  { d: 'M5.37 17.88V13.08A6 6 0 0115.45 8.76', fade: true },
  
  // Face profile: filled, tapered to a sharp tail
  { d: 'M15.01 9.17C15.07 9.23 15.26 9.41 15.37 9.54C15.48 9.67 15.58 9.81 15.67 9.95C15.77 10.1 15.85 10.25 15.93 10.4C16.01 10.55 16.08 10.71 16.14 10.86C16.21 11.02 16.26 11.19 16.31 11.35C16.36 11.51 16.41 11.68 16.44 11.84C16.48 12.01 16.51 12.18 16.54 12.35C16.57 12.52 16.57 12.69 16.6 12.86C16.64 13.02 16.68 13.19 16.76 13.33C16.85 13.47 17 13.58 17.12 13.7C17.25 13.82 17.38 13.92 17.51 14.04C17.63 14.16 17.85 14.3 17.85 14.41C17.85 14.52 17.62 14.59 17.51 14.7C17.39 14.82 17.24 14.94 17.17 15.08C17.09 15.23 17.06 15.42 17.07 15.58C17.08 15.74 17.2 15.9 17.24 16.06C17.28 16.22 17.33 16.4 17.3 16.56C17.27 16.72 17.12 16.85 17.05 17.01C16.99 17.16 16.93 17.33 16.91 17.5C16.88 17.66 16.9 17.84 16.92 18.01C16.93 18.18 17.02 18.37 17.01 18.51C16.99 18.66 16.94 18.78 16.84 18.89C16.74 19 16.56 19.09 16.41 19.16C16.26 19.23 16.09 19.28 15.92 19.32C15.76 19.36 15.59 19.39 15.42 19.41C15.25 19.43 15.08 19.44 14.91 19.44C14.73 19.44 14.56 19.44 14.39 19.43C14.22 19.41 14.05 19.39 13.88 19.36C13.72 19.33 13.55 19.3 13.38 19.25C13.22 19.2 13.06 19.14 12.9 19.07C12.75 19 12.52 18.88 12.45 18.84L12.45 18.84C12.52 18.88 12.72 19.03 12.87 19.11C13.01 19.19 13.17 19.26 13.32 19.33C13.47 19.39 13.63 19.44 13.8 19.49C13.96 19.53 14.12 19.57 14.29 19.6C14.45 19.62 14.62 19.64 14.78 19.66C14.95 19.67 15.12 19.68 15.29 19.68C15.45 19.68 15.62 19.67 15.79 19.65C15.95 19.63 16.12 19.6 16.28 19.56C16.44 19.52 16.61 19.47 16.76 19.39C16.9 19.32 17.06 19.23 17.17 19.12C17.29 19 17.4 18.85 17.44 18.7C17.48 18.55 17.43 18.37 17.42 18.2C17.41 18.03 17.37 17.86 17.39 17.7C17.41 17.54 17.48 17.38 17.55 17.23C17.62 17.08 17.76 16.96 17.82 16.81C17.88 16.65 17.92 16.48 17.92 16.32C17.92 16.15 17.85 15.99 17.83 15.83C17.81 15.67 17.74 15.48 17.8 15.37C17.87 15.25 18.11 15.21 18.23 15.11C18.36 15 18.5 14.88 18.57 14.74C18.63 14.6 18.64 14.41 18.61 14.25C18.58 14.09 18.49 13.94 18.39 13.8C18.3 13.66 18.17 13.55 18.06 13.43C17.94 13.31 17.8 13.16 17.7 13.07C17.61 12.98 17.54 12.99 17.5 12.89C17.47 12.79 17.5 12.62 17.49 12.47C17.48 12.32 17.46 12.14 17.44 11.97C17.42 11.8 17.4 11.64 17.37 11.47C17.34 11.31 17.31 11.14 17.27 10.98C17.22 10.82 17.18 10.66 17.13 10.5C17.08 10.34 17.02 10.18 16.95 10.03C16.89 9.87 16.82 9.72 16.74 9.57C16.67 9.42 16.58 9.28 16.49 9.14C16.4 8.99 16.31 8.86 16.2 8.72C16.1 8.59 15.93 8.4 15.88 8.34Z', fill: true, fade: true},
  
  // Top ridge
  { d: 'M7.53 5.4A7.2 7.2 0 0113.89 4.8', fade: true },
  
  // Inner loop
  { d: 'M8.49 19.08V13.68A3.12 3.12 0 0114.73 13.68V15.36', fade: true },
  
  // Core
  { d: 'M11.61 16.32V13.68', fade: true },
];

export const LOGOUT = ['M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4', 'M16 17l5-5-5-5', 'M21 12H9'];
export const ARROW_LEFT = ['M19 12H5', 'M12 19l-7-7 7-7'];
export const SHIELD = ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'];
export const GITHUB = ['M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22'];
export const LINKEDIN = ['M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6z', 'M2 9h4v12H2z', 'M4 2a2 2 0 100 4 2 2 0 000-4z'];
export const MAIL = ['M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z', 'M22 6l-10 7L2 6'];
export const WHATSAPP = ['M7.9 20A9 9 0 1 0 4 16.1L2 22z', 'M8.3 7.8c0 4.1 3.6 7.7 7.7 7.7l1.1-1.75-2.4-1.25-1 .9a5 5 0 01-2.4-2.4l.9-1-1.25-2.4z'];
export const FILTER = ['M3 4h18l-7 8.5V19l-4 2v-8.5z'];
export const SEARCH = ['M21 21l-4.3-4.3', 'M11 18a7 7 0 100-14 7 7 0 000 14z'];
export const INFO = ['M12 22a10 10 0 100-20 10 10 0 000 20z', 'M12 16v-4', 'M12 8h.01'];
export const UNDO = ['M3 7v6h6', 'M3 13a9 9 0 103-7.7L3 8'];
export const DOWNLOAD = ['M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'];
export const SAVE = ['M5 3h12l4 4v14H3V3h2z', 'M7 3v6h8V3', 'M7 21v-7h10v7'];
export const REFRESH = ['M21 12a9 9 0 11-3-6.7L21 8', 'M21 3v5h-5'];
export const SUN = ['M12 17a5 5 0 100-10 5 5 0 000 10z', 'M12 1v2', 'M12 21v2', 'M4.2 4.2l1.4 1.4', 'M18.4 18.4l1.4 1.4', 'M1 12h2', 'M21 12h2', 'M4.2 19.8l1.4-1.4', 'M18.4 5.6l1.4-1.4'];
export const MOON = ['M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z'];
export const MONITOR = ['M20 3H4a1 1 0 00-1 1v12a1 1 0 001 1h16a1 1 0 001-1V4a1 1 0 00-1-1z', 'M8 21h8', 'M12 17v4'];
// navigation (phone tab bar)
export const GRID = ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z'];
export const CLOCK = ['M12 22a10 10 0 100-20 10 10 0 000 20z', 'M12 6v6l4 2'];
export const USERS = ['M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2', 'M9 11a4 4 0 100-8 4 4 0 000 8z', 'M23 21v-2a4 4 0 00-3-3.87', 'M16 3.13a4 4 0 010 7.75'];
export const CALENDAR = ['M19 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2z', 'M16 2v4', 'M8 2v4', 'M3 10h18'];
export const BUILDING = ['M3 21h18', 'M5 21V3h10v18', 'M15 9h4v12', 'M9 7h2', 'M9 11h2', 'M9 15h2'];

export const SCAN = ['M3 7V5a2 2 0 012-2h2', 'M17 3h2a2 2 0 012 2v2', 'M21 17v2a2 2 0 01-2 2h-2', 'M7 21H5a2 2 0 01-2-2v-2', 'M7 12h10'];
export const PRINT = ['M6 9V2h12v7', 'M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2', 'M6 14h12v8H6z'];
export const TRASH = ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'];
export const LIST = ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'];
export const BELL = ['M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 01-3.4 0'];
