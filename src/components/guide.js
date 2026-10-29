// "How to use the app": a guided tour for every role, on phones and desktops (src/components/tour.js draws it). It runs through the TABS of the role one after
// the other ("Next: Overtime" at the end of each screen opens the next tab and carries on); Skip stops it. It starts by itself for a NEW account (younger than
// 30 days) on its landing screen, once; "How to use the app" in the account menu starts it from the screen you are on at any time.
// Browsers driven by automation (navigator.webdriver) never get the automatic start, unless localStorage ts.forceGuide = 1 (the tour's own test).
import { state } from '../auth/session.js';
import { t } from '../i18n/index.js';
import { startTour } from './tour.js';

const NEW_DAYS = 30;                                                   // an account younger than this gets the tour by itself
const routeNow = () => location.hash.replace(/^#/, '') || '/';
const keyOf = (route) => `ts.guideSeen.${state.profile.id}${route === '/calendar' ? '' : '.' + route}`;      // the calendar keeps the first key
const seen = (route) => { try { return localStorage.getItem(keyOf(route)) === '1'; } catch { return false; } };
const markSeen = (route) => { try { localStorage.setItem(keyOf(route), '1'); } catch { /* ignore */ } };
const isNew = () => Date.now() - new Date(state.profile.created_at).getTime() < NEW_DAYS * 86400000;
const autoAllowed = () => { try { return !navigator.webdriver || localStorage.getItem('ts.forceGuide') === '1'; } catch { return !navigator.webdriver; } };

// the landing screen of each role: where the tour starts by itself for a new account
const yOk = () => state.profile?.y_allowed !== false;                                              // a person without Y (shift days) sees texts without it
const touch = () => matchMedia('(hover: none) and (pointer: coarse)').matches;                  // a phone / tablet: no keyboard shortcuts to show
const AUTO = { user: '/calendar', admin: '/team', manager: '/team', super_manager: '/team', super_admin: '/departments' };
// the screens of each role in tab order: a tour runs through them one after the other (the person can skip at any time)
const ORDER = { user: ['/calendar'], admin: ['/team', '/overtime', '/users', '/calendar'], manager: ['/team', '/overtime', '/users'], super_manager: ['/team', '/overtime'], super_admin: ['/departments', '/team', '/overtime', '/users', '/super'] };
const NAV = { '/team': 'nav_team', '/overtime': 'nav_overtime', '/users': 'nav_users', '/calendar': 'nav_calendar', '/departments': 'nav_departments', '/super': 'nav_super' };

// a step: { target | targets, title, text } (see tour.js); every text is an i18n key
const st = (title, text, ...targets) => (targets.length > 1 ? { title, text, targets } : { title, text, target: targets[0] ?? null });
const LANG = st('tour_lang_title', 'tour_lang_text', '.topbar .lang-btn');                  // the language button, next to the menu
const MENU = st('tour_6_title', 'tour_6_text', '.acct');
const TABS = st('tour_tabs_title', 'tour_tabs_text', '.shell > .nav');
const MONTH = st('tour_1_title', 'tour_1_text', '.cal-head');

const PAGES = {
  '/calendar': { ready: '.cal .grid', steps: (last) => [
    st('tour_0_title', 'tour_0_text'),
    st('tour_1_title', 'tour_1_text', '.cal > .cal-head'),
    st('tour_2_title', yOk() ? 'tour_2_text' : 'tour_2_text_noy', ['.grid .day.today', '.grid .day:not(.ctx)']),
    st('tour_3_title', 'tour_3_text', '.grid'),
    // BOTH dashed days: the last day of the previous month (first one on the grid) and the first day of the next month (last one)
    st('tour_dash_title', 'tour_dash_text', () => document.querySelector('.grid .day.ctx'), () => [...document.querySelectorAll('.grid .day.ctx')].pop()),
    st('tour_4_title', yOk() ? 'tour_4_text' : 'tour_4_text_noy', '.totals'),
    st('tour_5_title', 'tour_5_text', '.cal-tools .icon-only'),
    ...(last ? [LANG, MENU] : []),
  ] },
  '/team': { ready: '.tgrid td.c', steps: (last) => {
    const ro = state.profile.role === 'super_manager', sup = ['super_admin', 'super_manager'].includes(state.profile.role);
    return [
      st('tour_team_0_title', ro ? 'tour_team_0_text_ro' : 'tour_team_0_text'),
      ...(sup ? [st('tour_dept_title', 'tour_dept_text', '.dept-switch')] : []),
      TABS,
      st('tour_team_head_title', 'tour_team_head_text', '.team-top .cal-head', '.team-row > .seg'),
      st('tour_team_cell_title', ro ? 'tour_team_cell_text_ro' : 'tour_team_cell_text', '.tgrid td.c:not(.ctx)'),
      ...(touch() ? [] : [st('tour_team_keys_title', ro ? 'tour_team_keys_text_ro' : 'tour_team_keys_text', '.tgrid')]),      // a computer: the keyboard works in the grid
      st('tour_team_name_title', 'tour_team_name_text', '.tgrid tbody th.nm'),
      st('tour_team_tools_title', ro ? 'tour_team_tools_text_ro' : 'tour_team_tools_text', '.team-row.tools'),
      st('tour_team_search_title', 'tour_team_search_text', '.search-wrap'),
      ...(last ? [LANG, MENU] : []),
    ];
  } },
  '/overtime': { ready: '.ot-view .ot-day', steps: (last) => {
    const ro = state.profile.role === 'super_manager', sup = ['super_admin', 'super_manager'].includes(state.profile.role);
    return [
      st('tour_ot_0_title', ro ? 'tour_ot_0_text_ro' : 'tour_ot_0_text'),
      ...(sup ? [st('tour_dept_title', 'tour_dept_text', '.dept-switch')] : []),
      MONTH,
      st('tour_ot_day_title', ro ? 'tour_ot_day_text_ro' : 'tour_ot_day_text', '.ot-view .ot-day'),
      st('tour_ot_form_title', 'tour_ot_form_text', '.cal-tools .ot-form-tools'),
      ...(ro ? [] : [st('tour_ot_scan_title', 'tour_ot_scan_text', '#scan-open')]),
      st('tour_ot_totals_title', 'tour_ot_totals_text', '.ot-view .totals'),
      ...(last ? [LANG, MENU] : []),
    ];
  } },
  '/users': { ready: '.person, .utable', steps: (last) => [
    st('tour_users_0_title', 'tour_users_0_text'),
    st('tour_users_add_title', 'tour_users_add_text', '.cal-head .actions'),
    st('tour_users_find_title', 'tour_users_find_text', '.team-row'),
    st('tour_users_person_title', 'tour_users_person_text', ['.person', '.utable tbody tr.urow']),
    ...(last ? [LANG, MENU] : []),
  ] },
  '/departments': { ready: 'details.dept', alt: '#dept-search', steps: (last) => [
    st('tour_dep_0_title', 'tour_dep_0_text'),
    st('tour_dep_search_title', 'tour_dep_search_text', '#dept-search'),
    st('tour_dep_add_title', 'tour_dep_add_text', '.depts .cal-head .actions'),
    st('tour_dep_card_title', 'tour_dep_card_text', 'details.dept'),
    st('tour_dep_tabs_title', 'tour_dep_tabs_text', '.shell > .nav'),
    ...(last ? [LANG, MENU] : []),
  ] },
  '/super': { ready: '#add-super', steps: (last) => [
    st('tour_su_0_title', 'tour_su_0_text'),
    st('tour_su_add_title', 'tour_su_add_text', '.depts .cal-head .actions'),
    st('tour_su_person_title', 'tour_su_person_text', '.person'),
    ...(last ? [LANG, MENU] : []),
  ] },
};

let running = null, waiting = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// opens a screen (changes the tab if needed) and waits until it is drawn; null when it never shows up (e.g. an empty department) or the person went elsewhere
async function openPage(route) {
  if (routeNow() !== route) location.hash = '#' + route;
  const page = PAGES[route];
  for (let tries = 0; tries < 30; tries++) {
    await sleep(tries ? 300 : 150);
    if (routeNow() !== route) return null;
    // a screen draws its data after loading: wait for its main element (it may name a fallback that is enough after ~6 s, e.g. no departments yet)
    if (document.querySelector(page.ready) || (tries >= 20 && page.alt && document.querySelector(page.alt))) { await sleep(150); return page; }
  }
  return null;
}

// Starts the tour of the screen you are on and carries on through the following tabs (a "Next: Overtime" button at the end of each screen).
// `landing`: where the menu entry goes from a screen without a tour (Account, one person's month). `skipSeen`: the automatic start leaves out screens already seen.
// Only ONE tour at a time: views are built again on every re-render, and each build may ask for it while the first is still waiting / running.
export function startGuide({ landing, skipSeen = false } = {}) {
  if (running || waiting) return;
  const origin = routeNow();                                  // where the tour was started: it comes back here when it ends
  const seq = ORDER[state.profile?.role] ?? [];
  let from = seq.indexOf(routeNow());
  if (from < 0) from = seq.indexOf(landing);
  if (from < 0) return;
  const todo = seq.slice(from).filter((r, k) => k === 0 || !(skipSeen && seen(r)));
  let pos = 0;
  const stepsOf = (k) => PAGES[todo[k]].steps(k === todo.length - 1);
  const labelOf = (k) => (k < todo.length - 1 ? t('tour_next_screen').replace('{name}', t(NAV[todo[k + 1]])) : null);
  const screenOf = (k) => ({ n: k + 1, of: todo.length });
  waiting = true;
  (async () => {
    const first = await openPage(todo[0]);
    waiting = false;
    if (!first) return;
    running = startTour({
      steps: stepsOf(0), nextLabel: labelOf(0), screen: screenOf(0),
      onNext: async () => {                               // the end of a screen: open the next one that shows up
        markSeen(todo[pos]);
        while (++pos < todo.length) { if (await openPage(todo[pos])) return { steps: stepsOf(pos), nextLabel: labelOf(pos), screen: screenOf(pos) }; }
        return null;
      },
      onEnd: (completed) => {
        if (completed) markSeen(todo[Math.min(pos, todo.length - 1)]); else todo.forEach(markSeen);
        running = null;
        if (routeNow() !== origin) location.hash = '#' + origin;           // finished or skipped: back to the tab where it started
      },     // skipping = "I know the app": all of its screens count as seen
    });
  })();
}

// called after every render: a new account gets the tour of its landing screen (and the rest) by itself, once
export function maybeAutoGuide() {
  const role = state.profile?.role;
  if (!role || !autoAllowed() || AUTO[role] !== routeNow() || !isNew() || seen(AUTO[role])) return;
  startGuide({ skipSeen: true });
}

export const guideAvailable = () => !!state.profile;
