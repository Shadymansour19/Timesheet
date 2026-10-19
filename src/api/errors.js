import { t } from '../i18n/index.js';

// Turn an RPC / Edge Function error into a message the user can act on.
export function explain(e) {
  const code = e?.code, status = e?.status;
  if (code === '42501' || status === 403) return t('err_forbidden');
  if (code === '23505' || status === 409) return t('err_duplicate');
  if (code === '22023' || status === 400) return e.message || t('save_failed');
  if (!navigator.onLine) return t('offline');
  return t('save_failed');
}
