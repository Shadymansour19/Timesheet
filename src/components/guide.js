// "How to use the app": a guided tour of the screen you are on, for every role, on phones and desktops (src/components/tour.js draws it).
// It starts by itself for a NEW account (younger than 30 days) the first time that person opens their landing screen (and an admin's own My calendar),
// until it is finished or skipped; "How to use the app" in the account menu starts the tour of the current screen at any time.
// Browsers driven by automation (navigator.webdriver) never get the automatic start, unless localStorage ts.forceGuide = 1 (the tour's own test).
import { state } from '../auth/session.js';
import { startTour } from './tour.js';

const NEW_DAYS = 30;                                                   // an account younger than this gets the tour by itself
const routeNow = () => location.hash.replace(/^#/, '') || '/';
const keyOf = (route) => `ts.guideSeen.${state.profile.id}${route === '/calendar' ? '' : '.' + route}`;      // the calendar keeps the first key
const seen = (route) => { try { return localStorage.getItem(keyOf(route)) === '1'; } catch { return false; } };
const markSeen = (route) => { try { localStorage.setItem(keyOf(route), '1'); } catch { /* ignore */ } };
const isNew = () => Date.now() - new Date(state.profile.created_at).getTime() < NEW_DAYS * 86400000;
const autoAllowed = () => { try { return !navigator.webdriver || localStorage.getItem('ts.forceGuide') === '1'; } catch { return !navigator.webdriver; } };

// the screens that start by themselves, per role
const AUTO = { user: ['/calendar'], admin: ['/team', '/calendar'], manager: ['/team'], super_manager: ['/team'], super_admin: ['/departments'] };

// a step: { target | targets, title, text } (see tour.js); every text is an i18n key
const st = (title, text, ...targets) => (targets.length > 1 ? { title, text, targets } : { title, text, target: targets[0] ?? null });
const MENU = st('tour_6_title', 'tour_6_text', '.acct');
const TABS = st('tour_tabs_title', 'tour_tabs_text', '.shell > .nav');
const MONTH = st('tour_1_title', 'tour_1_text', '.cal-head');

const PAGES = {
  '/calendar': { ready: '.cal .grid', steps: () => [
    st('tour_0_title', 'tour_0_text'),
    st('tour_1_title', 'tour_1_text', '.cal > .cal-head'),
    st('tour_2_title', 'tour_2_text', ['.grid .day.today', '.grid .day:not(.ctx)']),
    st('tour_3_title', 'tour_3_text', '.grid'),
    // BOTH dashed days: the last day of the previous month (first one on the grid) and the first day of the next month (last one)
    st('tour_dash_title', 'tour_dash_text', () => document.querySelector('.grid .day.ctx'), () => [...document.querySelectorAll('.grid .day.ctx')].pop()),
    st('tour_4_title', 'tour_4_text', '.totals'),
    st('tour_5_title', 'tour_5_text', '.cal-tools .icon-only'),
    MENU,
  ] },
  '/team': { ready: '.tgrid td.c', steps: () => {
    const ro = state.profile.role === 'super_manager', sup = ['super_admin', 'super_manager'].includes(state.profile.role);
    return [
      st('tour_team_0_title', ro ? 'tour_team_0_text_ro' : 'tour_team_0_text'),
      ...(sup ? [st('tour_dept_title', 'tour_dept_text', '.dept-switch')] : []),
      TABS,
      st('tour_team_head_title', 'tour_team_head_text', '.team-top .cal-head', '.team-row > .seg'),
      st('tour_team_cell_title', ro ? 'tour_team_cell_text_ro' : 'tour_team_cell_text', '.tgrid td.c:not(.ctx)'),
      st('tour_team_name_title', 'tour_team_name_text', '.tgrid tbody th.nm'),
      st('tour_team_tools_title', ro ? 'tour_team_tools_text_ro' : 'tour_team_tools_text', '.team-row.tools'),
      st('tour_team_search_title', 'tour_team_search_text', '.search-wrap'),
      MENU,
    ];
  } },
  '/overtime': { ready: '.ot-view .ot-day', steps: () => {
    const ro = state.profile.role === 'super_manager', sup = ['super_admin', 'super_manager'].includes(state.profile.role);
    return [
      st('tour_ot_0_title', ro ? 'tour_ot_0_text_ro' : 'tour_ot_0_text'),
      ...(sup ? [st('tour_dept_title', 'tour_dept_text', '.dept-switch')] : []),
      MONTH,
      st('tour_ot_day_title', ro ? 'tour_ot_day_text_ro' : 'tour_ot_day_text', '.ot-view .ot-day'),
      ...(ro ? [] : [st('tour_ot_scan_title', 'tour_ot_scan_text', '#scan-open')]),
      st('tour_ot_totals_title', 'tour_ot_totals_text', '.ot-view .totals'),
      MENU,
    ];
  } },
  '/users': { ready: '.person, .utable', steps: () => [
    st('tour_users_0_title', 'tour_users_0_text'),
    st('tour_users_add_title', 'tour_users_add_text', '.cal-head .actions'),
    st('tour_users_find_title', 'tour_users_find_text', '.team-row'),
    st('tour_users_person_title', 'tour_users_person_text', ['.person', '.utable tbody tr.urow']),
    MENU,
  ] },
  '/departments': { ready: 'details.dept', alt: '#dept-search', steps: () => [
    st('tour_dep_0_title', 'tour_dep_0_text'),
    st('tour_dep_search_title', 'tour_dep_search_text', '#dept-search'),
    st('tour_dep_add_title', 'tour_dep_add_text', '.depts .cal-head .actions'),
    st('tour_dep_card_title', 'tour_dep_card_text', 'details.dept'),
    st('tour_dep_tabs_title', 'tour_dep_tabs_text', '.shell > .nav'),
    MENU,
  ] },
  '/super': { ready: '#add-super', steps: () => [
    st('tour_su_0_title', 'tour_su_0_text'),
    st('tour_su_add_title', 'tour_su_add_text', '.depts .cal-head .actions'),
    st('tour_su_person_title', 'tour_su_person_text', '.person'),
    MENU,
  ] },
};

let running = null, waiting = false;
// Waits for the screen to be drawn, then starts. `landing`: where the menu entry goes from a screen that has no tour (Account, one person's month).
// Only ONE tour at a time: views are built again on every re-render, and each build may ask for the tour while the first is still waiting / running.
export function startGuide({ landing } = {}) {
  if (running || waiting) return;
  let route = routeNow();
  if (!PAGES[route]) { if (!landing || !PAGES[landing]) return; location.hash = '#' + landing; route = landing; }
  const page = PAGES[route];
  waiting = true;
  let tries = 0;
  const go = () => {
    if (routeNow() !== route) { waiting = false; return; }                         // the person moved on
    // the screen draws its data after loading: wait for the main element (a screen may name a fallback that is enough after ~6 s, e.g. no departments yet)
    if (!document.querySelector(page.ready) && !(tries >= 20 && page.alt && document.querySelector(page.alt))) { if (++tries < 30) setTimeout(go, 300); else waiting = false; return; }
    waiting = false;
    running = startTour({ steps: page.steps(), onEnd: () => { markSeen(route); running = null; } });
  };
  go();
}

// called after every render: a new account gets the tour of its landing screen by itself, once
export function maybeAutoGuide() {
  const role = state.profile?.role, route = routeNow();
  if (!role || !autoAllowed() || !(AUTO[role] ?? []).includes(route) || !isNew() || seen(route)) return;
  startGuide();
}

export const guideAvailable = () => !!state.profile;
