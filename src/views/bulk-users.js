// Bulk add users from an Excel sheet (Users tab). Columns (header row, any order, case-insensitive):
//   Full name*, Payroll* (not for managers), OPR, Username, Password, Level, Job title, Contract no, Work location, Position, Residence, Y allowed, Role (user | admin | manager; empty = user)
// Username empty -> the OPR (lower-case); password empty -> a random one. Everyone is created through the same Edge Function as
// "Add user"; the result table (with the passwords) is shown and can be downloaded as Excel.
import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { callFn } from '../api/admin.js';
import { explain } from '../api/errors.js';
import { dropZone } from '../components/dropzone.js';
import { openDialog } from '../components/dialog.js';
import { randomPassword } from '../components/form.js';
import { myDept } from '../auth/session.js';
import { YES, NO, ROLES, SUPER_ROLES, USERNAME, plainName, usernameOf, parseWorkbook, templateFile } from '../lib/bulk-parse.js';

function save(buffer, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function resultsFile(results, multi = false) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Results');
  ws.addRow(['Row', ...(multi ? ['Department'] : []), 'Full name', 'OPR', 'Payroll', 'Username', 'Password', 'Result']).font = { bold: true };
  for (const r of results) ws.addRow([r.line, ...(multi ? [r.department] : []), r.full_name, r.opr, r.payroll, r.username, r.ok ? r.password : '', r.ok ? 'Created' : r.error]);
  [6, ...(multi ? [20] : []), 28, 16, 16, 20, 18, 50].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return wb.xlsx.writeBuffer();
}

// one row -> create_user (validation first, so a bad row costs no request)
async function createRow(r, dupError = '', departments = null, sup = false) {
  const out = { ...r, username: usernameOf(r), password: r.password || randomPassword(), ok: false, error: dupError };
  if (sup && !out.error) {                                    // super admin / super manager: empty role = super manager (read-only)
    const role = SUPER_ROLES[(r.role || 'super manager').toLowerCase()];
    if (!r.full_name) out.error = t('bulk_err_required_super');
    else if (!USERNAME.test(out.username)) out.error = t('bulk_err_username');
    else if (out.password.length < 8 || out.password.length > 72) out.error = t('bulk_err_password');
    else if (!role) out.error = t('bulk_err_role_super');
    if (out.error) return out;
    try { await callFn('create_user', { username: out.username, password: out.password, full_name: r.full_name, opr: r.opr, role }); out.ok = true; }
    catch (e) { out.error = explain(e); }
    return out;
  }
  const level = r.level.trim() || null;                 // free text
  if (out.error) return out;
  const role = ROLES[(r.role || (departments ? 'admin' : 'user')).toLowerCase()];      // several departments (super admin): admins by default, never plain users
  const dept = departments ? departments.find((d) => plainName(d.name) === plainName(r.department)) : { id: myDept() };
  if (!dept) out.error = `${t('bulk_err_dept')}: ${r.department || '-'}`;
  else if (departments && role === 'user') out.error = t('bulk_err_role_admin');
  else if (!r.full_name || (!r.payroll && role !== 'manager')) out.error = t('bulk_err_required');
  else if (!USERNAME.test(out.username)) out.error = t('bulk_err_username');
  else if (out.password.length < 8 || out.password.length > 72) out.error = t('bulk_err_password');
  else if (r.residence && !['inside', 'outside'].includes(r.residence.toLowerCase())) out.error = t('bulk_err_residence');
  else if (r.y_allowed && !YES.includes(r.y_allowed.toLowerCase()) && !NO.includes(r.y_allowed.toLowerCase())) out.error = t('bulk_err_y');
  else if (r.role && !ROLES[r.role.toLowerCase()]) out.error = t('bulk_err_role');
  if (out.error) return out;
  try {
    await callFn('create_user', { username: out.username, password: out.password, full_name: r.full_name, opr: r.opr, level, department_id: dept.id, role,
      job_title: r.job_title, contract_no: r.contract_no, work_location: r.work_location, residence: r.residence.toLowerCase(), position: r.position, payroll: r.payroll, y_allowed: !NO.includes((r.y_allowed || 'yes').toLowerCase()) });
    out.ok = true;
  } catch (e) { out.error = explain(e); }
  return out;
}

