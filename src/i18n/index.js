import en from './en.js';
import ar from './ar.js';

const dicts = { en, ar };
const RTL = new Set(['ar']);
let lang = 'en';

try {
  const saved = localStorage.getItem('lang');
  if (saved && dicts[saved]) lang = saved;
  else if ((navigator.language || '').toLowerCase().startsWith('ar')) lang = 'ar';
} catch { /* storage unavailable: keep default */ }

export const getLang = () => lang;

export function applyDir() {
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr';
  document.title = t('app_name');
}

export function setLang(next) {
  if (!dicts[next]) return;
  lang = next;
  try { localStorage.setItem('lang', next); } catch { /* ignore */ }
  applyDir();
}

export const t = (key) => dicts[lang][key] ?? dicts.en[key] ?? key;
export const otherLang = () => (lang === 'en' ? 'ar' : 'en');
