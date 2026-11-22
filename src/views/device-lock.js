import { h } from '../dom.js';
import { t } from '../i18n/index.js';

export function deviceLockView({ onUnlock, onPassword }) {
  const error = h('p', { class: 'error', role: 'alert', 'aria-live': 'polite' });
  const unlock = h('button', { type: 'button', class: 'btn primary block', onclick: async () => {
    unlock.disabled = password.disabled = true;
    error.textContent = '';
    try { await onUnlock(); }
    catch { error.textContent = t('passkey_failed'); unlock.disabled = password.disabled = false; }
  } }, t('passkey_unlock'));
  const password = h('button', { type: 'button', class: 'btn block', onclick: async () => {
    unlock.disabled = password.disabled = true;
    try { await onPassword(); }
    catch { error.textContent = t('load_error'); unlock.disabled = password.disabled = false; }
  } }, t('passkey_reset_password'));
  return h('section', { class: 'device-lock' },
    h('div', { class: 'device-lock-panel' },
      h('h1', {}, t('passkey_lock_title')),
      h('p', { class: 'muted' }, t('passkey_lock_text')),
      error,
      unlock,
      password));
}