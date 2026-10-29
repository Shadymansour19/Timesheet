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

// one row -> what would be created, or why not (nothing is sent here). The password (the given one or a random one) is fixed at this point, so the preview shows
// the real password. Needed later: roleCode, level, deptId.
function prepare(r, dupError = '', departments = null, sup = false) {
  const out = { ...r, username: usernameOf(r), password: r.password || randomPassword(), ok: false, error: dupError };
  if (sup) {                                                   // super admin / super manager: empty role = super manager (read-only)
    out.roleCode = SUPER_ROLES[(r.role || 'super manager').toLowerCase()];
    if (out.error) return out;
    if (!r.full_name) out.error = t('bulk_err_required_super');
    else if (!USERNAME.test(out.username)) out.error = t('bulk_err_username');
    else if (out.password.length < 8 || out.password.length > 72) out.error = t('bulk_err_password');
    else if (!out.roleCode) out.error = t('bulk_err_role_super');
    return out;
  }
  out.level = (r.level ?? '').trim() || null;                  // free text
  out.roleCode = ROLES[(r.role || (departments ? 'admin' : 'user')).toLowerCase()];      // several departments (super admin): admins by default, never plain users
  const dept = departments ? departments.find((d) => plainName(d.name) === plainName(r.department)) : { id: myDept() };
  out.deptId = dept?.id;
  if (out.error) return out;
  if (!dept) out.error = `${t('bulk_err_dept')}: ${r.department || '-'}`;
  else if (departments && out.roleCode === 'user') out.error = t('bulk_err_role_admin');
  else if (!r.full_name || (!r.payroll && out.roleCode !== 'manager')) out.error = t('bulk_err_required');
  else if (!USERNAME.test(out.username)) out.error = t('bulk_err_username');
  else if (out.password.length < 8 || out.password.length > 72) out.error = t('bulk_err_password');
  else if (r.residence && !['inside', 'outside'].includes(r.residence.toLowerCase())) out.error = t('bulk_err_residence');
  else if (r.y_allowed && !YES.includes(r.y_allowed.toLowerCase()) && !NO.includes(r.y_allowed.toLowerCase())) out.error = t('bulk_err_y');
  else if (r.role && !ROLES[r.role.toLowerCase()]) out.error = t('bulk_err_role');
  return out;
}

// the same username / OPR / payroll twice in the file: only the first row is created (parallel creation would make it random)
function prepareAll(rows, departments, sup) {
  const seen = { u: new Set(), o: new Set(), p: new Set() };
  return rows.map((r) => {
    const u = usernameOf(r); const d = seen.u.has(u) || (r.opr && seen.o.has(r.opr)) || (r.payroll && seen.p.has(r.payroll));
    seen.u.add(u); if (r.opr) seen.o.add(r.opr); if (r.payroll) seen.p.add(r.payroll);
    return prepare(r, d ? t('bulk_err_dup') : '', departments, sup);
  });
}

// a prepared row -> create_user (rows with a problem are not sent)
async function createRow(out, sup = false) {
  if (out.error) return out;
  try {
    if (sup) await callFn('create_user', { username: out.username, password: out.password, full_name: out.full_name, opr: out.opr, role: out.roleCode });
    else await callFn('create_user', { username: out.username, password: out.password, full_name: out.full_name, full_name_ar: out.full_name_ar, opr: out.opr, level: out.level, department_id: out.deptId, role: out.roleCode,
      job_title: out.job_title, contract_no: out.contract_no, work_location: out.work_location, residence: out.residence.toLowerCase(), position: out.position, payroll: out.payroll, y_allowed: !NO.includes((out.y_allowed || 'yes').toLowerCase()) });
    out.ok = true;
  } catch (e) { out.error = explain(e); }
  return out;
}

// departments: the department list when the super admin adds people to SEVERAL departments from one file (Department column)
export function openBulkAdd({ onDone, departments = null, superUsers = false }) {
  const multi = !!departments, sup = superUsers;
  let rows = [], prepared = [], busy = false;
  const file = h('input', { type: 'file', accept: '.xlsx', id: 'bulk-file' });
  const info = h('p', { class: 'muted', 'aria-live': 'polite' });
  const body = h('div', { class: 'bulk-results' });
  const content = h('div', { class: 'form' },
    h('p', { class: 'muted' }, sup ? t('bulk_hint_super') : multi ? t('bulk_hint_multi') : t('bulk_hint')),
    h('button', { type: 'button', class: 'btn small', onclick: async () => save(await templateFile(multi, sup), 'users_template.xlsx') }, t('bulk_template')),
    h('div', { class: 'field' }, h('label', { for: 'bulk-file' }, t('bulk_file')), file), dropZone(file), info, body);
  file.addEventListener('change', async () => {
    rows = []; prepared = []; body.replaceChildren();
    const f = file.files[0]; if (!f) { info.textContent = ''; return; }
    try {
      const parsed = await parseWorkbook(await f.arrayBuffer(), multi, sup);
      rows = parsed.rows;
      info.textContent = parsed.problems.length ? parsed.problems.join(' · ') : `${rows.length} ${t('bulk_rows_found')}`;
      if (!parsed.problems.length) showPreview();
    } catch { info.textContent = t('bulk_bad_file'); }
  });

  // the preview: every row as it would be created (effective username, role, password) or the reason it is skipped; nothing is created before the button is pressed
  function showPreview() {
    prepared = prepareAll(rows, departments, sup);
    const bad = prepared.filter((r) => r.error).length;
    const head = ['#', ...(multi ? [t('department_name')] : []), t('full_name'), ...(sup ? [] : [t('bulk_col_name_ar')]), t('role'), ...(sup ? [] : [t('payroll_short')]), t('opr'), t('username'), t('password'), t('bulk_result')];
    const table = h('table', { class: 'bulk-table preview' }, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))),
      h('tbody', {}, prepared.map((r) => h('tr', { class: r.error ? 'bad' : 'ok' },
        h('td', {}, r.line), ...(multi ? [h('td', {}, r.department)] : []), h('td', {}, r.full_name), ...(sup ? [] : [h('td', { dir: 'rtl' }, r.full_name_ar)]),
        h('td', {}, r.roleCode ? t('role_' + r.roleCode) : r.role), ...(sup ? [] : [h('td', {}, r.payroll)]), h('td', {}, r.opr), h('td', {}, r.username), h('td', { class: 'mono' }, r.password),
        h('td', {}, r.error || t('bulk_ready'))))));
    body.replaceChildren(h('p', { class: 'muted', 'aria-live': 'polite' }, `${t('bulk_preview_hint')} ${t('bulk_ready')}: ${prepared.length - bad}${bad ? ` · ${t('bulk_problems')}: ${bad}` : ''}`), table);
  }

  async function run() {
    if (busy || !prepared.length) return;
    busy = true;
    const todo = prepared; prepared = [];                      // a second press does nothing: the rows below are created once
    const results = todo;
    const table = h('table', { class: 'bulk-table' }, h('thead', {}, h('tr', {}, ['#', ...(multi ? [t('department_name')] : []), t('full_name'), t('username'), t('password'), t('bulk_result')].map((x) => h('th', {}, x)))), h('tbody', {}));
    body.replaceChildren(table);
    let next = 0, done = 0;
    const worker = async () => {
      while (next < todo.length) {
        const i = next++; await createRow(todo[i], sup); done++;
        info.textContent = `${done} / ${todo.length}`;
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
