import { state } from './auth/session.js';
import { accountView } from './views/account.js';
import { placeholderView } from './views/placeholder.js';
import { calendarView } from './views/calendar.js';
import { teamView } from './views/team.js';
import { overtimeView } from './views/overtime.js';
import { usersView } from './views/users.js';
import { departmentsView } from './views/departments.js';

// Each role gets its own set of routes; the first is the landing page.
const routes = {
  user: [{ path: '/calendar', label: 'nav_calendar', view: calendarView }],
  admin: [
    { path: '/team', label: 'nav_team', view: teamView },
    { path: '/overtime', label: 'nav_overtime', view: overtimeView },
    { path: '/users', label: 'nav_users', view: usersView },
    { path: '/calendar', label: 'nav_calendar', view: calendarView },
  ],
  super_admin: [{ path: '/departments', label: 'nav_departments', view: departmentsView }],
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
