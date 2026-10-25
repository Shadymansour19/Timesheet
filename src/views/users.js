import { choice } from '../components/choice.js';
import { openBulkAdd } from './bulk-users.js';
import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { state, myDept } from '../auth/session.js';
import { fetchDeptPeople, updateProfile, setUserRole, callFn } from '../api/admin.js';
import { explain } from '../api/errors.js';
import { openDialog, confirmDialog } from '../components/dialog.js';
import { field, randomPassword } from '../components/form.js';
import { toast } from '../components/toast.js';
import { icon, SEARCH, GRID, LIST } from '../components/icons.js';
import * as live from '../live.js';

// Shared by the admin (own department) and the super admin (admins of any department).
// TEMPORARY: new people start with this contract number (a UI default only; the database has no default for it)
export const DEFAULT_CONTRACT_NO = '033/2019';

export function personFields(initial = {}, { withLogin = false, isNew = false } = {}) {
  const f = {
    username: withLogin ? field(t('username'), { required: true, autocapitalize: 'none', autocomplete: 'off', pattern: '[a-z0-9._\\-]{3,32}', minlength: 3, maxlength: 32 }) : null,
    password: withLogin ? field(t('temp_password'), { type: 'text', required: true, minlength: 8, autocomplete: 'off', value: randomPassword() }) : null,
    full_name: field(t('full_name'), { required: true, value: initial.full_name ?? '' }),
    opr: field(t('opr'), { required: true, value: initial.opr ?? '' }),
    level: field(t('level'), { maxlength: 50, value: initial.level ?? '', placeholder: '3' }),
    job_title: field(t('job_title'), { maxlength: 100, value: initial.job_title ?? '' }),
    contract_no: field(t('contract_no'), { maxlength: 50, value: initial.contract_no ?? (isNew ? DEFAULT_CONTRACT_NO : '') }),
    work_location: field(t('work_location'), { maxlength: 100, value: initial.work_location ?? '' }),
    payroll: field(t('payroll'), { required: true, maxlength: 50, value: initial.payroll ?? '' }),
    position: field(t('position'), { maxlength: 100, value: initial.position ?? '', list: 'position-list', placeholder: 'Engineer, Tech' }),
  };
  // inside / outside the work-location city: decides whether Arrival / Departure trips count as TRANS/IN or TRANS/EX
  const residence = choice(t('residence'), [{ value: 'inside', label: t('residence_inside') }, { value: 'outside', label: t('residence_outside') }, { value: '', label: t('residence_unset') }], initial.residence ?? (isNew ? 'inside' : ''));
  f.residence = { row: residence.row, input: residence };
  // may this person have Y (shift days)? off = their day cycle is E -> X only
  const yAllowed = choice(t('y_allowed'), [{ value: 'yes', label: t('y_yes') }, { value: 'no', label: t('y_no') }], initial.y_allowed === false ? 'no' : 'yes');
  f.y_allowed = { row: yAllowed.row, input: yAllowed };
  f.position.row.append(h('datalist', { id: 'position-list' }, h('option', { value: 'Engineer' }), h('option', { value: 'Tech' })));   // suggestions only: the position is free text
  // new people only: the role (a department manager has no timesheet)
  const roleCh = isNew && withLogin ? choice(t('role'), [{ value: 'user', label: t('role_user') }, { value: 'admin', label: t('role_admin') }, { value: 'manager', label: t('role_manager') }], 'user') : null;
  if (roleCh) f.role = { row: roleCh.row, input: roleCh };
  const rows = Object.values(f).filter(Boolean).map((x) => x.row);
  const level = () => f.level.input.value.trim() || null;
  const role = () => (roleCh ? roleCh.value : 'user');
  return { f, rows, level, role };
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
  const q = role === 'admin' ? t('promote_confirm') : role === 'manager' ? t('manager_confirm') : t('demote_confirm');
  if (!(await confirmDialog(`${q} ${person.full_name}?`))) return;
  try { await setUserRole(person.id, role); await reload(); }
  catch (e) { toast(explain(e)); }
}

