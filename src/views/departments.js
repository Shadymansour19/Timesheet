import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { fetchDepartments, fetchAllPeople, createDepartment, renameDepartment, callFn } from '../api/admin.js';
import { explain } from '../api/errors.js';
import { openDialog } from '../components/dialog.js';
import { field } from '../components/form.js';
import { toast } from '../components/toast.js';
import { openReportSettings } from '../components/report-settings.js';
import { personFields, resetPasswordDialog, deletePerson, changeRole } from './users.js';

export function departmentsView() {
  const root = h('section', { class: 'depts' });
  let depts = [], people = [];
  const open = new Set();

  async function load() {
    try { [depts, people] = await Promise.all([fetchDepartments(), fetchAllPeople()]); }
    catch (e) { root.replaceChildren(h('p', { class: 'error' }, explain(e))); return; }
    draw();
  }

  function nameDialog(title, initial, action) {
    const name = field(t('department_name'), { required: true, maxlength: 80, value: initial });
    openDialog({
      title, content: h('div', { class: 'form' }, name.row),
      buttons: [{ label: t('cancel') }, { label: t('save'), kind: 'primary', onClick: async () => { await action(name.input.value); await load(); } }],
    });
  }

  function addAdmin(dept) {
    const p = personFields({}, { withLogin: true, isNew: true });
    openDialog({
      title: `${t('add_admin')} – ${dept.name}`, wide: 'xl', content: h('div', { class: 'form two-col' }, p.rows, h('p', { class: 'muted' }, t('share_password_hint'))),
      buttons: [{ label: t('cancel') }, { label: t('add'), kind: 'primary', onClick: async () => {
        await callFn('create_user', {
          username: p.f.username.input.value, password: p.f.password.input.value, full_name: p.f.full_name.input.value,
          opr: p.f.opr.input.value, level: p.level(), department_id: dept.id, role: 'admin',
          job_title: p.f.job_title.input.value, contract_no: p.f.contract_no.input.value,
          work_location: p.f.work_location.input.value, residence: p.f.residence.input.value, position: p.f.position.input.value, payroll: p.f.payroll.input.value, y_allowed: p.f.y_allowed.input.value === 'yes',
        });
        open.add(dept.id); toast(t('user_created'), 'success'); await load();
      } }],
    });
  }

  function row(p) {
    return h('li', { class: 'person' },
      h('div', { class: 'pinfo' }, h('strong', {}, p.full_name), h('span', { class: 'badge' + (p.role === 'admin' ? ' admin' : '') }, t('role_' + p.role)),
        h('span', { class: 'muted' }, `${p.username} · ${t('opr')} ${p.opr || '-'}`)),
      h('div', { class: 'pactions' },
        p.role === 'user' ? h('button', { class: 'btn small', onclick: () => changeRole(p, 'admin', load) }, t('promote')) : null,
        p.role === 'admin' ? h('button', { class: 'btn small', onclick: () => changeRole(p, 'user', load) }, t('demote')) : null,
        p.role === 'admin' ? h('button', { class: 'btn small', onclick: () => resetPasswordDialog(p) }, t('reset_password')) : null,
        p.role === 'admin' ? h('button', { class: 'btn small danger', onclick: () => deletePerson(p, load) }, t('delete')) : null));
  }

  function draw() {
    root.replaceChildren(
      h('div', { class: 'cal-head' }, h('h2', {}, t('nav_departments')),
        h('button', { class: 'btn small primary', onclick: () => nameDialog(t('add_department'), '', createDepartment) }, t('add_department'))),
      ...depts.map((d) => {
        const members = people.filter((p) => p.department_id === d.id);
        const admins = members.filter((p) => p.role === 'admin');
        const det = h('details', { class: 'card dept', open: open.has(d.id), 'data-dept': d.id },
          h('summary', {}, h('strong', {}, d.name), h('span', { class: 'muted' }, ` · ${admins.length} ${t('admins')} · ${members.length} ${t('people')}`)),
          h('div', { class: 'pactions top' },
            h('button', { class: 'btn small', onclick: () => nameDialog(t('rename_department'), d.name, (n) => renameDepartment(d.id, n)) }, t('rename')),
            h('button', { class: 'btn small', onclick: () => openReportSettings({ dept: d, onSaved: load }) }, t('report_settings')),
            h('button', { class: 'btn small primary', onclick: () => addAdmin(d) }, t('add_admin'))),
          h('ul', { class: 'plist' }, members.map(row)));
        det.addEventListener('toggle', () => (det.open ? open.add(d.id) : open.delete(d.id)));
        return det;
      }));
  }

  load();
  return root;
}
