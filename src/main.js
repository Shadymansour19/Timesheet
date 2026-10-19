import './styles/main.css';
import { h } from './dom.js';
import { applyDir, t, otherLang, setLang } from './i18n/index.js';
import { state, restore, onChange } from './auth/session.js';
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

function render() {
  syncOnline();
  root.replaceChildren();
  if (!state.profile) {
    const lang = h('button', { class: 'btn small floating', onclick: () => { setLang(otherLang()); render(); } }, t('language'));
    root.append(lang, loginView({ notice }));
    notice = null;
    return;
  }
  const route = resolve();
  if (!route) return; // redirecting to the landing page; hashchange re-renders
  root.append(shell(route.view(), { onLang: render }));
}

applyDir();
window.addEventListener('hashchange', () => state.profile && render());
onChange(() => { if (!state.profile) location.hash = ''; render(); });

root.append(h('p', { class: 'muted center' }, t('loading')));
restore().then((key) => { notice = key; render(); });
