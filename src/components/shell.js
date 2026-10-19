import { h } from '../dom.js';
import { t, otherLang, setLang } from '../i18n/index.js';
import { state, signOut } from '../auth/session.js';
import { navFor } from '../router.js';

export function shell(content, { onLang }) {
  const p = state.profile;
  const here = location.hash.replace(/^#/, '');
  const nav = h('nav', { class: 'nav' },
    navFor().map((r) => h('a', { href: '#' + r.path, class: here === r.path ? 'active' : '' }, t(r.label))),
    h('a', { href: '#/account', class: here === '/account' ? 'active' : '' }, t('change_password')));

  return h('div', { class: 'shell' },
    h('header', { class: 'topbar' },
      h('div', { class: 'who' }, h('strong', {}, p.full_name), h('span', { class: 'muted' }, t('role_' + p.role))),
      h('div', { class: 'actions' },
        h('button', { class: 'btn small', onclick: () => { setLang(otherLang()); onLang(); } }, t('language')),
        h('button', { class: 'btn small', onclick: signOut }, t('sign_out')))),
    nav,
    h('main', { class: 'content' }, content));
}
