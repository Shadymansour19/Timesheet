// "Developed by" line shown on the sign-in page and the Account page. (The email address is in package.json / README, not on the page.)
import { h } from '../dom.js';
import { t } from '../i18n/index.js';

export const credit = () => h('p', { class: 'credit muted' },
  `${t('developed_by')} Shady Mansour · `,
  h('a', { href: 'https://github.com/shadymansour19', target: '_blank', rel: 'noopener noreferrer' }, 'github.com/shadymansour19'));
