import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { fetchDepartmentPayRates, createPayRate, updatePayRate, deletePayRate, fetchTripPayRates, createTripPayRate, updateTripPayRate } from '../api/pay-rates.js';
import { openDialog, confirmDialog } from './dialog.js';
import { field } from './form.js';

const amount = (value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
const positionListId = 'pay-rate-positions';

function payRateFields(initial = {}, { edit = false } = {}) {
  const level = field(t('level'), { required: true, maxlength: 50, value: initial.level ?? '', readonly: edit });
  const position = field(t('position'), { required: true, maxlength: 100, value: initial.position ?? '', list: positionListId, placeholder: 'Engineer, Tech' });
  position.row.append(h('datalist', { id: positionListId }, h('option', { value: 'Engineer' }), h('option', { value: 'Tech' })));
  const x = field(t('pay_x_rate'), { type: 'number', required: true, min: 0, step: 'any', value: initial.xPayRate ?? initial.x_pay_rate ?? 0 });
  const y = field(t('pay_y_rate'), { type: 'number', required: true, min: 0, step: 'any', value: initial.yPayRate ?? initial.y_pay_rate ?? 0 });
  const overtime = field(t('pay_overtime_rate'), { type: 'number', required: true, min: 0, step: 'any', value: initial.overtimeHourRate ?? initial.overtime_hour_rate ?? 0 });
  return { level, position, x, y, overtime, rows: [level.row, position.row, x.row, y.row, overtime.row] };
}

function readRateFields(fields, departmentId) {
  const values = [fields.x, fields.y, fields.overtime].map(({ input }) => Number(input.value));
  if (!fields.level.input.value.trim() || !fields.position.input.value.trim() || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(t('pay_rate_invalid'));
  }
  return {
    level: fields.level.input.value.trim(), departmentId, position: fields.position.input.value.trim(),
    xPayRate: values[0], yPayRate: values[1], overtimeHourRate: values[2],
  };
}

function tripRateDialog(rate, onSaved) {
  const rateField = field(t('pay_trip_rate'), { type: 'number', required: true, min: 0, step: 'any', value: rate?.rate ?? 0 });
  const residence = rate?.residence ?? 'inside';
  openDialog({
    title: t('pay_edit_trip_rate'), content: h('div', { class: 'form' }, h('p', { class: 'muted' }, `${t('residence')}: ${residence === 'outside' ? t('residence_outside') : t('residence_inside')}`), rateField.row),
    buttons: [{ label: t('cancel') }, { label: t('save'), kind: 'primary', onClick: async () => {
      const value = Number(rateField.input.value);
      if (!Number.isFinite(value) || value < 0) throw new Error(t('pay_rate_invalid'));
      if (rate) await updateTripPayRate({ residence, rate: value });
      else await createTripPayRate({ residence, rate: value });
      await onSaved();
    } }],
  });
}

function editDialog(rate, departmentId, onSaved) {
  const fields = payRateFields(rate, { edit: true });
  openDialog({
    title: t('pay_edit_rate'), wide: 'wide', content: h('div', { class: 'form two-col' }, fields.rows),
    buttons: [{ label: t('cancel') }, { label: t('save'), kind: 'primary', onClick: async () => { await updatePayRate(readRateFields(fields, departmentId)); await onSaved(); } }],
  });
}

async function removeRate(rate, departmentId, onDeleted) {
  if (!(await confirmDialog(`${t('pay_delete_rate')}: ${rate.position} ${t('level')}-${rate.level}?`, { danger: true, confirmLabel: t('delete') }))) return;
  await deletePayRate({ level: rate.level, departmentId, position: rate.position });
  await onDeleted();
}

export function openPayRatesEditor(departmentId) {
  const content = h('div', { class: 'pay-rates-editor' }, h('p', { class: 'muted' }, t('loading')));
  let rates = [];
  let tripRates = [];
  let dialog;

  const add = () => {
    const fields = payRateFields();
    openDialog({
      title: t('pay_add_rate'), wide: 'wide', content: h('div', { class: 'form two-col' }, fields.rows),
      buttons: [{ label: t('cancel') }, { label: t('add'), kind: 'primary', onClick: async () => { await createPayRate(readRateFields(fields, departmentId)); await load(); } }],
    });
  };

  const render = () => {
    const table = h('table', { class: 'pay-rates-table' },
      h('thead', {}, h('tr', {}, h('th', {}, t('level')), h('th', {}, t('position')), h('th', {}, t('pay_x_rate')), h('th', {}, t('pay_y_rate')), h('th', {}, t('pay_overtime_rate')), h('th', { class: 'pay-rates-action-head' }, t('actions')))),
      h('tbody', {}, ...rates.map((rate) => h('tr', {},
        h('th', { scope: 'row' }, rate.level), h('td', {}, rate.position), h('td', {}, amount(rate.x_pay_rate)), h('td', {}, amount(rate.y_pay_rate)), h('td', {}, amount(rate.overtime_hour_rate)),
        h('td', { class: 'pay-rate-actions' },
          h('button', { type: 'button', class: 'btn small', onclick: () => editDialog(rate, departmentId, load) }, t('edit')),
          h('button', { type: 'button', class: 'btn small danger-outline', onclick: () => removeRate(rate, departmentId, load) }, t('delete')))))),
    );
    const tripTable = h('table', { class: 'pay-rates-table trip-pay-rates-table' },
      h('thead', {}, h('tr', {}, h('th', {}, t('residence')), h('th', {}, t('pay_trip_rate')), h('th', { class: 'pay-rates-action-head' }, t('actions')))),
      h('tbody', {}, ...['inside', 'outside'].map((residence) => {
        const rate = tripRates.find((item) => item.residence === residence);
        return h('tr', {}, h('th', { scope: 'row' }, residence === 'outside' ? t('residence_outside') : t('residence_inside')), h('td', {}, rate ? amount(rate.rate) : '-'), h('td', {}, h('button', { type: 'button', class: 'btn small', onclick: () => tripRateDialog(rate, load) }, rate ? t('edit') : t('add'))));
      })),
    );
    content.replaceChildren(
      h('div', { class: 'pay-rates-toolbar' }, h('p', { class: 'muted' }, t('pay_rates_hint')), h('button', { type: 'button', class: 'btn small primary', onclick: add }, t('pay_add_rate'))),
      h('h4', { class: 'pay-rates-section-title' }, t('pay_level_rates')),
      rates.length ? h('div', { class: 'pay-rates-table-wrap' }, table) : h('p', { class: 'muted center' }, t('pay_rates_empty')),
      h('h4', { class: 'pay-rates-section-title' }, t('pay_trip_rates')),
      h('div', { class: 'pay-rates-table-wrap' }, tripTable),
    );
  };

  const load = async () => {
    content.replaceChildren(h('p', { class: 'muted center' }, t('loading')));
    try { [rates, tripRates] = await Promise.all([fetchDepartmentPayRates(departmentId), fetchTripPayRates()]); render(); }
    catch { content.replaceChildren(h('p', { class: 'error' }, t('load_error'))); }
  };

  dialog = openDialog({ title: t('pay_rates'), content, buttons: [{ label: t('close') }], wide: 'xxl', autofocus: false });
  load();
  return dialog;
}
