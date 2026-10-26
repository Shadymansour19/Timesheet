// Super admins and super managers (people without a department). Super admin only.
import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { state } from '../auth/session.js';
import { fetchSuperUsers, callFn } from '../api/admin.js';
import { explain } from '../api/errors.js';
import { openDialog } from '../components/dialog.js';
import { toast } from '../components/toast.js';
import { openBulkAdd } from './bulk-users.js';
import { personFields, resetPasswordDialog, deletePerson } from './users.js';

export function superUsersView() {
  const root = h('section', { class: 'depts' });
  let people = [];

  async function load() {
    try { people = await fetchSuperUsers(); }
    catch (e) { root.replaceChildren(h('p', { class: 'error' }, explain(e))); return; }
    draw();
  }

  // a super manager (read-only, every department) or another super admin: no department, no timesheet
  function addSuper() {
    const p = personFields({ role: 'manager' }, { withLogin: true, isNew: true, roles: ['super_manager', 'super_admin'] });
    for (const k of ['contract_no', 'work_location', 'residence', 'position', 'y_allowed', 'job_title', 'level', 'payroll']) { p.f[k].row.hidden = true; p.f[k].input.required = false; }
    openDialog({
      title: t('add_super_manager'), content: h('div', { class: 'form' }, p.f.username.row, p.f.password.row, p.f.full_name.row, p.f.opr.row, p.f.role.row, h('p', { class: 'muted' }, t('super_manager_hint')), h('p', { class: 'muted' }, t('share_password_hint'))),
      buttons: [{ label: t('cancel') }, { label: t('add'), kind: 'primary', onClick: async () => {
        await callFn('create_user', { username: p.f.username.input.value, password: p.f.password.input.value, full_name: p.f.full_name.input.value, opr: p.f.opr.input.value, role: p.role() });
        toast(t('user_created'), 'success'); await load();
      } }],
    });
  }

  function row(p) {
    const self = p.id === state.profile.id;
    return h('li', { class: 'person' },
      h('div', { class: 'pinfo' }, h('strong', {}, p.full_name), h('span', { class: 'badge admin' }, t('role_' + p.role)), h('span', { class: 'muted' }, p.username)),
      h('div', { class: 'pactions' },
        self ? null : h('button', { class: 'btn small', onclick: () => resetPasswordDialog(p) }, t('reset_password')),
        self ? null : h('button', { class: 'btn small danger', onclick: () => deletePerson(p, load) }, t('delete'))));
  }

  function draw() {
    root.replaceChildren(
      h('div', { class: 'cal-head' }, h('h2', {}, `${t('nav_super')} (${people.length})`),
        h('div', { class: 'actions' },
          h('button', { class: 'btn small', id: 'bulk-super', onclick: () => openBulkAdd({ superUsers: true, onDone: load }) }, t('bulk_add_super')),
          h('button', { class: 'btn small primary', id: 'add-super', onclick: addSuper }, t('add_super_manager')))),
      h('p', { class: 'muted' }, t('super_manager_hint')),
      h('ul', { class: 'plist' }, people.map(row)));
  }

  load();
  return root;
}