// departments: the department list when the super admin adds people to SEVERAL departments from one file (Department column)
export function openBulkAdd({ onDone, departments = null, superUsers = false }) {
  const multi = !!departments, sup = superUsers;
  let rows = [], busy = false;
  const file = h('input', { type: 'file', accept: '.xlsx', id: 'bulk-file' });
  const info = h('p', { class: 'muted', 'aria-live': 'polite' });
  const body = h('div', { class: 'bulk-results' });
  const content = h('div', { class: 'form' },
    h('p', { class: 'muted' }, sup ? t('bulk_hint_super') : multi ? t('bulk_hint_multi') : t('bulk_hint')),
    h('button', { type: 'button', class: 'btn small', onclick: async () => save(await templateFile(multi, sup), 'users_template.xlsx') }, t('bulk_template')),
    h('div', { class: 'field' }, h('label', { for: 'bulk-file' }, t('bulk_file')), file), dropZone(file), info, body);
  file.addEventListener('change', async () => {
    rows = []; body.replaceChildren();
    const f = file.files[0]; if (!f) { info.textContent = ''; return; }
    try {
      const parsed = await parseWorkbook(await f.arrayBuffer(), multi, sup);
      rows = parsed.rows;
      info.textContent = parsed.problems.length ? parsed.problems.join(' · ') : `${rows.length} ${t('bulk_rows_found')}`;
    } catch { info.textContent = t('bulk_bad_file'); }
  });

  async function run() {
    if (busy || !rows.length) return;
    busy = true;
    const results = new Array(rows.length);
    const table = h('table', { class: 'bulk-table' }, h('thead', {}, h('tr', {}, ['#', ...(multi ? [t('department_name')] : []), t('full_name'), t('username'), t('password'), t('bulk_result')].map((x) => h('th', {}, x)))), h('tbody', {}));
    body.replaceChildren(table);
    // the same username / OPR / payroll twice in the file: only the first row is created (parallel creation would make it random)
    const seen = { u: new Set(), o: new Set(), p: new Set() };
    const dups = rows.map((r) => { const u = usernameOf(r); const d = seen.u.has(u) || (r.opr && seen.o.has(r.opr)) || (r.payroll && seen.p.has(r.payroll)); seen.u.add(u); if (r.opr) seen.o.add(r.opr); if (r.payroll) seen.p.add(r.payroll); return d ? t('bulk_err_dup') : ''; });
    let next = 0, done = 0;
    const worker = async () => {
      while (next < rows.length) {
        const i = next++; const r = await createRow(rows[i], dups[i], departments, sup); results[i] = r; done++;
        info.textContent = `${done} / ${rows.length}`;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const ok = results.filter((r) => r.ok).length;
    table.tBodies[0].replaceChildren(...results.map((r) => h('tr', { class: r.ok ? 'ok' : 'bad' }, h('td', {}, r.line), ...(multi ? [h('td', {}, r.department)] : []), h('td', {}, r.full_name), h('td', {}, r.username), h('td', {}, r.ok ? r.password : ''), h('td', {}, r.ok ? t('bulk_created') : r.error))));
    info.textContent = `${t('bulk_created')}: ${ok} · ${t('bulk_failed')}: ${results.length - ok}`;
    body.append(h('button', { type: 'button', class: 'btn small primary', id: 'bulk-download', onclick: async () => save(await resultsFile(results, multi), 'users_created.xlsx') }, t('bulk_download')));
    busy = false;
    onDone?.();
  }
  openDialog({ title: sup ? t('bulk_add_super') : multi ? t('bulk_add_admins') : t('bulk_add'), wide: 'xl', content, buttons: [{ label: t('close') }, { label: multi || sup ? t('bulk_import_multi') : t('bulk_import'), kind: 'primary', onClick: async () => { await run(); return false; } }] });
}
