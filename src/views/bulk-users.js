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

export const COLUMNS = [
  ['full_name', 'Full name', ['full name', 'name', 'fullname']], ['opr', 'OPR', ['opr']], ['payroll', 'Payroll', ['payroll', 'p/r', 'pr']],
  ['username', 'Username', ['username', 'user name', 'login']], ['password', 'Password', ['password', 'pass']], ['level', 'Level', ['level']],
  ['job_title', 'Job title', ['job title', 'title']], ['contract_no', 'Contract no', ['contract no', 'contract no.', 'contract', 'contr. no']],
  ['work_location', 'Work location', ['work location', 'location', 'site']], ['position', 'Position', ['position']], ['residence', 'Residence', ['residence', 'lives']], ['y_allowed', 'Y allowed', ['y allowed', 'y']],
  ['role', 'Role', ['role', 'type']],
];
const YES = ['yes', 'y', 'true', '1'], NO = ['no', 'n', 'false', '0'];
// Role column: empty = normal user
const ROLES = { user: 'user', 'normal user': 'user', admin: 'admin', manager: 'manager', 'dept manager': 'manager', 'department manager': 'manager' };
const USERNAME = /^[a-z0-9._-]{3,32}$/;
const plain = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');       // English letters and numbers only
// username: the one in the sheet, else (managers: the OPR, others) the PAYROLL reduced to letters and numbers (EMC-123 -> emc123), else the OPR the same way
// a manager (no timesheet, payroll optional): the OPR first
export const usernameOf = (r) => (r.username ? r.username.toLowerCase()
  : ROLES[(r.role || 'user').toLowerCase()] === 'manager' ? plain(r.opr) || plain(r.payroll) : plain(r.payroll) || plain(r.opr));

const cellText = (c) => {
  let v = c?.value;
  if (v && typeof v === 'object') v = 'richText' in v ? v.richText.map((r) => r.text).join('') : 'result' in v ? v.result : 'text' in v ? v.text : '';
  return v === null || v === undefined ? '' : String(v).trim();
};

// -> { rows: [{ line, full_name, opr, ... }], problems: [] }
const DEPT_COL = ['department', 'Department', ['department', 'dept']];
const SUPER_KEYS = ['full_name', 'opr', 'username', 'password', 'role'];
const SUPER_ROLES = { 'super admin': 'super_admin', super_admin: 'super_admin', 'super manager': 'super_manager', super_manager: 'super_manager' };
const colsOf = (multi, sup = false) => (sup ? COLUMNS.filter((c) => SUPER_KEYS.includes(c[0])) : multi ? [DEPT_COL, ...COLUMNS] : COLUMNS);
const plainName = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// multi: the super admin's file for SEVERAL departments (a Department column names each person's department)
export async function parseWorkbook(buffer, multi = false, sup = false) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], problems: [t('bulk_empty_file')] };
  const head = {};
  ws.getRow(1).eachCell((c, i) => { const name = cellText(c).toLowerCase(); const col = colsOf(multi, sup).find(([, , al]) => al.includes(name)); if (col && !head[col[0]]) head[col[0]] = i; });
  const problems = [];
  for (const need of sup ? ['full_name'] : multi ? ['department', 'full_name', 'payroll'] : ['full_name', 'payroll']) if (!head[need]) problems.push(`${t('bulk_missing_column')}: ${colsOf(multi, sup).find((c) => c[0] === need)[1]}`);
  if (problems.length) return { rows: [], problems };
  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = {}; let any = false;
    for (const [key] of colsOf(multi, sup)) { row[key] = head[key] ? cellText(ws.getRow(r).getCell(head[key])) : ''; if (row[key]) any = true; }
    if (any) rows.push({ line: r, ...row });
  }
  return { rows, problems };
}

export async function templateFile(multi = false, sup = false) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Users');
  if (sup) {                          // super admins / super managers: no department, payroll or timesheet fields
    ws.addRow(colsOf(false, true).map(([, label]) => label)).font = { bold: true };
    ws.addRow(['Ahmed Ali Hassan', 'OPR-S1', 'ahmed.ali', '', 'super manager']);
    ws.addRow(['Sara Mahmoud Ibrahim', 'OPR-S2', '', 'Pass-12345', 'super admin']);
    ws.addRow(['Omar Khaled Samir', 'OPR-S3', '', '', '']);
    [26, 14, 18, 16, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    return wb.xlsx.writeBuffer();
  }
  const cols = colsOf(multi);
  ws.addRow(cols.map(([, label]) => label)).font = { bold: true };
  // rows showing the possible values: empty username / password (-> payroll letters+numbers / random), Y allowed yes | no, residence inside | outside, role user | admin | manager
  const rows = [
    ['Ahmed Ali Hassan', 'OPRCTR123', 'EMC-123', '', '', '3', 'Engineer', '033/2019', 'IDKU Site', 'Engineer', 'inside', 'yes', multi ? 'admin' : ''],
    ['Sara Mahmoud Ibrahim', 'OPRCTR124', 'EMC-124', 'sara.m', 'Pass-12345', '3A', 'Technician', '033/2019', 'IDKU Site', 'Tech', 'outside', 'no', multi ? 'manager' : 'user'],
    ['Omar Khaled Samir', 'OPRCTR125', 'EMC-125', '', 'Temp-Pass-9', 'Senior', 'Supervisor', '', '', 'Engineer', '', 'yes', multi ? '' : 'manager'],
  ];
  rows.forEach((r, i) => ws.addRow(multi ? [['Turbo', 'Turbo', 'Mechanical'][i], ...r] : r));
  cols.forEach((_, i) => { ws.getColumn(i + 1).width = 18; });
  return wb.xlsx.writeBuffer();
}

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
