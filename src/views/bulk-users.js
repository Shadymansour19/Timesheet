// Bulk add users from an Excel sheet (Users tab). Columns (header row, any order, case-insensitive):
//   Full name*, OPR*, Payroll, Username, Password, Level, Job title, Contract no, Work location, Position, Residence
// Username empty -> the OPR (lower-case); password empty -> a random one. Everyone is created through the same Edge Function as
// "Add user"; the result table (with the passwords) is shown and can be downloaded as Excel.
import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { callFn } from '../api/admin.js';
import { explain } from '../api/errors.js';
import { openDialog } from '../components/dialog.js';
import { randomPassword } from '../components/form.js';
import { myDept } from '../auth/session.js';

export const COLUMNS = [
  ['full_name', 'Full name', ['full name', 'name', 'fullname']], ['opr', 'OPR', ['opr']], ['payroll', 'Payroll', ['payroll', 'p/r', 'pr']],
  ['username', 'Username', ['username', 'user name', 'login']], ['password', 'Password', ['password', 'pass']], ['level', 'Level', ['level']],
  ['job_title', 'Job title', ['job title', 'title']], ['contract_no', 'Contract no', ['contract no', 'contract no.', 'contract', 'contr. no']],
  ['work_location', 'Work location', ['work location', 'location', 'site']], ['position', 'Position', ['position']], ['residence', 'Residence', ['residence', 'lives']], ['y_allowed', 'Y allowed', ['y allowed', 'y']],
];
const YES = ['yes', 'y', 'true', '1'], NO = ['no', 'n', 'false', '0'];
const USERNAME = /^[a-z0-9._-]{3,32}$/;
const plain = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');       // English letters and numbers only
// username: the one in the sheet, else the PAYROLL reduced to letters and numbers (EMC-123 -> emc123), else the OPR the same way
export const usernameOf = (r) => (r.username ? r.username.toLowerCase() : plain(r.payroll) || plain(r.opr));

const cellText = (c) => {
  let v = c?.value;
  if (v && typeof v === 'object') v = 'richText' in v ? v.richText.map((r) => r.text).join('') : 'result' in v ? v.result : 'text' in v ? v.text : '';
  return v === null || v === undefined ? '' : String(v).trim();
};

// -> { rows: [{ line, full_name, opr, ... }], problems: [] }
export async function parseWorkbook(buffer) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], problems: [t('bulk_empty_file')] };
  const head = {};
  ws.getRow(1).eachCell((c, i) => { const name = cellText(c).toLowerCase(); const col = COLUMNS.find(([, , al]) => al.includes(name)); if (col && !head[col[0]]) head[col[0]] = i; });
  const problems = [];
  for (const need of ['full_name', 'opr']) if (!head[need]) problems.push(`${t('bulk_missing_column')}: ${COLUMNS.find((c) => c[0] === need)[1]}`);
  if (problems.length) return { rows: [], problems };
  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = {}; let any = false;
    for (const [key] of COLUMNS) { row[key] = head[key] ? cellText(ws.getRow(r).getCell(head[key])) : ''; if (row[key]) any = true; }
    if (any) rows.push({ line: r, ...row });
  }
  return { rows, problems };
}

export async function templateFile() {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Users');
  ws.addRow(COLUMNS.map(([, label]) => label)).font = { bold: true };
  // three rows showing the possible values: empty username / password (-> payroll letters+numbers / random), Y allowed yes | no, residence inside | outside
  ws.addRow(['Ahmed Ali Hassan', 'OPRCTR123', 'EMC-123', '', '', '3', 'Engineer', '033/2019', 'IDKU Site', 'Engineer', 'inside', 'yes']);
  ws.addRow(['Sara Mahmoud Ibrahim', 'OPRCTR124', 'EMC-124', 'sara.m', 'Pass-12345', '3A', 'Technician', '033/2019', 'IDKU Site', 'Tech', 'outside', 'no']);
  ws.addRow(['Omar Khaled Samir', 'OPRCTR125', 'EMC-125', '', 'Temp-Pass-9', 'Senior', 'Supervisor', '', '', 'Engineer', '', 'yes']);
  COLUMNS.forEach((_, i) => { ws.getColumn(i + 1).width = 18; });
  return wb.xlsx.writeBuffer();
}

function save(buffer, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function resultsFile(results) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Results');
  ws.addRow(['Row', 'Full name', 'OPR', 'Payroll', 'Username', 'Password', 'Result']).font = { bold: true };
  for (const r of results) ws.addRow([r.line, r.full_name, r.opr, r.payroll, r.username, r.ok ? r.password : '', r.ok ? 'Created' : r.error]);
  [6, 28, 16, 16, 20, 18, 50].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return wb.xlsx.writeBuffer();
}

