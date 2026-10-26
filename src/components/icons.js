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
export const SHIELD = ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'];
export const GITHUB = ['M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22'];
export const LINKEDIN = ['M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6z', 'M2 9h4v12H2z', 'M4 2a2 2 0 100 4 2 2 0 000-4z'];
export const MAIL = ['M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z', 'M22 6l-10 7L2 6'];
export const FILTER = ['M3 4h18l-7 8.5V19l-4 2v-8.5z'];
export const SEARCH = ['M21 21l-4.3-4.3', 'M11 18a7 7 0 100-14 7 7 0 000 14z'];
export const INFO = ['M12 22a10 10 0 100-20 10 10 0 000 20z', 'M12 16v-4', 'M12 8h.01'];
export const UNDO = ['M3 7v6h6', 'M3 13a9 9 0 103-7.7L3 8'];
export const DOWNLOAD = ['M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'];
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

export const PRINT = ['M6 9V2h12v7', 'M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2', 'M6 14h12v8H6z'];
export const TRASH = ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'];
export const LIST = ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'];
export const BELL = ['M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 01-3.4 0'];
