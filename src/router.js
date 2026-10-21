import { state } from './auth/session.js';
import { acting } from './acting.js';
import { accountView } from './views/account.js';
import { placeholderView } from './views/placeholder.js';
import { calendarView } from './views/calendar.js';
import { teamView } from './views/team.js';
import { overtimeView } from './views/overtime.js';
import { usersView } from './views/users.js';
import { departmentsView } from './views/departments.js';
import { personView } from './views/person.js';
import { GRID, CLOCK, USERS, CALENDAR, BUILDING } from './components/icons.js';

// Each role gets its own set of routes; the first is the landing page.
const routes = {
  user: [{ path: '/calendar', label: 'nav_calendar', icon: CALENDAR, view: calendarView }],
  admin: [
    { path: '/team', label: 'nav_team', icon: GRID, view: teamView },
    { path: '/overtime', label: 'nav_overtime', icon: CLOCK, view: overtimeView },
    { path: '/users', label: 'nav_users', icon: USERS, view: usersView },
    { path: '/calendar', label: 'nav_calendar', icon: CALENDAR, view: calendarView },
  ],
  // super admin: department management, plus the admin tabs for ANY department (acting as its admin, see acting.js)
  super_admin: [
    { path: '/departments', label: 'nav_departments', icon: BUILDING, view: departmentsView },
    { path: '/team', label: 'nav_team', icon: GRID, view: teamView },
    { path: '/overtime', label: 'nav_overtime', icon: CLOCK, view: overtimeView },
    { path: '/users', label: 'nav_users', icon: USERS, view: usersView },
  ],
};
const common = [{ path: '/account', view: accountView }];

export const navFor = () => routes[state.profile.role] ?? [];

export function resolve() {
  const path = location.hash.replace(/^#/, '') || '/';
  const all = [...navFor(), ...common];
  const match = all.find((r) => r.path === path);
  // the department header is sent on every route except Departments (management) and Account
  acting.active = state.profile?.role === 'super_admin' && !['/departments', '/account'].includes(path);
  if (match) return match;
  // admin only: one employee's timesheet, #/person/<uuid>
  const person = path.match(/^\/person\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (person && ['admin', 'super_admin'].includes(state.profile.role)) return { path, view: () => personView(person[1]) };
  const home = navFor()[0];
  if (path === '/' && home) { location.replace('#' + home.path); return null; }
  return { path, view: placeholderView('not_found') };
}
