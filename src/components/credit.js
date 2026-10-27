// "Developed by" line shown on the sign-in page and the Account page: the name plus GitHub / e-mail / LinkedIn as icon links.
import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { icon, GITHUB, MAIL, LINKEDIN, WHATSAPP } from './icons.js';

const USER = 'shadymansour19';
// WhatsApp has no link by username, only by phone number: the chat opens with a first message that names the app
const PHONE = '201069360912';
// the greeting follows the person's local time: morning 5-12, afternoon 12-17, evening otherwise
export const greetingKey = (d = new Date()) => { const hr = d.getHours(); return hr >= 5 && hr < 12 ? 'wa_morning' : hr >= 12 && hr < 17 ? 'wa_afternoon' : 'wa_evening'; };
const waHref = () => `https://wa.me/${PHONE}?text=${encodeURIComponent(t(greetingKey()))}`;
const links = () => [
  ['GitHub', `https://github.com/${USER}`, GITHUB],
  ['LinkedIn', `https://www.linkedin.com/in/${USER}`, LINKEDIN],
  ['Email', `mailto:${USER}@gmail.com`, MAIL],
  ['WhatsApp', waHref(), WHATSAPP, 1.15, 1.15],      // zoomed inside the same circle, with a thinner line so it looks as light as the others
];

// compact: one small row for the bottom of the account menu
export const credit = ({ compact = false } = {}) => h('div', { class: compact ? 'menu-credit muted' : 'credit muted' },
  h('span', {}, `${t('developed_by')} `, h('span', { class: 'dev-name' }, t('developer_name'))),
  h('span', { class: 'credit-links' }, links().map(([name, href, ic, zoom = 1, stroke = 2]) => h('a', {
    href, title: name, 'aria-label': `Shady Mansour \u2013 ${name}`, class: 'credit-link', 'data-link': name.toLowerCase(),
    ...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
  }, icon(ic, Math.round((compact ? 16 : 20) * zoom), stroke)))));

// the page may stay open for hours: the WhatsApp link gets today's greeting the moment it is used (tap, click, focus, long-press)
document.addEventListener('pointerdown', (e) => { const a = e.target.closest?.('a[data-link="whatsapp"]'); if (a) a.href = waHref(); }, true);
document.addEventListener('click', (e) => { const a = e.target.closest?.('a[data-link="whatsapp"]'); if (a) a.href = waHref(); }, true);
document.addEventListener('focusin', (e) => { const a = e.target.closest?.('a[data-link="whatsapp"]'); if (a) a.href = waHref(); });
