// "New version available" banner. The service worker waits (registerType 'prompt') instead of swapping the app under a running
// page; the person taps Refresh when it suits them. The worker also checks for a new build on start, hourly, and whenever the app
// comes back to the foreground, so a long-open installed app finds out too.
import { registerSW } from 'virtual:pwa-register';
import { h } from './dom.js';
import { t } from './i18n/index.js';
import { icon, REFRESH } from './components/icons.js';

let banner = null;

export function initUpdates() {
  prepareChime();
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

// a short, soft two-note chime made with the Web Audio API (no sound file), on every device that allows sound.
// Browsers only allow sound after the person has used the page, and iPhones / iPads only let an audio context start INSIDE a tap: so the first tap, click or key
// press of every session prepares ("unlocks") one shared audio context, and the chime later reuses it (the update arrives from the background, not from a tap).
// On an iPhone the silent-mode switch still mutes it; with no activity at all it stays silent and the banner is the only signal.
let audio = null;
const AudioCtx = () => window.AudioContext || window.webkitAudioContext;
function unlockAudio() {
  try {
    const AC = AudioCtx(); if (!AC) return;
    audio ??= new AC();
    audio.resume?.().catch(() => {});
    const src = audio.createBufferSource(); src.buffer = audio.createBuffer(1, 1, 22050); src.connect(audio.destination); src.start(0);       // a silent blip: what iOS wants inside the tap
    if (audio.state === 'running') for (const ev of UNLOCK_EVENTS) removeEventListener(ev, unlockAudio, true);
  } catch { /* no sound is fine */ }
}
const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'click', 'keydown'];
export function prepareChime() { for (const ev of UNLOCK_EVENTS) addEventListener(ev, unlockAudio, { capture: true, passive: true }); }

function playNotes(ctx) {
  [[880, 0], [1319, 0.16]].forEach(([freq, at]) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + at;
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
    o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 0.5);
  });
}
function chime() {
  try {
    const AC = AudioCtx(); if (!AC) return;
    const ready = audio && audio.state === 'running';
    if (!ready && navigator.userActivation && !navigator.userActivation.hasBeenActive) return;      // nobody has touched the page: the browser would refuse anyway
    audio ??= new AC();
    if (audio.state === 'running') playNotes(audio);
    else audio.resume?.().then(() => { if (audio.state === 'running') playNotes(audio); }).catch(() => {});
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
