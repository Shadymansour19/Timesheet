// "New version available" banner. The service worker waits (registerType 'prompt') instead of swapping the app under a running
// page; the person taps Refresh when it suits them. The worker also checks for a new build on start, hourly, and whenever the app
// comes back to the foreground, so a long-open installed app finds out too.
import { registerSW } from 'virtual:pwa-register';
import { h } from './dom.js';
import { t } from './i18n/index.js';

let banner = null;

export function initUpdates() {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() { show(updateSW); },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => { if (navigator.onLine) reg.update().catch(() => {}); };
      setInterval(check, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    },
  });
}

function show(updateSW) {
  if (banner) return;
  banner = h('div', { class: 'update-banner', role: 'status', 'aria-live': 'polite' },
    h('span', {}, t('update_available')),
    h('button', { type: 'button', class: 'btn small primary', id: 'update-now', onclick: () => updateSW(true) }, t('update_refresh')),
    h('button', { type: 'button', class: 'btn small', 'aria-label': t('close'), onclick: () => { banner.remove(); banner = null; } }, '×'));
  document.body.append(banner);
}
