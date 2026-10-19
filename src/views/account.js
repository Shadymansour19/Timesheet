import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { changePassword } from '../auth/session.js';
import { passwordInput } from '../components/form.js';

export function accountView() {
  const msg = h('p', { role: 'status' });
  const curP = passwordInput({ id: 'cur', autocomplete: 'current-password', required: true });
  const nwP = passwordInput({ id: 'nw', autocomplete: 'new-password', required: true, minlength: 8 });
  const cfP = passwordInput({ id: 'cf', autocomplete: 'new-password', required: true, minlength: 8 });
  const [cur, nw, cf] = [curP.input, nwP.input, cfP.input];
  const btn = h('button', { type: 'submit', class: 'btn primary' }, t('save'));

  const show = (text, ok) => { msg.className = ok ? 'success' : 'error'; msg.textContent = text; };

  return h('form', { class: 'card form', onsubmit: async (e) => {
    e.preventDefault();
    if (nw.value.length < 8) return show(t('password_short'), false);
    if (nw.value !== cf.value) return show(t('password_mismatch'), false);
    btn.disabled = true;
    const key = await changePassword(cur.value, nw.value);
    btn.disabled = false;
    if (key) return show(t(key), false);
    cur.value = nw.value = cf.value = '';
    show(t('password_changed'), true);
  } },
    h('h2', {}, t('change_password')),
    h('label', { for: 'cur' }, t('current_password')), curP.wrap,
    h('label', { for: 'nw' }, t('new_password')), nwP.wrap,
    h('label', { for: 'cf' }, t('confirm_password')), cfP.wrap,
    msg,
    h('div', { class: 'form-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => { location.hash = ''; } }, t('cancel')),   // '' resolves to the role's home page
      btn));
}
