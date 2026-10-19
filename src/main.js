import './styles/main.css';
import { h } from './dom.js';
import { applyDir, t, otherLang, setLang } from './i18n/index.js';
import { state, restore, onChange, takeNotice, refreshProfile } from './auth/session.js';
import * as live from './live.js';
import { loginView } from './views/login.js';
import { resolve } from './router.js';
import { shell } from './components/shell.js';

const root = document.getElementById('app');
const banner = h('div', { class: 'offline-banner', role: 'status', hidden: true }, t('offline'));
document.body.prepend(banner);
const syncOnline = () => { banner.textContent = t('offline'); banner.hidden = navigator.onLine; };
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
  const route = resolve();
  if (!route) return; // redirecting to the landing page; hashchange re-renders
  root.append(shell(route.view(), { onLang: render }));
}

applyDir();
window.addEventListener('hashchange', () => state.profile && render());
onChange(() => { live.dispose(); watchedFor = null; if (!state.profile) location.hash = ''; render(); });

root.append(h('p', { class: 'muted center' }, t('loading')));
restore().then((key) => { notice = key; render(); });
