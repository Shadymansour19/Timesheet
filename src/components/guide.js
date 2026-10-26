// "How to use the app" tour for a plain user, on PHONES only: it starts by itself for a new account (until it is finished or skipped) and
// from the account menu at any time. Admins have their own first-run checklist (src/components/onboarding.js).
import { state } from '../auth/session.js';
import { startTour } from './tour.js';

export const isPhone = () => matchMedia('(max-width: 640px), (hover: none) and (pointer: coarse)').matches;
const NEW_DAYS = 30;                                                   // an account younger than this gets the tour by itself
const key = () => `ts.guideSeen.${state.profile.id}`;
const seen = () => { try { return localStorage.getItem(key()) === '1'; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(key(), '1'); } catch { /* ignore */ } };
const isNew = () => Date.now() - new Date(state.profile.created_at).getTime() < NEW_DAYS * 86400000;

export const guideAvailable = () => state.profile?.role === 'user' && isPhone();
export const guideAuto = () => guideAvailable() && isNew() && !seen();

// what is explained, in order; `target` is what gets the spotlight
const STEPS = [
  { target: null, title: 'tour_0_title', text: 'tour_0_text' },
  { target: '.cal > .cal-head', title: 'tour_1_title', text: 'tour_1_text' },
  { target: ['.grid .day.today', '.grid .day:not(.ctx)'], title: 'tour_2_title', text: 'tour_2_text' },
  { target: '.grid', title: 'tour_3_title', text: 'tour_3_text' },
  { target: '.totals', title: 'tour_4_title', text: 'tour_4_text' },
  { target: '.cal-tools .icon-only', title: 'tour_5_title', text: 'tour_5_text' },
  { target: '.acct', title: 'tour_6_title', text: 'tour_6_text' },
];

let running = null;
// waits for the calendar to be drawn, then starts; finishing or skipping both count as "seen"
export function startGuide() {
  if (running) return;
  let tries = 0;
  const go = () => {
    if (!document.querySelector('.cal .grid')) { if (++tries < 25) setTimeout(go, 300); return; }
    running = startTour({ steps: STEPS, onEnd: () => { markSeen(); running = null; } });
  };
  go();
}

