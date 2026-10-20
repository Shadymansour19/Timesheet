import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { state } from '../auth/session.js';
import { fetchDeptPeople, updateProfile, setUserRole, callFn } from '../api/admin.js';
import { explain } from '../api/errors.js';
import { openDialog, confirmDialog } from '../components/dialog.js';
import { field, randomPassword } from '../components/form.js';
import { toast } from '../components/toast.js';
import { icon, SEARCH } from '../components/icons.js';
import * as live from '../live.js';

// Shared by the admin (own department) and the super admin (admins of any department).
export function personFields(initial = {}, { withLogin = false } = {}) {
  const f = {
    username: withLogin ? field(t('username'), { required: true, autocapitalize: 'none', autocomplete: 'off', pattern: '[a-z0-9._\\-]{3,32}', minlength: 3, maxlength: 32 }) : null,
    password: withLogin ? field(t('temp_password'), { type: 'text', required: true, minlength: 8, autocomplete: 'off', value: randomPassword() }) : null,
    full_name: field(t('full_name'), { required: true, value: initial.full_name ?? '' }),
    opr: field(t('opr'), { required: true, value: initial.opr ?? '' }),
    level: field(t('level'), { type: 'number', min: 0, step: 1, inputmode: 'numeric', value: initial.level ?? '' }),
    job_title: field(t('job_title'), { maxlength: 100, value: initial.job_title ?? '' }),
    contract_no: field(t('contract_no'), { maxlength: 50, value: initial.contract_no ?? '' }),
  };
  const rows = Object.values(f).filter(Boolean).map((x) => x.row);
  const level = () => (f.level.input.value === '' ? null : Number(f.level.input.value));
  return { f, rows, level };
}

export const resetPasswordDialog = (person) => {
  const pw = field(t('new_password'), { type: 'text', required: true, minlength: 8, autocomplete: 'off', value: randomPassword() });
  openDialog({
    title: `${t('reset_password')}: ${person.full_name}`, content: h('div', { class: 'form' }, pw.row, h('p', { class: 'muted' }, t('share_password_hint'))),
    buttons: [{ label: t('cancel') }, { label: t('reset_password'), kind: 'primary', onClick: async () => {
      await callFn('reset_password', { user_id: person.id, password: pw.input.value });
      toast(t('password_reset_done'), 'success');
    } }],
  });
};

export async function deletePerson(person, reload) {
  if (!(await confirmDialog(`${t('delete_user')}: ${person.full_name}?`, { danger: true, confirmLabel: t('delete') }))) return;
  try { await callFn('delete_user', { user_id: person.id }); toast(t('deleted'), 'success'); await reload(); }
  catch (e) { toast(explain(e)); }
}

export async function changeRole(person, role, reload) {
  const q = role === 'admin' ? t('promote_confirm') : t('demote_confirm');
  if (!(await confirmDialog(`${q} ${person.full_name}?`))) return;
  try { await setUserRole(person.id, role); await reload(); }
  catch (e) { toast(explain(e)); }
}

