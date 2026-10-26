// "Developed by" line shown on the sign-in page and the Account page: the name plus GitHub / e-mail / LinkedIn as icon links.
import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { icon, GITHUB, MAIL, LINKEDIN, WHATSAPP } from './icons.js';

const USER = 'shadymansour19';
// WhatsApp has no link by username, only by phone number: the chat opens with a first message that names the app
const PHONE = '201069360912';
const links = () => [
  ['GitHub', `https://github.com/${USER}`, GITHUB],
  ['LinkedIn', `https://www.linkedin.com/in/${USER}`, LINKEDIN],
  ['Email', `mailto:${USER}@gmail.com`, MAIL],
  ['WhatsApp', `https://wa.me/${PHONE}?text=${encodeURIComponent(t('wa_message'))}`, WHATSAPP, 1.3],      // the glyph is drawn smaller than the others: zoomed inside the same circle
];

// compact: one small row for the bottom of the account menu
export const credit = ({ compact = false } = {}) => h('div', { class: compact ? 'menu-credit muted' : 'credit muted' },
  h('span', {}, `${t('developed_by')} Shady Mansour`),
  h('span', { class: 'credit-links' }, links().map(([name, href, ic, zoom = 1]) => h('a', {
    href, title: name, 'aria-label': `Shady Mansour \u2013 ${name}`, class: 'credit-link', 'data-link': name.toLowerCase(),
    ...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
  }, icon(ic, Math.round((compact ? 16 : 20) * zoom))))));
