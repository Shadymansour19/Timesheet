// "New version available" banner. The service worker waits (registerType 'prompt') instead of swapping the app under a running page; the person
// taps Refresh when it suits them. A newer build is noticed through /version.json (polled every 30 s while visible and on every return to the app),
// without waiting for the service worker to download the new files; the SW's own 'waiting' event is the second way to learn about it.
import { registerSW } from 'virtual:pwa-register';
import { h } from './dom.js';
import { t } from './i18n/index.js';
import { icon, REFRESH } from './components/icons.js';

let banner = null;

// This build's id (set at build time) and the polling rhythm. The page asks /version.json (never cached) every 30 s while it is visible, and at once when it
// starts, comes back to the foreground, regains focus or the network returns: a new deploy is noticed within seconds instead of waiting for the hourly worker check.
const BUILD = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '';
const pollMs = () => { try { return Number(localStorage.getItem('ts.versionPollMs')) || 30000; } catch { return 30000; } };      // (the knob is for the test)
let swReg = null, updateSW = null;

async function newerBuildExists() {
  if (!BUILD || !navigator.onLine) return false;
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return false;
    const id = (await r.json())?.id;
    return typeof id === 'string' && id !== BUILD;
  } catch { return false; }
}

export function initUpdates() {
  prepareChime();
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() { show(); },
    onRegisteredSW(_url, reg) { swReg = reg ?? null; },
  });
  const check = async () => {
    if (banner || document.visibilityState !== 'visible') return;
    if (await newerBuildExists()) { show(); swReg?.update().catch(() => {}); }         // tell the browser to fetch the new worker NOW, so Refresh is ready when tapped
    else if (navigator.onLine) swReg?.update().catch(() => {});                        // (also the plain worker check, in case version.json is unreachable)
  };
  check();
  setInterval(check, pollMs());
  document.addEventListener('visibilitychange', check);
  addEventListener('focus', check); addEventListener('online', check);
}

// Refresh: if the new worker is already waiting, switch to it; otherwise fetch it first (a few seconds), then switch; as a last resort reload.
async function applyUpdate(btn) {
  btn.disabled = true; btn.textContent = t('update_working');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const reg = swReg ?? await navigator.serviceWorker?.getRegistration();
    if (!reg?.waiting) { reg?.update().catch(() => {}); for (let i = 0; i < 50 && !reg?.waiting; i++) await sleep(300); }
    if (reg?.waiting) { updateSW(true); return; }
  } catch { /* fall through */ }
  location.reload();
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
function show() {
  if (banner) return;
  // a bar across the TOP of the page (sticky, pushes the page down): impossible to miss on a desktop, and the tab title says it too
  banner = h('div', { class: 'update-banner', role: 'alert' },
    h('span', { class: 'update-ico', 'aria-hidden': 'true' }, icon(REFRESH, 22)),
    h('strong', { class: 'update-text' }, t('update_available')),
    h('button', { type: 'button', class: 'update-go', id: 'update-now', onclick: (e) => applyUpdate(e.currentTarget) }, t('update_refresh')),
    h('button', { type: 'button', class: 'update-x', 'aria-label': t('close'), onclick: () => { banner.remove(); banner = null; pending = false; document.title = baseTitle; } }, '\u00d7'));
  document.body.prepend(banner);
  baseTitle = document.title; document.title = '\u2B06 ' + baseTitle;
  chime();
}
