// "New version available" banner. The service worker waits (registerType 'prompt') instead of swapping the app under a running
// page; the person taps Refresh when it suits them. The worker also checks for a new build on start, hourly, and whenever the app
// comes back to the foreground, so a long-open installed app finds out too.
import { registerSW } from 'virtual:pwa-register';
import { h } from './dom.js';
import { t } from './i18n/index.js';
import { icon, REFRESH } from './components/icons.js';

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

// a short, soft two-note chime made with the Web Audio API (no sound file). Browsers only allow sound after the person has used the page
// (a click or a key press), which is almost always true for an app that has been open for a while; otherwise it stays silent.
function chime() {
  try {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = new AC(); ctx.resume?.().catch(() => {});
    [[880, 0], [1319, 0.16]].forEach(([freq, at]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + at;
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
      o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 0.5);
    });
    setTimeout(() => ctx.close?.().catch(() => {}), 1200);
  } catch { /* no sound is fine */ }
}

let baseTitle = '';
function show(updateSW) {
  if (banner) return;
  // a bar across the TOP of the page (sticky, pushes the page down): impossible to miss on a desktop, and the tab title says it too
  banner = h('div', { class: 'update-banner', role: 'alert' },
    h('span', { class: 'update-ico', 'aria-hidden': 'true' }, icon(REFRESH, 22)),
    h('strong', { class: 'update-text' }, t('update_available')),
    h('button', { type: 'button', class: 'update-go', id: 'update-now', onclick: () => updateSW(true) }, t('update_refresh')),
    h('button', { type: 'button', class: 'update-x', 'aria-label': t('close'), onclick: () => { banner.remove(); banner = null; document.title = baseTitle; } }, '\u00d7'));
  document.body.prepend(banner);
  baseTitle = document.title; document.title = '\u2B06 ' + baseTitle;
  chime();
}
