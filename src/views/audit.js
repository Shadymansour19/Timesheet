import { h } from '../dom.js';
import { t, personName } from '../i18n/index.js';
import { myDept, state } from '../auth/session.js';
import { fetchAuditPage, fetchAuditPeople, clearAuditBefore } from '../api/admin.js';
import { explain } from '../api/errors.js';
import { createColumnFilter } from '../components/column-filter.js';
import { icon, FILTER } from '../components/icons.js';
import { openDialog } from '../components/dialog.js';
import { toast } from '../components/toast.js';

const PAGE_SIZE = 50;
const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const NULL_VALUE = '__audit_null__';
const COLS = [
  ['at', 'audit_when'], ['person', 'audit_person'], ['day', 'audit_day'], ['actor', 'audit_actor'],
  ['action', 'audit_action'], ['field', 'audit_field'], ['old', 'audit_old_value'], ['new', 'audit_new_value'],
];

export function auditView() {
  const root = h('section', { class: 'audit' });
  const filters = { from: '', to: '' }, columnFilters = {};
  let people = [], rows = [], total = 0, page = 0, loading = false;
  let requestId = 0;
  const personById = new Map();
  const controls = {};

  const dateControl = (key, labelKey) => {
    const wrap = h('label', { class: 'audit-filter' }, h('span', {}, t(labelKey)), h('input', { type: 'date', value: filters[key] }));
    const input = wrap.querySelector('input');
    input.addEventListener('change', () => {
      filters[key] = input.value;
      if (filters.from && filters.to && filters.from > filters.to) {
        if (key === 'from') { filters.to = filters.from; controls.to.value = filters.to; }
        else { filters.from = filters.to; controls.from.value = filters.from; }
      }
      page = 0; load();
    });
    controls[key] = input;
    return wrap;
  };

  const toolbar = h('div', { class: 'audit-filters' }, dateControl('from', 'audit_from'), dateControl('to', 'audit_to'));
  const body = h('tbody', {});
  const headers = COLS.map(([key, label]) => h('th', { scope: 'col', 'data-k': key },
    h('span', {}, t(label)),
    h('button', { type: 'button', class: 'th-filter', 'data-k': key, title: t('filter'), 'aria-label': `${t('filter')}: ${t(label)}`, 'aria-haspopup': 'dialog', onclick: (e) => columnFilter.open(key, e.currentTarget) }, icon(FILTER, 14))));
  const table = h('div', { class: 'audit-table-wrap' }, h('table', { class: 'audit-table' },
    h('thead', {}, h('tr', {}, headers)), body));
  const status = h('p', { class: 'muted audit-count', role: 'status' });
  const empty = h('p', { class: 'muted center', hidden: true }, t('audit_empty'));
  const error = h('p', { class: 'error', hidden: true });
  const prev = h('button', { type: 'button', class: 'btn small', onclick: () => { page--; load(); } }, t('prev_page'));
  const next = h('button', { type: 'button', class: 'btn small', onclick: () => { page++; load(); } }, t('next_page'));
  const pager = h('div', { class: 'audit-pager' }, prev, h('span', { class: 'muted' }), next);
  const clearButton = state.profile.role === 'super_admin' ? h('button', { type: 'button', class: 'btn small danger', onclick: clearDialog }, t('audit_clear')) : null;
  root.replaceChildren(h('div', { class: 'cal-head' }, h('h2', {}, t('nav_audit')), clearButton), toolbar, status, error, table, empty, pager);

  function clearDialog() {
    const date = h('input', { type: 'date', required: true, 'aria-label': t('audit_clear_before_date') });
    const content = h('div', { class: 'form' },
      h('label', { for: 'audit-clear-date' }, t('audit_clear_before_date')),
      date,
      h('p', { class: 'muted' }, t('audit_clear_warning')));
    date.id = 'audit-clear-date';
    openDialog({
      title: t('audit_clear_title'), content,
      buttons: [{ label: t('cancel') }, { label: t('audit_clear_confirm'), kind: 'danger', onClick: async () => {
        if (!date.value) throw new Error(t('audit_clear_date_required'));
        const deleted = await clearAuditBefore(date.value);
        page = 0;
        await load();
        toast(t('audit_clear_done').replace('{count}', String(deleted)), 'success');
      } }],
    });
  }

  const readable = (value) => {
    if (value === null || value === undefined || value === '') return t('audit_blank');
    if (value === 'true') return t('audit_yes');
    if (value === 'false') return t('audit_no');
    return String(value);
  };
  function personLabel(id) {
    const p = personById.get(id);
    return p ? (personName(p) || p.username) : id ? t('audit_unknown_person') : t('audit_system');
  }
  const targetLabel = (id) => id ? personLabel(id) : t('audit_department_scope');
  const cellText = (row, key) => {
    const value = key === 'person' ? row.target_user : key === 'action' ? row.table_name : key === 'old' ? row.old_value : key === 'new' ? row.new_value : key === 'actor' ? row.actor : row[key];
    return value === null || value === undefined ? NULL_VALUE : String(value);
  };
  const matches = (row, skip = null) => COLS.every(([key]) => key === skip || !columnFilters[key] || columnFilters[key].has(cellText(row, key)));
  const displayFilterValue = (key, value) => {
    if (value === NULL_VALUE) return key === 'person' ? t('audit_department_scope') : key === 'actor' ? t('audit_system') : t('audit_blank');
    if (key === 'at') return dateFmt.format(new Date(value));
    if (key === 'person' || key === 'actor') return personLabel(value);
    if (key === 'action') return t('audit_table_' + value);
    if (key === 'field') { const label = t('audit_field_' + value); return label === 'audit_field_' + value ? value : label; }
    if (key === 'old' || key === 'new') return readable(value);
    return value;
  };
  const columnFilter = createColumnFilter({ rows: () => rows, matches, cellText, filters: columnFilters,
    labelOf: (key) => t(COLS.find(([name]) => name === key)[1]), labelText: displayFilterValue,
    valuesFor: (key) => ['person', 'actor'].includes(key) ? [...people.map((person) => person.id), ...(rows.some((row) => row[key === 'person' ? 'target_user' : 'actor'] == null) ? [NULL_VALUE] : [])] : null,
    onChange: () => { page = 0; load(); } });
  const displayCell = (row, key) => {
    const value = cellText(row, key);
    if (key === 'at') return dateFmt.format(new Date(row.at));
    if (key === 'person') return targetLabel(row.target_user);
    if (key === 'actor') return personLabel(row.actor);
    if (key === 'action') return t('audit_table_' + row.table_name);
    if (key === 'field') return displayFilterValue(key, value);
    if (key === 'old' || key === 'new') return readable(row[key === 'old' ? 'old_value' : 'new_value']);
    return value === NULL_VALUE ? t('audit_blank') : value;
  };
  function draw() {
    body.replaceChildren(...rows.filter(matches).map((row) => h('tr', {}, ...COLS.map(([key]) => h(key === 'person' ? 'th' : 'td', key === 'person' ? { scope: 'row' } : { class: key === 'at' ? 'audit-time' : '' }, displayCell(row, key))))));
    for (const th of table.querySelectorAll('thead th')) th.querySelector('.th-filter').classList.toggle('on', !!columnFilters[th.dataset.k]);
    empty.hidden = rows.length > 0;
    table.hidden = rows.length === 0;
    status.textContent = t('audit_page_count').replace('{first}', total ? String(page * PAGE_SIZE + 1) : '0')
      .replace('{last}', String(Math.min((page + 1) * PAGE_SIZE, total))).replace('{total}', String(total));
    const pageLabel = pager.querySelector('span');
    pageLabel.textContent = t('audit_page').replace('{page}', String(page + 1)).replace('{pages}', String(Math.max(1, Math.ceil(total / PAGE_SIZE))));
    prev.disabled = loading || page === 0;
    next.disabled = loading || (page + 1) * PAGE_SIZE >= total;
    pager.hidden = total <= PAGE_SIZE;
  }

  async function load() {
    const currentRequest = ++requestId;
    loading = true; error.hidden = true; draw();
    try {
      const result = await fetchAuditPage({ deptId: myDept(), ...filters, columnFilters, page, pageSize: PAGE_SIZE });
      if (currentRequest !== requestId) return;
      rows = result.rows; total = result.count;
      if (page > 0 && !rows.length && page * PAGE_SIZE >= total) { page = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1); return load(); }
    } catch (e) {
      if (currentRequest !== requestId) return;
      rows = []; total = 0; error.textContent = explain(e); error.hidden = false;
    } finally { if (currentRequest === requestId) loading = false; }
    if (currentRequest !== requestId) return;
    draw();
  }

  async function init() {
    try {
      people = await fetchAuditPeople(myDept());
      for (const person of people) personById.set(person.id, person);
      await load();
    } catch (e) {
      error.textContent = explain(e); error.hidden = false; loading = false; draw();
    }
  }
  init();
  return root;
}
