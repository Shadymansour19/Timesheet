import { h } from '../dom.js';
import { t } from '../i18n/index.js';

export function deviceLockView({ onUnlock, onPassword }) {
  const error = h('p', { class: 'error', role: 'alert', 'aria-live': 'polite' });
  let activeController = null;
  let activeAttempt = 0;
  const attemptUnlock = (automatic = false) => {
    activeController?.abort();
    activeController = new AbortController();
    const controller = activeController;
    const attempt = ++activeAttempt;
    error.textContent = '';
    Promise.resolve(onUnlock(controller.signal)).catch(() => {
      if (!automatic && attempt === activeAttempt) error.textContent = t('passkey_failed');
    }).finally(() => {
      if (attempt === activeAttempt) unlock.disabled = false;
    });
  };
  const unlock = h('button', { type: 'button', class: 'btn primary block', onclick: () => attemptUnlock() }, t('passkey_unlock'));
  const password = h('button', { type: 'button', class: 'btn block', onclick: async () => {
    activeController?.abort();
    activeAttempt++;
    unlock.disabled = password.disabled = true;
    try { await onPassword(); }
    catch { error.textContent = t('load_error'); unlock.disabled = password.disabled = false; }
  } }, t('passkey_reset_password'));
  const view = h('section', { class: 'device-lock' },
    h('div', { class: 'device-lock-panel' },
      h('h1', {}, t('passkey_lock_title')),
      h('p', { class: 'muted' }, t('passkey_lock_text')),
      error,
      unlock,
        password));
      requestAnimationFrame(() => attemptUnlock(true));
      return view;
}