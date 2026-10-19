import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { icon, CHEVRON_LEFT, CHEVRON_RIGHT } from './icons.js';

// Month navigation row. Always laid out left-to-right (previous on the left, next on the right) in every
// language, so the arrows keep their meaning in Arabic too; the title keeps its own text direction.
export function monthHead(title, { onPrev, onNext, onToday }) {
  return h('div', { class: 'cal-head', dir: 'ltr' },
    h('button', { class: 'btn small', onclick: onPrev, 'aria-label': t('prev_month') }, icon(CHEVRON_LEFT)),
    h('h2', { dir: 'auto' }, title),
    h('button', { class: 'btn small', onclick: onNext, 'aria-label': t('next_month') }, icon(CHEVRON_RIGHT)),
    h('button', { class: 'btn small', onclick: onToday }, t('today')));
}
