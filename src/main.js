import './styles/main.css';
import { h } from './dom.js';
import { applyDir, t, otherLang, setLang } from './i18n/index.js';
import { state, restore, onChange, takeNotice, refreshProfile } from './auth/session.js';
import * as live from './live.js';
import { applyTheme } from './theme.js';
import { loginView } from './views/login.js';
import { resolve } from './router.js';
import { shell } from './components/shell.js';
import { initInstall, syncInstall } from './install.js';
import { acting, ensureActing } from './acting.js';
import { startNotifications, stopNotifications } from './notify.js';
import { fetchDepartments } from './api/admin.js';

const root = document.getElementById('app');
const banner = h('div', { class: 'offline-banner', role: 'status', hidden: true }, t('offline'));
document.body.prepend(banner);
initInstall();
const syncOnline = () => { banner.textContent = t('offline'); banner.hidden = navigator.onLine; syncInstall(); };
window.addEventListener('online', syncOnline);
window.addEventListener('offline', syncOnline);
let notice = null;
let watchedFor = null;     // whose profile we are watching for live changes

function render() {
  syncOnline();
  live.reset();
  root.replaceChildren();
  if (!state.profile) {
    notice ??= takeNotice();
    const lang = h('button', { class: 'btn small floating', onclick: () => { setLang(otherLang()); render(); } }, t('language'));
    root.append(lang, loginView({ notice }));   // the notice stays until the next sign-in (survives language switches)
    return;
  }
  notice = null;
  if (watchedFor !== state.profile.id) {                // role/department change or deactivation of THIS person
    watchedFor = state.profile.id;
    live.watchGlobal([`user:${state.profile.id}`], (p) => { if (p.t === 'profile' || p.t === 'resync') refreshProfile(); });
  }
  startNotifications();                                   // admins on the installed desktop app: "somebody filled his timesheet" (src/notify.js)
  const route = resolve();
  if (!route) return; // redirecting to the landing page; hashchange re-renders
  if (state.profile.role === 'super_admin' && acting.active && !acting.list.length) {   // first admin tab of this session: choose / load the department
    root.append(h('p', { class: 'muted center' }, t('loading')));
    ensureActing(fetchDepartments).then(render, () => { acting.list = [{ id: acting.dept, name: '' }]; render(); });
    return;
  }
  root.append(shell(route.view(), { onLang: render }));
}

applyDir();
applyTheme();
// phone: hide the bottom tab bar while a text field has focus, so it does not ride on top of the on-screen keyboard
const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(a.type))); };
const syncKeyboard = () => requestAnimationFrame(() => document.body.classList.toggle('kbd', typing() && matchMedia('(max-width: 640px)').matches));
document.addEventListener('focusin', syncKeyboard);
document.addEventListener('focusout', syncKeyboard);
window.addEventListener('hashchange', () => state.profile && render());
onChange(() => { live.dispose(); watchedFor = null; stopNotifications(); if (!state.profile) location.hash = ''; render(); });

root.append(h('p', { class: 'muted center' }, t('loading')));
restore().then((key) => { notice = key; render(); });
