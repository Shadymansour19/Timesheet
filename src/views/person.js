import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { state, myDept } from '../auth/session.js';
import { supabase } from '../supabase.js';
import { calendarView } from './calendar.js';

const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

// Admin: one employee's month, edited like a calendar. RLS only returns people of the admin's own department,
// so another department's id (or a deleted person) simply shows "not found".
export function personView(personId) {
  const root = h('section', { class: 'person-view' }, h('p', { class: 'muted center' }, t('loading')));
  (async () => {
    const { data: p, error } = await supabase.from('profiles').select('id,username,full_name,opr,level,role,department_id,active,job_title,contract_no,work_location,residence,position,payroll,y_allowed').eq('id', personId).maybeSingle();
    if (error) { root.replaceChildren(h('p', { class: 'error' }, t('load_error'))); return; }
    if (!p || !p.active || p.department_id !== myDept()) { root.replaceChildren(h('p', { class: 'muted center' }, t('person_not_found'))); return; }
    root.replaceChildren(
      h('div', { class: 'person-head card' },
        h('span', { class: 'avatar big' }, initials(p.full_name)),
        h('div', { class: 'acct-text' },
          h('strong', {}, p.full_name),
          h('span', { class: 'muted' }, `${t('role_' + p.role)} · ${p.username} · ${t('payroll_short')} ${p.payroll || '-'} · ${t('level')} ${p.level ?? '-'}`))),
      calendarView({ userId: p.id, admin: true, person: p, readOnly: state.profile.role === 'super_manager' }));
  })();
  return root;
}