export function usersView() {
  const me = state.profile;
  const root = h('section', { class: 'users' });
  let people = [], query = '', roleFilter = 'all';
  let built = false;
  const el = {};

  async function load({ quiet = false } = {}) {
    let fresh;
    try { fresh = await fetchDeptPeople(me.department_id); }
    catch (e) { if (!quiet) root.replaceChildren(h('p', { class: 'error' }, explain(e))); return; }
    if (quiet && built && JSON.stringify(fresh) === JSON.stringify(people)) return;   // nothing new
    people = fresh;
    if (!built) build();
    update();
  }

  function addUser() {
    const p = personFields({}, { withLogin: true });
    openDialog({
      title: t('add_user'), content: h('div', { class: 'form' }, p.rows, h('p', { class: 'muted' }, t('share_password_hint'))),
      buttons: [{ label: t('cancel') }, { label: t('add'), kind: 'primary', onClick: async () => {
        await callFn('create_user', {
          username: p.f.username.input.value, password: p.f.password.input.value, full_name: p.f.full_name.input.value,
          opr: p.f.opr.input.value, level: p.level(), department_id: me.department_id, role: 'user',
          job_title: p.f.job_title.input.value, contract_no: p.f.contract_no.input.value,
        });
        toast(t('user_created'), 'success'); await load();
      } }],
    });
  }

  function editUser(person) {
    const p = personFields(person);
    openDialog({
      title: `${t('edit_data')}: ${person.username}`, content: h('div', { class: 'form' }, p.rows),
      buttons: [{ label: t('cancel') }, { label: t('save'), kind: 'primary', onClick: async () => {
        await updateProfile(person.id, p.f.full_name.input.value.trim(), p.f.opr.input.value.trim(), p.level(), p.f.job_title.input.value, p.f.contract_no.input.value);
        await load();
      } }],
    });
  }

  function card(p) {
    const self = p.id === me.id;
    return h('li', { class: 'person card', 'data-u': p.id },
      h('div', { class: 'pinfo' },
        h('strong', {}, p.full_name), h('span', { class: 'badge' + (p.role === 'admin' ? ' admin' : '') }, t('role_' + p.role)),
        h('span', { class: 'muted' }, `${p.username} · ${t('opr')} ${p.opr ?? '-'} · ${t('level')} ${p.level ?? '-'}${p.job_title ? ' · ' + p.job_title : ''}`)),
      h('div', { class: 'pactions' },
        h('a', { class: 'btn small primary', href: '#/person/' + p.id }, t('timesheet')),
        h('button', { class: 'btn small', onclick: () => editUser(p) }, t('edit_data')),
        self ? null : h('button', { class: 'btn small', onclick: () => resetPasswordDialog(p) }, t('reset_password')),
        p.role === 'user' ? h('button', { class: 'btn small', onclick: () => changeRole(p, 'admin', load) }, t('promote')) : null,
        p.role === 'admin' && !self ? h('button', { class: 'btn small', onclick: () => changeRole(p, 'user', load) }, t('demote')) : null,
        self ? null : h('button', { class: 'btn small danger', onclick: () => deletePerson(p, load) }, t('delete'))));
  }

  const matches = (p) => (roleFilter === 'all' || p.role === roleFilter)
    && (!query || `${p.full_name} ${p.username} ${p.opr ?? ''}`.toLowerCase().includes(query));

  function build() {
    el.title = h('h2', {});
    el.search = h('input', { type: 'search', class: 'team-search', placeholder: t('search_users'), 'aria-label': t('search_users'), autocomplete: 'off' });
    let timer;
    el.search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { query = el.search.value.trim().toLowerCase(); update(); }, 120); });
    el.count = h('span', { class: 'muted team-count' });
    el.seg = h('div', { class: 'seg', role: 'group', 'aria-label': t('role_filter_all') });
    el.list = h('ul', { class: 'plist' });
    el.empty = h('div', { class: 'empty card', hidden: true });
    root.replaceChildren(
      h('div', { class: 'cal-head' }, el.title, h('button', { class: 'btn small primary', onclick: addUser }, t('add_user'))),
      h('div', { class: 'team-row' }, h('div', { class: 'search-wrap' }, icon(SEARCH, 16), el.search, el.count), el.seg),
      el.list, el.empty);
    built = true;
  }

  function update() {
    const visible = people.filter(matches);
    const nUsers = people.filter((p) => p.role === 'user').length, nAdmins = people.filter((p) => p.role === 'admin').length;
    el.title.textContent = `${t('nav_users')} (${people.length})`;
    el.count.textContent = query || roleFilter !== 'all' ? `${visible.length}/${people.length}` : '';
    el.seg.replaceChildren(...[['all', t('role_filter_all'), people.length], ['user', t('role_filter_user'), nUsers], ['admin', t('role_filter_admin'), nAdmins]].map(([r, label, n]) =>
      h('button', { type: 'button', class: 'btn small' + (roleFilter === r ? ' on' : ''), 'aria-pressed': String(roleFilter === r), onclick: () => { roleFilter = r; update(); } }, `${label} ${n}`)));
    el.list.replaceChildren(...visible.map(card));
    // empty states: nobody to show -> say why and what to do
    const none = visible.length === 0;
    el.empty.hidden = !(none || nUsers === 0);
    if (!el.empty.hidden) {
      el.empty.replaceChildren(...(none
        ? [h('p', {}, t('users_none_match')), h('button', { class: 'btn small', onclick: () => { query = ''; roleFilter = 'all'; el.search.value = ''; update(); } }, t('clear_filters'))]
        : [h('strong', {}, t('users_empty_title')), h('p', { class: 'muted' }, t('users_empty_text')), h('button', { class: 'btn small primary', onclick: addUser }, t('add_user'))]));
    }
  }

  // live: another admin added / edited / removed someone
  let liveTimer;
  live.watch([`dept:${me.department_id}`], (p) => {
    if (p.t !== 'profiles' && p.t !== 'resync') return;
    clearTimeout(liveTimer); liveTimer = setTimeout(() => load({ quiet: true }), 350);
  });

  load();
  return root;
}
