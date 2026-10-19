import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { state } from '../auth/session.js';
import { fetchDeptPeople, updateProfile, setUserRole, callFn } from '../api/admin.js';
import { explain } from '../api/errors.js';
import { openDialog, confirmDialog } from '../components/dialog.js';
import { field, randomPassword } from '../components/form.js';
import { toast } from '../components/toast.js';

// Shared by the admin (own department) and the super admin (admins of any department).
export function personFields(initial = {}, { withLogin = false } = {}) {
  const f = {
    username: withLogin ? field(t('username'), { required: true, autocapitalize: 'none', autocomplete: 'off', pattern: '[a-z0-9._\\-]{3,32}', minlength: 3, maxlength: 32 }) : null,
    password: withLogin ? field(t('temp_password'), { type: 'text', required: true, minlength: 8, autocomplete: 'off', value: randomPassword() }) : null,
    full_name: field(t('full_name'), { required: true, value: initial.full_name ?? '' }),
    opr: field(t('opr'), { required: true, value: initial.opr ?? '' }),
    level: field(t('level'), { type: 'number', min: 0, step: 1, inputmode: 'numeric', value: initial.level ?? '' }),
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
  let people = [];

  async function load() {
    try { people = await fetchDeptPeople(me.department_id); }
    catch (e) { root.replaceChildren(h('p', { class: 'error' }, explain(e))); return; }
    draw();
  }

  function addUser() {
    const p = personFields({}, { withLogin: true });
    openDialog({
      title: t('add_user'), content: h('div', { class: 'form' }, p.rows, h('p', { class: 'muted' }, t('share_password_hint'))),
      buttons: [{ label: t('cancel') }, { label: t('add'), kind: 'primary', onClick: async () => {
        await callFn('create_user', {
          username: p.f.username.input.value, password: p.f.password.input.value, full_name: p.f.full_name.input.value,
          opr: p.f.opr.input.value, level: p.level(), department_id: me.department_id, role: 'user',
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
        await updateProfile(person.id, p.f.full_name.input.value.trim(), p.f.opr.input.value.trim(), p.level());
        await load();
      } }],
    });
  }

  function card(p) {
    const self = p.id === me.id;
    return h('li', { class: 'person card' },
      h('div', { class: 'pinfo' },
        h('strong', {}, p.full_name), h('span', { class: 'badge' + (p.role === 'admin' ? ' admin' : '') }, t('role_' + p.role)),
        h('span', { class: 'muted' }, `${p.username} · ${t('opr')} ${p.opr ?? '-'} · ${t('level')} ${p.level ?? '-'}`)),
      h('div', { class: 'pactions' },
        h('button', { class: 'btn small', onclick: () => editUser(p) }, t('edit_data')),
        self ? null : h('button', { class: 'btn small', onclick: () => resetPasswordDialog(p) }, t('reset_password')),
        p.role === 'user' ? h('button', { class: 'btn small', onclick: () => changeRole(p, 'admin', load) }, t('promote')) : null,
        p.role === 'admin' && !self ? h('button', { class: 'btn small', onclick: () => changeRole(p, 'user', load) }, t('demote')) : null,
        self ? null : h('button', { class: 'btn small danger', onclick: () => deletePerson(p, load) }, t('delete'))));
  }

  function draw() {
    root.replaceChildren(
      h('div', { class: 'cal-head' }, h('h2', {}, `${t('nav_users')} (${people.length})`),
        h('button', { class: 'btn small primary', onclick: addUser }, t('add_user'))),
      h('ul', { class: 'plist' }, people.map(card)));
  }

  load();
  return root;
}
