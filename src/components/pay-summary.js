import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { openPayDetails } from './pay-details.js';

const amount = (value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });

export function paySummary(summary, { title = t('monthly_pay') } = {}) {
  return h('button', {
    type: 'button',
    class: 'chip pay-summary',
    title,
    'aria-label': `${title}: ${amount(summary.total)}`,
    onclick: () => openPayDetails(summary, { title }),
  }, `${t('monthly_pay')}: ${amount(summary.total)}`);
}
