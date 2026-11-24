import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { signIn } from '../auth/session.js';
import { passwordInput } from '../components/form.js';
import { credit } from '../components/credit.js';
import { openDialog } from '../components/dialog.js';
import { shouldOfferDevicePasskey, registerDevicePasskey } from '../auth/device-passkey.js';
import { icon, KEY } from '../components/icons.js';

export function loginView({ notice, passkeyLogin = false, attemptPasskeyOnLoad = false, onPasskey } = {}) {
  const err = h('p', { class: 'error', role: 'alert' }, notice ? t(notice) : '');
  const username = h('input', { id: 'username', name: 'username', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', required: true });
  const pw = passwordInput({ id: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const password = pw.input;
  const btn = h('button', { type: 'submit', class: 'btn primary block' }, t('sign_in'));
  let passkeyController = null;
  let passkeyAttempt = 0;
  const tryPasskey = async (automatic = false) => {
    passkeyController?.abort();
    passkeyController = new AbortController();
    const controller = passkeyController;
    const attempt = ++passkeyAttempt;
    passkeyBtn.disabled = true;
    err.textContent = '';
    try { await onPasskey?.(controller.signal); }
    catch { if (!automatic && attempt === passkeyAttempt) err.textContent = t('passkey_failed'); }
    finally { if (attempt === passkeyAttempt) passkeyBtn.disabled = false; }
  };
  const passkeyBtn = passkeyLogin ? h('button', { type: 'button', class: 'btn passkey-icon', title: t('passkey_sign_in'), 'aria-label': t('passkey_sign_in'), onclick: () => tryPasskey() }, icon(KEY, 20)) : null;
  const passwordRow = h('div', { class: 'login-password-row' }, pw.wrap, passkeyBtn);

  const form = h('form', { class: 'card form', onsubmit: async (e) => {
    e.preventDefault();
    passkeyController?.abort(); passkeyAttempt++;
    if (passkeyBtn) passkeyBtn.disabled = false;
    btn.disabled = true; btn.textContent = t('signing_in'); err.textContent = '';
    const key = await signIn(username.value, password.value);
    if (key) { err.textContent = t(key); btn.disabled = false; btn.textContent = t('sign_in'); password.value = ''; password.focus(); }
    else if (shouldOfferDevicePasskey()) openDialog({
      title: t('passkey_offer_title'),
      content: h('p', { class: 'muted' }, t('passkey_offer_text')),
      buttons: [
        { label: t('not_now') },
        { label: t('passkey_enable'), kind: 'primary', onClick: registerDevicePasskey },
      ],
    });
  } },
    h('h1', {}, t('app_name')),
    h('label', { for: 'username' }, t('username')), username,
    h('label', { for: 'password' }, t('password')), passwordRow,
    err, btn);
  const view = h('div', {}, form, credit());
  if (attemptPasskeyOnLoad && passkeyLogin) requestAnimationFrame(() => tryPasskey(true));
  return view;
}
