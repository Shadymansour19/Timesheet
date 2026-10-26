// "How to use the app" guide for a plain user, on PHONES only: an inline card on the calendar for a new account (until "Got it"), and the
// same steps in a dialog from the account menu at any time. Admins have their own first-run checklist (src/components/onboarding.js).
import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { state } from '../auth/session.js';
import { openDialog } from './dialog.js';
import { icon, CALENDAR, GRID, CLOCK, INFO, LIST } from './icons.js';

export const isPhone = () => matchMedia('(max-width: 640px), (hover: none) and (pointer: coarse)').matches;
const NEW_DAYS = 30;                                                   // an account younger than this gets the card by itself
const key = () => `ts.guideSeen.${state.profile.id}`;
const seen = () => { try { return localStorage.getItem(key()) === '1'; } catch { return false; } };
const isNew = () => Date.now() - new Date(state.profile.created_at).getTime() < NEW_DAYS * 86400000;

// the menu entry and the card exist for plain users on a phone
export const guideAvailable = () => state.profile?.role === 'user' && isPhone();
export const guideAuto = () => guideAvailable() && isNew() && !seen();

const STEPS = [
  ['guide_1_title', 'guide_1_text', CALENDAR],
  ['guide_2_title', 'guide_2_text', GRID],
  ['guide_3_title', 'guide_3_text', LIST],
  ['guide_4_title', 'guide_4_text', CLOCK],
  ['guide_5_title', 'guide_5_text', INFO],
];

const list = () => h('ol', { class: 'guide-steps' }, STEPS.map(([title, text, ic], i) => h('li', { class: 'guide-step' },
  h('span', { class: 'guide-ico', 'aria-hidden': 'true' }, icon(ic, 20)),
  h('div', { class: 'guide-text' }, h('strong', {}, `${i + 1}. ${t(title)}`), h('span', {}, t(text))))));

export function openGuide() {
  openDialog({ title: t('guide_title'), content: h('div', { class: 'form' }, list()), buttons: [{ label: t('close') }] });
}

// inline card for a new user; `onGone` runs after it is dismissed
export function guideCard(onGone) {
  const card = h('div', { class: 'card guide', id: 'guide', role: 'region', 'aria-label': t('guide_title') },
    h('div', { class: 'ob-head' }, h('strong', {}, t('guide_title'))), list(),
    h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn small primary', id: 'guide-ok', onclick: () => {
      try { localStorage.setItem(key(), '1'); } catch { /* ignore */ }
      card.remove(); onGone?.();
    } }, t('guide_ok'))));
  return card;
}
