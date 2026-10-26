// Reading the Excel files of the bulk add dialogs (src/views/bulk-users.js): the column definitions, the role words, the username
// rule, the workbook parser and the downloadable templates. No dialog code in here.
import { t } from '../i18n/index.js';

export const COLUMNS = [
  ['full_name', 'Full name', ['full name', 'name', 'fullname']], ['opr', 'OPR', ['opr']], ['payroll', 'Payroll', ['payroll', 'p/r', 'pr']],
  ['username', 'Username', ['username', 'user name', 'login']], ['password', 'Password', ['password', 'pass']], ['level', 'Level', ['level']],
  ['job_title', 'Job title', ['job title', 'title']], ['contract_no', 'Contract no', ['contract no', 'contract no.', 'contract', 'contr. no']],
  ['work_location', 'Work location', ['work location', 'location', 'site']], ['position', 'Position', ['position']], ['residence', 'Residence', ['residence', 'lives']], ['y_allowed', 'Y allowed', ['y allowed', 'y']],
  ['role', 'Role', ['role', 'type']],
];
export const YES = ['yes', 'y', 'true', '1'], NO = ['no', 'n', 'false', '0'];
// Role column: empty = normal user
export const ROLES = { user: 'user', 'normal user': 'user', admin: 'admin', manager: 'manager', 'dept manager': 'manager', 'department manager': 'manager' };
export const USERNAME = /^[a-z0-9._-]{3,32}$/;
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
export const SUPER_ROLES = { 'super admin': 'super_admin', super_admin: 'super_admin', 'super manager': 'super_manager', super_manager: 'super_manager' };
const colsOf = (multi, sup = false) => (sup ? COLUMNS.filter((c) => SUPER_KEYS.includes(c[0])) : multi ? [DEPT_COL, ...COLUMNS] : COLUMNS);
export const plainName = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

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