// one row -> create_user (validation first, so a bad row costs no request)
async function createRow(r, dupError = '') {
  const out = { ...r, username: usernameOf(r), password: r.password || randomPassword(), ok: false, error: dupError };
  const level = r.level.trim() || null;                 // free text
  if (out.error) return out;
  if (!r.full_name || !r.opr) out.error = t('bulk_err_required');
  else if (!USERNAME.test(out.username)) out.error = t('bulk_err_username');
  else if (out.password.length < 8 || out.password.length > 72) out.error = t('bulk_err_password');
  else if (r.residence && !['inside', 'outside'].includes(r.residence.toLowerCase())) out.error = t('bulk_err_residence');
  else if (r.y_allowed && !YES.includes(r.y_allowed.toLowerCase()) && !NO.includes(r.y_allowed.toLowerCase())) out.error = t('bulk_err_y');
  if (out.error) return out;
  try {
    await callFn('create_user', { username: out.username, password: out.password, full_name: r.full_name, opr: r.opr, level, department_id: myDept(), role: 'user',
      job_title: r.job_title, contract_no: r.contract_no, work_location: r.work_location, residence: r.residence.toLowerCase(), position: r.position, payroll: r.payroll, y_allowed: !NO.includes((r.y_allowed || 'yes').toLowerCase()) });
    out.ok = true;
  } catch (e) { out.error = explain(e); }
  return out;
}

export function openBulkAdd({ onDone }) {
  let rows = [], busy = false;
  const file = h('input', { type: 'file', accept: '.xlsx', id: 'bulk-file' });
  const info = h('p', { class: 'muted', 'aria-live': 'polite' });
  const body = h('div', { class: 'bulk-results' });
  const content = h('div', { class: 'form' },
    h('p', { class: 'muted' }, t('bulk_hint')),
    h('button', { type: 'button', class: 'btn small', onclick: async () => save(await templateFile(), 'users_template.xlsx') }, t('bulk_template')),
    h('div', { class: 'field' }, h('label', { for: 'bulk-file' }, t('bulk_file')), file), info, body);
  file.addEventListener('change', async () => {
    rows = []; body.replaceChildren();
    const f = file.files[0]; if (!f) { info.textContent = ''; return; }
    try {
      const parsed = await parseWorkbook(await f.arrayBuffer());
      rows = parsed.rows;
      info.textContent = parsed.problems.length ? parsed.problems.join(' · ') : `${rows.length} ${t('bulk_rows_found')}`;
    } catch { info.textContent = t('bulk_bad_file'); }
  });

  async function run() {
    if (busy || !rows.length) return;
    busy = true;
    const results = new Array(rows.length);
    const table = h('table', { class: 'bulk-table' }, h('thead', {}, h('tr', {}, ['#', t('full_name'), t('username'), t('password'), t('bulk_result')].map((x) => h('th', {}, x)))), h('tbody', {}));
    body.replaceChildren(table);
    // the same username / OPR / payroll twice in the file: only the first row is created (parallel creation would make it random)
    const seen = { u: new Set(), o: new Set(), p: new Set() };
    const dups = rows.map((r) => { const u = usernameOf(r); const d = seen.u.has(u) || (r.opr && seen.o.has(r.opr)) || (r.payroll && seen.p.has(r.payroll)); seen.u.add(u); if (r.opr) seen.o.add(r.opr); if (r.payroll) seen.p.add(r.payroll); return d ? t('bulk_err_dup') : ''; });
    let next = 0, done = 0;
    const worker = async () => {
      while (next < rows.length) {
        const i = next++; const r = await createRow(rows[i], dups[i]); results[i] = r; done++;
        info.textContent = `${done} / ${rows.length}`;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const ok = results.filter((r) => r.ok).length;
    table.tBodies[0].replaceChildren(...results.map((r) => h('tr', { class: r.ok ? 'ok' : 'bad' }, h('td', {}, r.line), h('td', {}, r.full_name), h('td', {}, r.username), h('td', {}, r.ok ? r.password : ''), h('td', {}, r.ok ? t('bulk_created') : r.error))));
    info.textContent = `${t('bulk_created')}: ${ok} · ${t('bulk_failed')}: ${results.length - ok}`;
    body.append(h('button', { type: 'button', class: 'btn small primary', id: 'bulk-download', onclick: async () => save(await resultsFile(results), 'users_created.xlsx') }, t('bulk_download')));
    busy = false;
    onDone?.();
  }
  openDialog({ title: t('bulk_add'), wide: 'xl', content, buttons: [{ label: t('close') }, { label: t('bulk_import'), kind: 'primary', onClick: async () => { await run(); return false; } }] });
}
