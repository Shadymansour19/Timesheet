import { h } from '../dom.js';
import { t } from '../i18n/index.js';

export const placeholderView = (titleKey) => () =>
  h('section', { class: 'card' }, h('h2', {}, t(titleKey)), h('p', { class: 'muted' }, t('coming_soon')));
