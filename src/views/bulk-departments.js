// Bulk add departments from an Excel sheet (super admin, Departments tab). One column "Department" (header in the first row);
// every other row is a department name. Names that already exist (any capitalisation) are skipped, not an error.
import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { createDepartment } from '../api/admin.js';
import { explain } from '../api/errors.js';
import { openDialog } from '../components/dialog.js';

const norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');

async function names(buffer) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], problem: t('bulk_empty_file') };
  let col = 0;
  ws.getRow(1).eachCell((c, i) => { if (!col && ['department', 'dept', 'name', 'department name'].includes(norm(c.text ?? c.value).toLowerCase())) col = i; });
  if (!col) return { rows: [], problem: `${t('bulk_missing_column')}: Department` };
  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) { const v = norm(ws.getRow(r).getCell(col).text); if (v) rows.push({ line: r, name: v }); }
  return { rows, problem: '' };
}

export async function departmentsTemplate() {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Departments');
  ws.addRow(['Department']).font = { bold: true };
  ['Turbo', 'Boilers', 'Electrical'].forEach((n) => ws.addRow([n]));
  ws.getColumn(1).width = 30;
  return wb.xlsx.writeBuffer();
}

function save(buffer, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export function openBulkDepartments({ existing, onDone }) {
  let rows = [], busy = false;
  const file = h('input', { type: 'file', accept: '.xlsx', id: 'bulk-dept-file' });
  const info = h('p', { class: 'muted', 'aria-live': 'polite' });
  const body = h('div', { class: 'bulk-results' });
  const content = h('div', { class: 'form' }, h('p', { class: 'muted' }, t('bulk_dept_hint')),
    h('button', { type: 'button', class: 'btn small', onclick: async () => save(await departmentsTemplate(), 'departments_template.xlsx') }, t('bulk_template')),
    h('div', { class: 'field' }, h('label', { for: 'bulk-dept-file' }, t('bulk_file')), file), info, body);
  file.addEventListener('change', async () => {
    rows = []; body.replaceChildren();
    const f = file.files[0]; if (!f) { info.textContent = ''; return; }
    try {
      const r = await names(await f.arrayBuffer());
      rows = r.rows; info.textContent = r.problem || `${rows.length} ${t('bulk_dept_found')}`;
    } catch { info.textContent = t('bulk_bad_file'); }
  });
  async function run() {
    if (busy || !rows.length) return;
    busy = true;
    const have = new Set(existing().map((d) => d.name.trim().toLowerCase().replace(/\s+/g, ' ')));
    const results = [];
    for (const r of rows) {
      const key = r.name.toLowerCase();
      if (have.has(key)) { results.push({ ...r, state: 'skip', text: t('bulk_dept_exists') }); continue; }
      try { await createDepartment(r.name); have.add(key); results.push({ ...r, state: 'ok', text: t('bulk_created') }); }
      catch (e) { results.push({ ...r, state: 'bad', text: explain(e) }); }
      info.textContent = `${results.length} / ${rows.length}`;
    }
    const n = (s) => results.filter((r) => r.state === s).length;
    body.replaceChildren(h('table', { class: 'bulk-table' }, h('thead', {}, h('tr', {}, ['#', t('department_name'), t('bulk_result')].map((x) => h('th', {}, x)))),
      h('tbody', {}, results.map((r) => h('tr', { class: r.state === 'bad' ? 'bad' : 'ok' }, h('td', {}, r.line), h('td', {}, r.name), h('td', {}, r.text))))));
    info.textContent = `${t('bulk_created')}: ${n('ok')} · ${t('bulk_dept_exists')}: ${n('skip')} · ${t('bulk_failed')}: ${n('bad')}`;
    busy = false; rows = [];
    onDone?.();
  }
  openDialog({ title: t('bulk_add_departments'), wide: true, content, buttons: [{ label: t('close') }, { label: t('bulk_import_depts'), kind: 'primary', onClick: async () => { await run(); return false; } }] });
}
