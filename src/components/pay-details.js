import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { openDialog } from './dialog.js';

const amount = (value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });

export function openPayDetails(summary, { title = t('monthly_pay') } = {}) {
    const rows = [];
    if (Number(summary.xPay)        > 0)    rows.push([t('pay_x_days'),    summary.xDays,  summary.xRate,    summary.xPay]);
    if (Number(summary.xhPay)       > 0)    rows.push([t('pay_xh_days'),   summary.xhDays, summary.xhRate,   summary.xhPay]);
    if (Number(summary.yPay)        > 0)    rows.push([t('pay_y_days'),    summary.yDays,  summary.yRate,    summary.yPay]);
    if (Number(summary.yhPay)       > 0)    rows.push([t('pay_yh_days'),   summary.yhDays, summary.yhRate,   summary.yhPay]);
    if (Number(summary.tripPay)     > 0)    rows.push([t('pay_trips'),     summary.trips,  summary.tripRate, summary.tripPay]);
    if (Number(summary.overtimePay) > 0)    rows.push([t('pay_overtime'), `${summary.overtimeHours}${t('hour_abbr')}`, summary.overtimeRate, summary.overtimePay]);

    const bodyRows = rows.map(([label, quantity, rate, total]) => h('tr', {},
        h('th', { scope: 'row' }, label),
        h('td', {}, quantity),
        h('td', { class: 'pay-operator', 'aria-hidden': 'true' }, '×'),
        h('td', { class: 'pay-number' }, amount(rate)),
        h('td', { class: 'pay-operator', 'aria-hidden': 'true' }, '='),
        h('td', { class: 'pay-number' }, amount(total))));

    const table = h('table', { class: 'pay-details' },
        h('thead', {}, h('tr', {}, h('th', {}, t('pay_item')), h('th', {}, t('pay_quantity')), h('th', { 'aria-hidden': 'true' }), h('th', {}, t('pay_rate')), h('th', { 'aria-hidden': 'true' }), h('th', {}, t('pay_amount')))),
        h('tbody', {}, ...bodyRows),
        h('tfoot', {}, h('tr', {}, h('th', { colspan: 5 }, t('pay_total')), h('td', { class: 'pay-number' }, amount(summary.total)))),
    );
  
    if (summary.total > 0) {
        return openDialog({ 
            title, 
            content: h('div', { class: 'pay-details-wrap' }, table), 
            buttons: [{ label: t('close') }], autofocus: false 
        });
    } else {
        return openDialog({ 
            title, 
            content: h('div', { class: 'pay-details-wrap' }, h('p', {}, t('no_pay_details'))), 
            buttons: [{ label: t('close') }], autofocus: false 
        });
    }
}
