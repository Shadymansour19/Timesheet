// "Install this app" bar for phones (shown at the top, again after every page load; the X hides it only until the next refresh).
//  - Android / Chromium: the browser's own install prompt (beforeinstallprompt) is triggered by the Install button.
//  - iPhone / iPad Safari has no install prompt: the bar explains Share -> Add to Home Screen.
// Not shown on desktop screens or when the app already runs installed (standalone).
import { h } from './dom.js';
import { t } from './i18n/index.js';

let deferred = null, hidden = false, ios = false;
const bar = h('div', { class: 'install-bar', role: 'region', hidden: true });
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const phone = () => matchMedia('(max-width: 900px)').matches && matchMedia('(pointer: coarse)').matches;

export function syncInstall() {
  const can = !hidden && !standalone() && phone() && (deferred || ios);
  bar.hidden = !can;
  document.body.classList.toggle('has-install', can);        // the floating language button on the login page moves below the bar
  if (!can) return;
  bar.setAttribute('aria-label', t('install_title'));
  bar.replaceChildren(
    h('span', { class: 'install-text' }, h('strong', {}, t('install_title')), h('small', {}, deferred ? t('install_text') : t('install_ios'))),
    deferred ? h('button', { type: 'button', class: 'btn small primary', onclick: async () => {
      const ev = deferred; deferred = null; hidden = true; syncInstall();
      try { await ev.prompt(); await ev.userChoice; } catch { /* dismissed */ }
    } }, t('install_button')) : null,
    h('button', { type: 'button', class: 'install-x', 'aria-label': t('close'), title: t('close'), onclick: () => { hidden = true; syncInstall(); } }, '✕'));
}

export function initInstall() {
  // iPadOS 13+ reports itself as a Mac, but has a touch screen
  ios = (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && !standalone();
  document.body.prepend(bar);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; syncInstall(); });
  window.addEventListener('appinstalled', () => { deferred = null; hidden = true; syncInstall(); });
  syncInstall();
}
