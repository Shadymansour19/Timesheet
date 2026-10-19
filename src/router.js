import { state } from './auth/session.js';
import { accountView } from './views/account.js';
import { placeholderView } from './views/placeholder.js';

// Each role gets its own set of routes; the first is the landing page.
const routes = {
  user: [{ path: '/calendar', label: 'nav_calendar', view: placeholderView('nav_calendar') }],
  admin: [
    { path: '/team', label: 'nav_team', view: placeholderView('nav_team') },
    { path: '/calendar', label: 'nav_calendar', view: placeholderView('nav_calendar') },
  ],
  super_admin: [{ path: '/departments', label: 'nav_departments', view: placeholderView('nav_departments') }],
};
const common = [{ path: '/account', view: accountView }];

export const navFor = () => routes[state.profile.role] ?? [];

export function resolve() {
  const path = location.hash.replace(/^#/, '') || '/';
  const all = [...navFor(), ...common];
  const match = all.find((r) => r.path === path);
  if (match) return match;
  const home = navFor()[0];
  if (path === '/' && home) { location.replace('#' + home.path); return null; }
  return { path, view: placeholderView('not_found') };
}
