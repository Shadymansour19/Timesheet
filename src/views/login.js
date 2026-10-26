import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { signIn } from '../auth/session.js';
import { passwordInput } from '../components/form.js';
import { copyright } from '../components/copyright.js';

export function loginView({ notice } = {}) {
  const err = h('p', { class: 'error', role: 'alert' }, notice ? t(notice) : '');
  const username = h('input', { id: 'username', name: 'username', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', required: true });
  const pw = passwordInput({ id: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const password = pw.input;
  const btn = h('button', { type: 'submit', class: 'btn primary block' }, t('sign_in'));

  const form = h('form', { class: 'card form', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = t('signing_in'); err.textContent = '';
    const key = await signIn(username.value, password.value);
    if (key) { err.textContent = t(key); btn.disabled = false; btn.textContent = t('sign_in'); password.value = ''; password.focus(); }
  } },
    h('h1', {}, t('app_name')),
    h('label', { for: 'username' }, t('username')), username,
    h('label', { for: 'password' }, t('password')), pw.wrap,
    err, btn);
  return h('div', {}, form, copyright());
}
