import { h } from '../dom.js';
import { t, otherLang, setLang } from '../i18n/index.js';
import { state, signOut, signOutAll, switchTo, addAccount, removeAccount, listAccounts } from '../auth/session.js';
import { navFor } from '../router.js';
import { openDialog, confirmDialog } from './dialog.js';
import { eligible as notifyEligible, enabled as notifyOn, setEnabled as setNotify } from '../notify.js';
import { icon, INFO, BELL, BUILDING, CHEVRON_UPDOWN, PLUS, KEY, LOGOUT, ARROW_LEFT, SUN, MOON, MONITOR } from './icons.js';
import { getTheme, setTheme } from '../theme.js';
import { field } from './form.js';
import { choice } from './choice.js';
import { acting, setActing } from '../acting.js';
import { toast } from './toast.js';
import { credit } from './credit.js';
import { guideAvailable, startGuide } from './guide.js';

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

// Light / Dark / System; applies at once and is remembered on this device.
function themeRow() {
  const opts = [['light', SUN, t('theme_light')], ['dark', MOON, t('theme_dark')], ['system', MONITOR, t('theme_system')]];
  const btns = opts.map(([v, ic, label]) => h('button', { type: 'button', class: 'btn small', title: label, 'aria-label': label, 'data-theme-opt': v,
    onclick: () => { setTheme(v); paint(); } }, icon(ic, 16), h('span', {}, label)));
  const paint = () => btns.forEach((b) => { const on = b.dataset.themeOpt === getTheme(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  paint();
  return h('div', { class: 'menu-theme' }, h('p', { class: 'menu-title muted' }, t('theme')), h('div', { class: 'seg theme-seg', role: 'group', 'aria-label': t('theme') }, btns));
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
        // our own dialog (never the browser's): removing an account is easy to hit by accident and means typing the password again
        const yes = await confirmDialog(t('remove_account_title').replaceAll('{name}', a.full_name),
          { danger: true, confirmLabel: t('remove'), detail: t('remove_account_detail') });
        if (!yes) return;
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
      guideAvailable() ? h('button', { class: 'menu-item', type: 'button', id: 'guide-open', onclick: () => { close(); startGuide({ landing: navFor()[0]?.path }); } }, icon(INFO, 18), t('guide_menu')) : null,
      themeRow(),
      notifyEligible() ? h('button', { class: 'menu-item', type: 'button', 'aria-pressed': String(notifyOn()), onclick: async () => {
        const r = await setNotify(!notifyOn());
        if (r === 'denied') toast(t('notify_denied'));
        setTimeout(() => { const fresh = accountMenu(); fresh.open = true; det.replaceWith(fresh); }, 0);      // after this click has finished bubbling (the outside-click handler would close the new menu)
      } }, icon(BELL, 18), `${t('notify_menu')}: ${notifyOn() ? t('on') : t('off')}`) : null,
      h('hr'),
      h('button', { class: 'menu-item', type: 'button', onclick: () => { close(); signOut(); } }, withFlip(icon(LOGOUT, 18)), t('sign_out')),
      accounts.length > 1 ? h('button', { class: 'menu-item danger-text', type: 'button', onclick: () => { close(); signOutAll(); } }, withFlip(icon(LOGOUT, 18)), t('sign_out_all')) : null,
      h('hr'), credit({ compact: true })));

  if (closeOnOutside) document.removeEventListener('click', closeOnOutside);
  closeOnOutside = (e) => { if (!det.contains(e.target)) det.open = false; };
  document.addEventListener('click', closeOnOutside);
  return det;
}

// Super admin only: which department the admin tabs act for
function departmentSwitcher(onChange) {
  return h('button', { class: 'btn small dept-switch', type: 'button', title: t('acting_as'), onclick: () => {
    const pick = choice(t('acting_as'), acting.list.map((d) => ({ value: d.id, label: d.name })), acting.dept);
    openDialog({ title: t('switch_department'), content: h('div', { class: 'form' }, pick.row),
      buttons: [{ label: t('cancel') }, { label: t('switch'), kind: 'primary', onClick: async () => { if (pick.value && pick.value !== acting.dept) { setActing(pick.value); onChange(); } } }] });
  } }, icon(BUILDING, 16), h('span', {}, acting.name || '—'), icon(CHEVRON_UPDOWN, 14));
}

export function shell(content, { onLang }) {
  const here = location.hash.replace(/^#/, '');
  // Top tabs on wide screens; on phones the same links become an icon bar fixed to the bottom (hidden when there is only one tab).
  const items = navFor();
  // Phone bar: the landing tab is the raised round button in the middle (notch), the other tabs sit left / right of it. The DOM order
  // (landing tab, left ones, gap, right ones) equals the route order, so the wide-screen top tabs are unchanged.
  const link = (r, cls = '') => h('a', { href: '#' + r.path, class: (cls + (here === r.path ? ' active' : '')).trim(), title: t(r.label), 'aria-current': here === r.path ? 'page' : false },
    r.icon ? h('span', { class: 'ico' }, icon(r.icon, 22)) : null, h('span', { class: 'lbl' }, t(r.label)));
  const [primary, ...others] = items, cut = Math.ceil(others.length / 2);
  // only a FIVE-tab bar gets the raised middle button; with fewer tabs the bar is flat (all tabs equal, in route order)
  const raised = items.length === 5;
  const nav = h('nav', { class: 'nav' + (items.length < 2 ? ' solo' : '') + (raised ? ' raised' : ''), style: `--n:${Math.max(items.length, 1)}`, 'aria-label': t('app_name') },
    ...(raised
      ? [link(primary, 'nav-center'), ...others.slice(0, cut).map((r) => link(r)), h('span', { class: 'nav-gap', 'aria-hidden': 'true' }), ...others.slice(cut).map((r) => link(r))]
      : items.map((r) => link(r))));
  const home = navFor()[0];
  // sub-pages (change password, one person's timesheet) get a Back link to where they came from
  const sub = here === '/account' || here.startsWith('/person/');
  const back = sub && home
    ? h('a', { class: 'back-link', href: here.startsWith('/person/') ? '#/users' : '#' + home.path,
        onclick: (e) => { if (here.startsWith('/person/') && history.length > 1) { e.preventDefault(); history.back(); } } },
      withFlip(icon(ARROW_LEFT, 18)), t('back'))
    : null;

  return h('div', { class: 'shell' },
    h('header', { class: 'topbar' },
      accountMenu(),
      h('div', { class: 'actions' },
        acting.active && ['super_admin', 'super_manager'].includes(state.profile.role) ? departmentSwitcher(onLang) : null,
        h('button', { class: 'btn small lang-btn', onclick: () => { setLang(otherLang()); onLang(); } }, t('language')))),
    nav,
    h('main', { class: 'content' }, back, content, credit()));       // the Developed by line closes every working screen (never part of an export)
}
