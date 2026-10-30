// Desktop notifications for department admins ("somebody filled his timesheet"), for the INSTALLED app on a desktop screen.
// Source: the live department channel (src/live.js). The announcement says who changed what ("a" = the actor) and which person ("u"),
// so only a person's OWN activity counts (not an admin's edit, not my own). Every person has their OWN quiet timer: the notification
// comes only after that person has been quiet for QUIET_MS (each new change restarts it), so a burst of clicks is ONE notification;
// a person who keeps working still gets one every MAX_WAIT_MS. Nothing is sent while the app window is focused (the grid updates live).
// Works while the app window is open (also minimised / in the background); a notification while the app is fully closed would
// need Web Push (server side keys) - not part of this.
import * as live from './live.js';
import { state, myDept } from './auth/session.js';
import { fetchTimesheetPeople } from './api/admin.js';
import { t, personName } from './i18n/index.js';

const KEY = 'ts.notify';
const QUIET_MS = 60_000, MAX_WAIT_MS = 600_000;
const quiet = () => { try { const v = Number(localStorage.getItem('ts.notifyDelayMs')); return v > 0 ? v : QUIET_MS; } catch { return QUIET_MS; } };   // ts.notifyDelayMs: override (tests)

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const desktop = () => matchMedia('(pointer: fine)').matches && matchMedia('(min-width: 901px)').matches;
export const supported = () => typeof Notification !== 'undefined';
export const eligible = () => supported() && ['admin', 'manager'].includes(state.profile?.role) && desktop() && standalone();
export const enabled = () => { try { return supported() && Notification.permission === 'granted' && localStorage.getItem(KEY) === 'on'; } catch { return false; } };

// switching on asks the browser for permission (must run from a click); returns 'on' | 'off' | 'denied'
export async function setEnabled(on) {
  try {
    if (!on) { localStorage.setItem(KEY, 'off'); return 'off'; }
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') { localStorage.setItem(KEY, 'off'); return 'denied'; }
    localStorage.setItem(KEY, 'on'); return 'on';
  } catch { return 'off'; }
}

const pending = new Map();                      // person id -> { timer, first, n }   (one timer per person, never shared)
const names = new Map();
async function nameOf(uid) {
  if (!names.has(uid)) { try { (await fetchTimesheetPeople(myDept())).forEach((p) => names.set(p.id, personName(p))); } catch { /* ignore */ } }
  return names.get(uid) ?? '';
}
async function fire(uid) {
  const entry = pending.get(uid); pending.delete(uid);
  if (!entry || !enabled()) return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;           // the admin is looking at the app: the grid already shows it
  const name = await nameOf(uid);
  const n = new Notification(t('notify_title').replace('{name}', name || '?'), {
    body: t('notify_body').replace('{n}', entry.n), tag: 'ts-' + uid, icon: '/icons/icon-192.png', lang: document.documentElement.lang,
  });
  n.onclick = () => { try { window.focus(); location.hash = '#/person/' + uid; n.close(); } catch { /* ignore */ } };
}

function onChange(p) {
  const me = state.profile?.id;
  if (p.t !== 'day_status' || !Array.isArray(p.u) || p.u.length !== 1 || !p.a || p.u[0] !== p.a || p.a === me || !enabled()) return;   // only somebody's OWN edits
  const uid = p.u[0], now = Date.now(), e = pending.get(uid) ?? { timer: null, first: now, n: 0 };
  clearTimeout(e.timer);
  e.n += 1;
  e.timer = setTimeout(() => fire(uid), Math.max(0, Math.min(quiet(), e.first + MAX_WAIT_MS - now)));
  pending.set(uid, e);
}

let startedFor = null;
export function startNotifications() {
  if (!eligible() || startedFor === state.profile.id) return;
  startedFor = state.profile.id;
  live.watchGlobal([`dept:${myDept()}`], onChange);
}
export function stopNotifications() { startedFor = null; for (const e of pending.values()) clearTimeout(e.timer); pending.clear(); }
