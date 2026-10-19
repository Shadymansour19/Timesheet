import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { changePassword } from '../auth/session.js';

export function accountView() {
  const msg = h('p', { role: 'status' });
  const cur = h('input', { id: 'cur', type: 'password', autocomplete: 'current-password', required: true });
  const nw = h('input', { id: 'nw', type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
  const cf = h('input', { id: 'cf', type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
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
    h('label', { for: 'cur' }, t('current_password')), cur,
    h('label', { for: 'nw' }, t('new_password')), nw,
    h('label', { for: 'cf' }, t('confirm_password')), cf,
    msg, btn);
}
