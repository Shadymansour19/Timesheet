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

// A short three-note chime made with the Web Audio API (no sound file), plus a short vibration where the phone allows it.
// Browsers only allow sound after the person has used the page, and iPhones / iPads only start (or restart, after the app was in the background) an
// audio context INSIDE a tap. So: every tap, click or key press prepares one shared audio context; the chime uses it when the update arrives, and when
// that is not possible yet (a cold start with no tap, a context the system paused) the chime waits and plays on the person's next tap.
// An iPhone's silent-mode switch and a muted media volume still silence it: then the banner and the tab title are the signal.
let audio = null, pending = false;
const AudioCtx = () => window.AudioContext || window.webkitAudioContext;
const playPending = () => { if (pending && audio?.state === 'running') { pending = false; playNotes(audio); buzz(); } };
function unlockAudio() {
  try {
    const AC = AudioCtx(); if (!AC) return;
    audio ??= new AC();
    if (audio.state !== 'running') audio.resume?.().then(playPending, () => {}); else playPending();
    const src = audio.createBufferSource(); src.buffer = audio.createBuffer(1, 1, 22050); src.connect(audio.destination); src.start(0);       // a silent blip: what iOS wants inside the tap
  } catch { /* no sound is fine */ }
}
export function prepareChime() { for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) addEventListener(ev, unlockAudio, { capture: true, passive: true }); }

function playNotes(ctx) {
  [[784, 0], [988, 0.14], [1319, 0.28]].forEach(([freq, at]) => {       // G5, B5, E6: bright enough for a phone speaker
    const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + at;
    o.type = 'triangle'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
    o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 0.6);
  });
}
const buzz = () => { try { navigator.vibrate?.([160, 80, 160]); } catch { /* not allowed */ } };
function chime() {
  try {
    const AC = AudioCtx(); if (!AC) return;
    if (audio?.state === 'running') { playNotes(audio); buzz(); return; }
    pending = true;                                                                  // not possible right now: the next tap plays it
    if (navigator.userActivation?.hasBeenActive !== false) { audio ??= new AC(); audio.resume?.().then(playPending, () => {}); }
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
    h('button', { type: 'button', class: 'update-x', 'aria-label': t('close'), onclick: () => { banner.remove(); banner = null; pending = false; document.title = baseTitle; } }, '\u00d7'));
  document.body.prepend(banner);
  baseTitle = document.title; document.title = '\u2B06 ' + baseTitle;
  chime();
}
