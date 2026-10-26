// First-run checklist for a department admin (top of the Users tab): add people -> set the department data -> start filling.
// Each step is ticked from the real data; the card disappears when all three are done, or when the admin hides it (per department, per device).
import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { supabase } from '../supabase.js';
import { fetchDepartment } from '../api/admin.js';
import { openReportSettings } from './report-settings.js';

const key = (dept) => `ts.onboardingHidden.${dept}`;
const hidden = (dept) => { try { return localStorage.getItem(key(dept)) === '1'; } catch { return false; } };

// -> { done: [bool, bool, bool] } read from the database (RLS limits everything to the department)
async function status(dept, people) {
  const d = await fetchDepartment(dept);
  const hasData = !!(d && (d.code || d.sector || d.field || d.report?.dept_print_name || d.report?.location));
  const { count } = await supabase.from('day_status').select('user_id', { count: 'exact', head: true });
  return { dept: d, done: [people.some((p) => p.role === 'user'), hasData, (count ?? 0) > 0] };
}

// el: container to fill; people: current people; actions: { addUser }. Returns nothing; safe to call again after changes.
export async function renderOnboarding(el, { dept, people, addUser }) {
  if (!dept || hidden(dept)) { el.replaceChildren(); return; }
  let s;
  try { s = await status(dept, people); } catch { el.replaceChildren(); return; }     // never block the page for a hint
  if (s.done.every(Boolean)) { el.replaceChildren(); return; }
  const step = (i, title, text, btn) => h('li', { class: 'ob-step' + (s.done[i] ? ' done' : '') },
    h('span', { class: 'ob-mark', 'aria-hidden': 'true' }, s.done[i] ? '✓' : String(i + 1)),
    h('div', { class: 'ob-text' }, h('strong', {}, title), h('span', { class: 'muted' }, text)),
    s.done[i] ? h('span', { class: 'sr-only' }, t('ob_done')) : btn);
  el.replaceChildren(h('div', { class: 'card onboarding', id: 'onboarding', role: 'region', 'aria-label': t('ob_title') },
    h('div', { class: 'ob-head' }, h('strong', {}, t('ob_title')),
      h('button', { type: 'button', class: 'btn small', onclick: () => { try { localStorage.setItem(key(dept), '1'); } catch { /* ignore */ } el.replaceChildren(); } }, t('ob_hide'))),
    h('ol', { class: 'ob-steps' },
      step(0, t('ob_add'), t('ob_add_text'), h('button', { type: 'button', class: 'btn small primary', onclick: addUser }, t('add_user'))),
      step(1, t('ob_data'), t('ob_data_text'), h('button', { type: 'button', class: 'btn small primary', onclick: () => openReportSettings({ dept: s.dept, onSaved: () => renderOnboarding(el, { dept, people, addUser }) }) }, t('report_settings'))),
      step(2, t('ob_fill'), t('ob_fill_text'), h('a', { class: 'btn small primary', href: '#/team' }, t('nav_team'))))));
}