export function usersView() {
  const me = state.profile;
  const root = h('section', { class: 'users' });
  let people = [], query = '', roleFilter = 'all';
  const VKEY = 'ts.usersView';
  let view = (() => { try { return localStorage.getItem(VKEY) === 'table' ? 'table' : 'cards'; } catch { return 'cards'; } })();   // grid of cards | table, remembered on this device
  let built = false;
  const el = {};

  async function load({ quiet = false } = {}) {
    let fresh;
    try { fresh = await fetchDeptPeople(myDept()); }
    catch (e) { if (!quiet) root.replaceChildren(h('p', { class: 'error' }, explain(e))); return; }
    if (quiet && built && JSON.stringify(fresh) === JSON.stringify(people)) return;   // nothing new
    people = fresh;
    if (!built) build();
    update();
  }

  function addUser() {
    const p = personFields({}, { withLogin: true, isNew: true });
    openDialog({
      title: t('add_user'), wide: 'xl', content: h('div', { class: 'form two-col' }, p.rows, h('p', { class: 'muted' }, t('share_password_hint'))),
      buttons: [{ label: t('cancel') }, { label: t('add'), kind: 'primary', onClick: async () => {
        await callFn('create_user', {
          username: p.f.username.input.value, password: p.f.password.input.value, full_name: p.f.full_name.input.value,
          opr: p.f.opr.input.value, level: p.level(), department_id: myDept(), role: p.role(),
          job_title: p.f.job_title.input.value, contract_no: p.f.contract_no.input.value,
          work_location: p.f.work_location.input.value, residence: p.f.residence.input.value, position: p.f.position.input.value, payroll: p.f.payroll.input.value, y_allowed: p.f.y_allowed.input.value === 'yes',
        });
        toast(t('user_created'), 'success'); await load();
      } }],
    });
  }

  function editUser(person) {
    const p = personFields(person);
    openDialog({
      title: `${t('edit_data')}: ${person.full_name}`, wide: 'xl', content: h('div', { class: 'form two-col' }, h('p', { class: 'muted' }, `${t('username')}: ${person.username}`), p.rows),
      buttons: [{ label: t('cancel') }, { label: t('save'), kind: 'primary', onClick: async () => {
        await updateProfile(person.id, p.f.full_name.input.value.trim(), p.f.opr.input.value.trim(), p.level(), p.f.job_title.input.value, p.f.contract_no.input.value, p.f.work_location.input.value, p.f.residence.input.value, p.f.position.input.value, p.f.payroll.input.value, p.f.y_allowed.input.value === 'yes');
        await load();
      } }],
    });
  }

  // the actions of one person: the buttons of a card AND the right-click menu of a table row
  function actionsOf(p) {
    const self = p.id === me.id;
    return [
      { label: t('timesheet'), kind: 'primary', href: '#/person/' + p.id },
      { label: t('edit_data'), run: () => editUser(p) },
      ...(self ? [] : [{ label: t('reset_password'), run: () => resetPasswordDialog(p) }]),
      ...(p.role === 'user' ? [{ label: t('promote'), run: () => changeRole(p, 'admin', load) }] : []),
      ...(p.role === 'admin' && !self ? [{ label: t('demote'), run: () => changeRole(p, 'user', load) }] : []),
      ...(p.role === 'manager' && !self ? [{ label: t('demote'), run: () => changeRole(p, 'user', load) }] : []),
      ...(p.role !== 'manager' && !self ? [{ label: t('make_manager'), run: () => changeRole(p, 'manager', load) }] : []),
      ...(self ? [] : [{ label: t('delete'), kind: 'danger', run: () => deletePerson(p, load) }]),
    ];
  }

  // right-click menu (one at a time)
  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  function openMenu(e, p) {
    e.preventDefault(); closeMenu();
    menu = h('div', { class: 'ctx-menu', role: 'menu', 'aria-label': p.full_name },
      h('p', { class: 'ctx-title' }, p.full_name),
      ...actionsOf(p).map((a) => (a.href
        ? h('a', { class: 'ctx-item', role: 'menuitem', href: a.href, onclick: closeMenu }, a.label)
        : h('button', { type: 'button', class: 'ctx-item' + (a.kind === 'danger' ? ' danger' : ''), role: 'menuitem', onclick: () => { closeMenu(); a.run(); } }, a.label))));
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    const x = e.clientX || 20, y = e.clientY || 20;
    menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`; menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
    menu.querySelector('.ctx-item')?.focus();
  }
  const outside = (e) => { if (menu && !menu.contains(e.target)) closeMenu(); };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('resize', closeMenu); window.addEventListener('scroll', closeMenu, true);

  function row(p) {
    return h('tr', { class: 'urow', 'data-u': p.id, tabindex: 0, title: t('users_table_hint'),
      ondblclick: () => editUser(p), oncontextmenu: (e) => openMenu(e, p),
      onkeydown: (e) => { if (e.key === 'Enter') editUser(p); } },
      h('th', { scope: 'row' }, p.full_name),
      h('td', {}, p.payroll ?? ''), h('td', {}, p.opr ?? ''), h('td', {}, p.position ?? ''), h('td', {}, p.job_title ?? ''), h('td', {}, p.level ?? ''),
      h('td', {}, h('span', { class: 'badge' + (p.role === 'admin' || p.role === 'manager' ? ' admin' : '') }, t('role_' + p.role))), h('td', {}, p.work_location ?? ''));
  }

  function card(p) {
    const self = p.id === me.id;
    return h('li', { class: 'person card', 'data-u': p.id },
      h('div', { class: 'pinfo' },
        h('strong', {}, p.full_name), h('span', { class: 'badge' + (p.role === 'admin' || p.role === 'manager' ? ' admin' : '') }, t('role_' + p.role)),
        h('span', { class: 'muted' }, `${p.payroll || '-'}${p.position ? ' · ' + p.position : ''}`)),   // everything else is in Edit data
      h('div', { class: 'pactions' },
        ...actionsOf(p).map((a) => (a.href ? h('a', { class: 'btn small' + (a.kind ? ' ' + a.kind : ''), href: a.href }, a.label) : h('button', { class: 'btn small' + (a.kind ? ' ' + a.kind : ''), onclick: a.run }, a.label)))));
  }

  const matches = (p) => (roleFilter === 'all' || p.role === roleFilter)
    && (!query || `${p.full_name} ${p.username} ${p.payroll ?? ''} ${p.opr ?? ''}`.toLowerCase().includes(query));

  function build() {
    el.title = h('h2', {});
    el.search = h('input', { type: 'search', class: 'team-search', placeholder: t('search_users'), 'aria-label': t('search_users'), autocomplete: 'off' });
    let timer;
    el.search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { query = el.search.value.trim().toLowerCase(); update(); }, 120); });
    el.count = h('span', { class: 'muted team-count' });
    el.seg = h('div', { class: 'seg', role: 'group', 'aria-label': t('role_filter_all') });
    el.list = h('ul', { class: 'plist' });
    el.tableWrap = h('div', { class: 'utable-wrap', hidden: true }, h('table', { class: 'utable' },
      h('thead', {}, h('tr', {}, [t('full_name'), t('payroll_short'), t('opr'), t('position_short'), t('job_title'), t('level'), t('role'), t('work_location_short')].map((x) => h('th', { scope: 'col' }, x)))), h('tbody', {})));
    el.hint = h('p', { class: 'muted', hidden: true }, t('users_table_hint'));
    el.views = h('div', { class: 'seg view-seg', role: 'group', 'aria-label': t('users_view') });
    el.empty = h('div', { class: 'empty card', hidden: true });
    root.replaceChildren(
      h('div', { class: 'cal-head' }, el.title, h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: () => openBulkAdd({ onDone: load }) }, t('bulk_add')), h('button', { class: 'btn small primary', onclick: addUser }, t('add_user')))),
      h('div', { class: 'team-row' }, h('div', { class: 'search-wrap' }, icon(SEARCH, 16), el.search, el.count), el.seg, el.views),
      el.hint, el.list, el.tableWrap, el.empty);
    built = true;
  }

  function update() {
    const visible = people.filter(matches);
    const nUsers = people.filter((p) => p.role === 'user').length, nAdmins = people.filter((p) => p.role === 'admin').length, nManagers = people.filter((p) => p.role === 'manager').length;
    el.title.textContent = `${t('nav_users')} (${people.length})`;
    el.count.textContent = query || roleFilter !== 'all' ? `${visible.length}/${people.length}` : '';
    el.seg.replaceChildren(...[['all', t('role_filter_all'), people.length], ['user', t('role_filter_user'), nUsers], ['admin', t('role_filter_admin'), nAdmins], ...(nManagers ? [['manager', t('role_filter_manager'), nManagers]] : [])].map(([r, label, n]) =>
      h('button', { type: 'button', class: 'btn small' + (roleFilter === r ? ' on' : ''), 'aria-pressed': String(roleFilter === r), onclick: () => { roleFilter = r; update(); } }, `${label} ${n}`)));
    el.views.replaceChildren(...[['cards', GRID, t('view_cards')], ['table', LIST, t('view_table')]].map(([v, ic, label]) =>
      h('button', { type: 'button', class: 'btn small icon-only' + (view === v ? ' on' : ''), 'aria-pressed': String(view === v), 'aria-label': label, title: label, 'data-view': v,
        onclick: () => { view = v; try { localStorage.setItem(VKEY, v); } catch { /* ignore */ } closeMenu(); update(); } }, icon(ic, 18))));
    el.list.hidden = view !== 'cards'; el.tableWrap.hidden = view !== 'table'; el.hint.hidden = view !== 'table';
    el.list.replaceChildren(...(view === 'cards' ? visible.map(card) : []));
    el.tableWrap.querySelector('tbody').replaceChildren(...(view === 'table' ? visible.map(row) : []));
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
  live.watch([`dept:${myDept()}`], (p) => {
    if (p.t !== 'profiles' && p.t !== 'resync') return;
    clearTimeout(liveTimer); liveTimer = setTimeout(() => load({ quiet: true }), 350);
  });

  load();
  return root;
}
