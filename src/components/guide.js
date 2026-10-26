// "How to use the app" tour for the own calendar of a plain user or a department admin, on PHONES only: it starts by itself for a new account
// (until it is finished or skipped) and from the account menu at any time. Admins also have a first-run checklist (src/components/onboarding.js).
import { state } from '../auth/session.js';
import { startTour } from './tour.js';

export const isPhone = () => matchMedia('(max-width: 640px), (hover: none) and (pointer: coarse)').matches;
const NEW_DAYS = 30;                                                   // an account younger than this gets the tour by itself
const key = () => `ts.guideSeen.${state.profile.id}`;
const seen = () => { try { return localStorage.getItem(key()) === '1'; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(key(), '1'); } catch { /* ignore */ } };
const isNew = () => Date.now() - new Date(state.profile.created_at).getTime() < NEW_DAYS * 86400000;

// plain users and department admins (the admin's own My calendar tab) on a phone
export const guideAvailable = () => ['user', 'admin'].includes(state.profile?.role) && isPhone();
export const guideAuto = () => guideAvailable() && isNew() && !seen();

// what is explained, in order; `target` is what gets the spotlight
const STEPS = [
  { target: null, title: 'tour_0_title', text: 'tour_0_text' },
  { target: '.cal > .cal-head', title: 'tour_1_title', text: 'tour_1_text' },
  { target: ['.grid .day.today', '.grid .day:not(.ctx)'], title: 'tour_2_title', text: 'tour_2_text' },
  { target: '.grid', title: 'tour_3_title', text: 'tour_3_text' },
  // BOTH dashed days: the last day of the previous month (first one on the grid) and the first day of the next month (last one)
  { targets: [() => document.querySelector('.grid .day.ctx'), () => [...document.querySelectorAll('.grid .day.ctx')].pop()], title: 'tour_dash_title', text: 'tour_dash_text' },
  { target: '.totals', title: 'tour_4_title', text: 'tour_4_text' },
  { target: '.cal-tools .icon-only', title: 'tour_5_title', text: 'tour_5_text' },
  { target: '.acct', title: 'tour_6_title', text: 'tour_6_text' },
];

let running = null, waiting = false;
// waits for the calendar to be drawn, then starts; finishing or skipping both count as "seen".
// Only ONE tour at a time: the calendar view is built again on every re-render, and each build asks for the tour while the first is still waiting / running.
export function startGuide() {
  if (running || waiting) return;
  waiting = true;
  let tries = 0;
  const go = () => {
    if (!document.querySelector('.cal .grid')) { if (++tries < 25) setTimeout(go, 300); else waiting = false; return; }
    waiting = false;
    running = startTour({ steps: STEPS, onEnd: () => { markSeen(); running = null; } });
  };
  go();
}

