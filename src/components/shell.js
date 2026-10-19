import { h } from '../dom.js';
import { t, otherLang, setLang } from '../i18n/index.js';
import { state, signOut, signOutAll, switchTo, addAccount, removeAccount, listAccounts } from '../auth/session.js';
import { navFor } from '../router.js';
import { openDialog } from './dialog.js';
import { icon, CHEVRON_UPDOWN, PLUS, KEY, LOGOUT, ARROW_LEFT } from './icons.js';
import { field } from './form.js';
import { toast } from './toast.js';

const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
let closeOnOutside;
const withFlip = (svg) => { svg.classList.add('flip'); return svg; };   // direction arrows mirror in right-to-left

function addAccountDialog() {
  const user = field(t('username'), { required: true, autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
  const pass = field(t('password'), { type: 'password', required: true, autocomplete: 'current-password' });
  openDialog({
    title: t('add_account'), content: h('div', { class: 'form' }, user.row, pass.row),
    buttons: [{ label: t('cancel') }, { label: t('sign_in'), kind: 'primary', onClick: async () => {
      const key = await addAccount(user.input.value, pass.input.value);
      if (key) throw Object.assign(new Error(t(key)), { code: '22023' });
    } }],
  });
}

function accountMenu() {
  const p = state.profile;
  const accounts = listAccounts();
  const det = h('details', { class: 'acct' });
  const close = () => { det.open = false; };

  const row = (a) => {
    const active = a.id === p.id;
    return h('li', { class: 'acct-row' + (active ? ' active' : '') },
      h('button', { class: 'acct-pick', type: 'button', disabled: active, 'aria-current': active ? 'true' : false, onclick: async () => {
        close();
        const key = await switchTo(a.id);
        if (key) toast(t(key));
      } },
      h('span', { class: 'avatar' }, initials(a.full_name)),
      h('span', { class: 'acct-text' }, h('strong', {}, a.full_name), h('small', { class: 'muted' }, `${t('role_' + a.role)} · ${a.username}`)),
      active ? h('span', { class: 'tick', 'aria-label': t('current_account') }, '✓') : null),
      active ? null : h('button', { class: 'acct-x', type: 'button', title: t('remove_account'), 'aria-label': `${t('remove_account')}: ${a.full_name}`, onclick: async () => {
        await removeAccount(a.id);
        const fresh = accountMenu(); fresh.open = true; det.replaceWith(fresh); }
      }, '✕'));
  };

  det.append(
    h('summary', { class: 'who', 'aria-label': t('account_menu') },
      h('span', { class: 'avatar big' }, initials(p.full_name)),
      h('span', { class: 'acct-text' }, h('strong', {}, p.full_name), h('span', { class: 'muted' }, t('role_' + p.role))),
      h('span', { class: 'caret', 'aria-hidden': 'true' }, icon(CHEVRON_UPDOWN, 18))),
    h('div', { class: 'menu' },
      h('p', { class: 'menu-title muted' }, t('accounts_here')),
      h('ul', { class: 'acct-list' }, accounts.map(row)),
      h('button', { class: 'menu-item', type: 'button', onclick: () => { close(); addAccountDialog(); } }, icon(PLUS, 18), t('add_account')),
      h('a', { class: 'menu-item', href: '#/account', onclick: close }, icon(KEY, 18), t('change_password')),
      h('hr'),
      h('button', { class: 'menu-item', type: 'button', onclick: () => { close(); signOut(); } }, withFlip(icon(LOGOUT, 18)), t('sign_out')),
      accounts.length > 1 ? h('button', { class: 'menu-item danger-text', type: 'button', onclick: () => { close(); signOutAll(); } }, withFlip(icon(LOGOUT, 18)), t('sign_out_all')) : null));

  if (closeOnOutside) document.removeEventListener('click', closeOnOutside);
  closeOnOutside = (e) => { if (!det.contains(e.target)) det.open = false; };
  document.addEventListener('click', closeOnOutside);
  return det;
}

export function shell(content, { onLang }) {
  const here = location.hash.replace(/^#/, '');
  const nav = h('nav', { class: 'nav' },
    navFor().map((r) => h('a', { href: '#' + r.path, class: here === r.path ? 'active' : '' }, t(r.label))));
  const home = navFor()[0];
  const back = here === '/account' && home
    ? h('a', { class: 'back-link', href: '#' + home.path }, withFlip(icon(ARROW_LEFT, 18)), t('back'))
    : null;

  return h('div', { class: 'shell' },
    h('header', { class: 'topbar' },
      accountMenu(),
      h('div', { class: 'actions' },
        h('button', { class: 'btn small', onclick: () => { setLang(otherLang()); onLang(); } }, t('language')))),
    nav,
    h('main', { class: 'content' }, back, content));
}
