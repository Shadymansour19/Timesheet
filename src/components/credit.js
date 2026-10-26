// "Developed by" line shown on the sign-in page and the Account page: the name plus GitHub / e-mail / LinkedIn as icon links.
import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { icon, GITHUB, MAIL, LINKEDIN } from './icons.js';

const USER = 'shadymansour19';
const LINKS = [
  ['GitHub', `https://github.com/${USER}`, GITHUB],
  ['LinkedIn', `https://www.linkedin.com/in/${USER}`, LINKEDIN],
  ['Email', `mailto:${USER}@gmail.com`, MAIL],
];

// compact: one small row for the bottom of the account menu
export const credit = ({ compact = false } = {}) => h('div', { class: compact ? 'menu-credit muted' : 'credit muted' },
  h('span', {}, `${t('developed_by')} Shady Mansour`),
  h('span', { class: 'credit-links' }, LINKS.map(([name, href, ic]) => h('a', {
    href, title: name, 'aria-label': `Shady Mansour \u2013 ${name}`, class: 'credit-link', 'data-link': name.toLowerCase(),
    ...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
  }, icon(ic, compact ? 16 : 20)))));
