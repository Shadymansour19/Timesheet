// Verifies the OFFICIAL monthly report workbook by building real .xlsx files, reading them back from disk, and having
// LibreOffice recalculate every formula from scratch (cached results stripped) to prove the formulas compute correctly.
// Run: node tests/export-official.test.mjs      (LibreOffice checks are skipped if `soffice` is not installed)
import ExcelJS from 'exceljs';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildModel } from '../src/export/model.js';
import { buildOfficialWorkbook, uniqueSheetName, employeeSheetName } from '../src/export/official.js';
import official from '../src/export/templates/official.js';

let fails = 0;
const ok = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond ? '' : ' ' + extra}`); };
const dir = mkdtempSync(join(tmpdir(), 'official-'));

// ---------- synthetic department: October 2028 (31 days), awkward names on purpose
const people = [
  { id: 'e1', full_name: 'Mohamed Salah Rashed', username: 'e1', opr: 'EMC-444', level: 3, job_title: 'First Engineer', contract_no: '033/2019' },
  { id: 'e2', full_name: 'Mohamed Abdelaziz Ismail Abdelkawy Mahmoud', username: 'e2', opr: 'EMC-459', level: 2, job_title: 'Engineer', contract_no: '110/2020' },
  { id: 'e3', full_name: "Ahmed O'Brien / Hassan [Jr]: *x*", username: 'e3', opr: 'EMC-457', level: 2, job_title: 'Engineer', contract_no: null },
  { id: 'e4', full_name: 'Mohamed Abdelaziz Ismail Abdelkawy Mahmoud', username: 'e4', opr: 'EMC-460', level: 1, job_title: 'Technician', contract_no: '7/2021' },   // same name, other OPR
  { id: 'e5', full_name: 'Hamdy Mahmoud Abdelnabi', username: 'e5', opr: 'EMC-102', level: 4, job_title: 'Supervisor', contract_no: '' },
  { id: 'e6', full_name: 'Khaled Orabi Ali', username: 'e6', opr: 'EMC-074', level: 5, job_title: null, contract_no: '55/2018' },
];
const data = {
  status: new Map([
    ['e1|2028-10-01', 'X'], ['e1|2028-10-02', 'X'], ['e1|2028-10-03', 'Y'], ['e1|2028-10-31', 'X'],       // 31st = a day only 31-day months have
    ['e2|2028-10-02', 'Y'], ['e2|2028-10-17', 'X'],
    ['e3|2028-10-16', 'X'], ['e3|2028-10-17', 'X'],
    ['e4|2028-10-05', 'X'], ['e5|2028-10-05', 'Y'], ['e5|2028-10-06', 'Y'],
  ]),
  overtime: new Map([
    ['e1|2028-10-01', { hours: 2, note: 'inventory' }], ['e1|2028-10-03', { hours: 6, note: 'night shift' }], ['e1|2028-10-31', { hours: 24, note: 'max' }],
    ['e2|2028-10-02', { hours: 4, note: '' }], ['e3|2028-10-17', { hours: 1, note: 'on call' }], ['e5|2028-10-06', { hours: 3, note: 'x'.repeat(40) }],
  ]),
  holidays: new Set(['2028-10-02', '2028-10-03']),
};
const model = buildModel({
  dept: { name: 'Turbo-Machinery', report: { dept_title: 'Turbo-Machinery Dept.', dept_code: '19', dept_print_name: 'TURBO (MAINT.)', location: 'IDKU Site', signoff_left: 'Turbo-Machinery SH/DH', signoff_right: 'Turbo-Machinery AGM' } },
  people, data, year: 2028, month: 9,
});
const N = 31, nEmp = people.length;

async function build(name, opts) {
  const file = join(dir, name);
  const wb = await buildOfficialWorkbook(model, official, ExcelJS, opts);
  await wb.xlsx.writeFile(file);
  return file;
}
const file = await build('official.xlsx', {});
const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);   // read back from disk
const names = wb.worksheets.map((w) => w.name);

// ---------- sheet structure
ok(`sheet count = ${N} days + ${nEmp} employees + 1 review`, names.length === N + nEmp + 1, String(names.length));
ok('the first sheets are the month days, named 1, 2, 3 ... 31 in order', names.slice(0, N).every((n, i) => n === String(i + 1)));
ok('the review sheet is last', names[names.length - 1] === 'Review');
const empNames = names.slice(N, N + nEmp);
ok('employee sheets come after the days, in employee order, named "<name> <OPR>"', empNames[0] === 'Mohamed Salah Rashed EMC-444' && empNames[4] === 'Hamdy Mahmoud Abdelnabi EMC-102' && empNames[5] === 'Khaled Orabi Ali EMC-074', empNames.join(' | '));
ok('every sheet name is at most 31 characters', names.every((n) => n.length <= 31), names.filter((n) => n.length > 31).join(','));
ok('no sheet name contains characters Excel forbids (\\ / ? * [ ] :)', names.every((n) => !/[\\/?*[\]:]/.test(n)));
ok('sheet names are unique (case-insensitive)', new Set(names.map((n) => n.toLowerCase())).size === names.length);
ok('a long name is shortened but the OPR is kept, so it stays recognisable and unique', empNames[1].endsWith(' EMC-459') && empNames[3].endsWith(' EMC-460') && empNames[1] !== empNames[3], `${empNames[1]} / ${empNames[3]}`);
ok("forbidden characters and apostrophes in a name are replaced, OPR kept", empNames[2].endsWith(' EMC-457') && !/[\\/?*[\]:']/.test(empNames[2]), empNames[2]);
ok('helper: two identical shortened names get a numeric suffix', (() => { const u = new Set(); const a = uniqueSheetName('Same', u), b = uniqueSheetName('Same', u); return a === 'Same' && b === 'Same 2'; })());
ok('helper: an OPR longer than the limit never crashes', employeeSheetName('Ab', 'X'.repeat(40), new Set()).length <= 31);

// ---------- day sheets
const day = (d) => wb.getWorksheet(String(d));
const d2 = day(2);
ok('day sheet: title, manpower line', d2.getCell('A4').value === 'Turbo-Machinery Dept. Daily Attendance Sheet' && d2.getCell('A5').value === 'EMC MANPOWER');
const dv = d2.getCell('A6').value;
ok('day sheet: the date is a real date (2 Oct 2028) and a holiday is tagged in its format', dv instanceof Date && dv.toISOString().slice(0, 10) === '2028-10-02' && String(d2.getCell('A6').numFmt).includes('Holiday'), `${dv} ${d2.getCell('A6').numFmt}`);
ok('day sheet: a normal day has the plain date format', !String(day(5).getCell('A6').numFmt).includes('Holiday'));
ok('day sheet: banner lines', (d2.getCell('C1').value.richText ?? []).map((r) => r.text).join('').includes('Maintenance Sector'));
ok('day sheet: column headers', ['No.', 'Name', 'Title', 'Level', 'P/R', 'Status', 'Accom.', 'TRANS/IN', 'TRANS/EX', 'Over Time', 'Comments'].every((h, i) => d2.getCell(8, i + 1).value === h));
const row = (ws, i) => 9 + i;
ok('day sheet: employee rows carry name / title / level / P/R from the data', d2.getCell(9, 2).value === 'Mohamed Salah Rashed' && d2.getCell(9, 3).value === 'First Engineer' && d2.getCell(9, 4).value === 'Level 3' && d2.getCell(9, 5).value === 'EMC-444');
ok('day sheet: statuses match the data (day 2: e1=X, e2=Y, others E)', ['X', 'Y', 'E', 'E', 'E', 'E'].every((s, i) => d2.getCell(row(d2, i), 6).value === s));
ok('day sheet: overtime hours and notes (day 2: e2 = 4h, no note)', d2.getCell(10, 10).value === 4 && !d2.getCell(10, 11).value && !d2.getCell(9, 10).value);
ok('day sheet 1: e1 has 2h with the note "inventory"', day(1).getCell(9, 10).value === 2 && day(1).getCell(9, 11).value === 'inventory');
ok('day sheet 31 exists and holds the 24h entry', day(31).getCell(9, 6).value === 'X' && day(31).getCell(9, 10).value === 24);
ok('day sheet: sign-off names at the bottom', [...Array(8)].some((_, i) => day(5).getCell(9 + nEmp + 2 + i, 1).value === 'Turbo-Machinery SH/DH'));
ok('missing title / contract number print as empty, not "null"', day(5).getCell(14, 3).value === '' || day(5).getCell(14, 3).value == null);

// ---------- employee sheets
const ws1 = wb.getWorksheet(empNames[0]);
ok('employee sheet: heading and static info (name, title, level, location)', ws1.getCell('D5').value === 'MONTHLY TIME REPORT' && ws1.getCell('C6').value === 'Mohamed Salah Rashed' && ws1.getCell('C7').value === 'First Engineer' && ws1.getCell('C8').value === 'Level 3' && ws1.getCell('C9').value === 'IDKU Site');
ok('employee sheet: department code, month, contract number, department, payroll (OPR)', ws1.getCell('P5').value === '19' && ws1.getCell('P6').value instanceof Date && ws1.getCell('P6').value.toISOString().slice(0, 7) === '2028-10' && ws1.getCell('P7').value === '033/2019' && ws1.getCell('P8').value === 'TURBO (MAINT.)' && ws1.getCell('P9').value === 'EMC-444');
const f = (cell) => (cell.value && cell.value.formula) || '';
const res = (cell) => (cell.value && cell.value.result);
ok('employee sheet: day 1 "Work" is a formula that looks the person up by P/R on day sheet 1', f(ws1.getCell('B13')).includes("'1'!$F$9:$F$14") && f(ws1.getCell('B13')).includes('MATCH($P$9') && f(ws1.getCell('B13')).includes("'1'!$E$9:$E$14"), f(ws1.getCell('B13')));
ok('employee sheet: day 16 is the last row of the left table, day 17 the first of the right', f(ws1.getCell('B28')).includes("'16'!") && f(ws1.getCell('M13')).includes("'17'!"));
ok('employee sheet: day 31 is in the right table', f(ws1.getCell('M27')).includes("'31'!"));
ok('employee sheet: cached results match the data (day 1 X/2h, day 3 Y/6h, day 31 X/24h)', res(ws1.getCell('B13')) === 'X' && res(ws1.getCell('I13')) === 2 && res(ws1.getCell('B15')) === 'Y' && res(ws1.getCell('I15')) === 6 && res(ws1.getCell('M27')) === 'X' && res(ws1.getCell('T27')) === 24);
ok('employee sheet: day comment is carried over', res(ws1.getCell('J13')) === 'inventory');
const T0 = 28 + 2 + 4;   // totals start row (legend block is 3 rows)
const tot = (r, c) => ws1.getCell(r, c);
ok('employee sheet: totals boxes are formulas (COUNTIF / SUMIF) with correct cached results (X=3, Y=1, OT normal 26, OT 1.2X 6)', f(tot(T0 + 1, 8)).startsWith('COUNTIF(') && res(tot(T0 + 1, 8)) === 3 && res(tot(T0 + 1, 19)) === 1 && res(tot(T0 + 4, 8)) === 26 && res(tot(T0 + 3, 19)) === 6, `${res(tot(T0 + 1, 8))} ${res(tot(T0 + 1, 19))} ${res(tot(T0 + 4, 8))} ${res(tot(T0 + 3, 19))}`);
ok('employee sheet: legends and signature lines are present', ['Work Codes', 'Meal Codes', 'Codes of Normal Daily Rates', 'Codes of 1.2X Daily Rates', 'Notes (Penalty):-', 'Signature Employee', 'Approval of Supervisor', 'Approval of Department GM'].every((t) => { let found = false; ws1.eachRow((r) => r.eachCell((c) => { if (c.value === t) found = true; })); return found; }));
const ws3 = wb.getWorksheet(empNames[2]);
ok('employee with no contract number: the cell is empty', ws3.getCell('P7').value == null || ws3.getCell('P7').value === '');

// ---------- review sheet
const rv = wb.getWorksheet('Review');
ok('review: title lines', rv.getCell('A4').value === 'Turbo-Machinery Dept. Monthly Attendance Sheet Review' && rv.getCell('A6').value === 'Closeout Calculation Sheet');
ok('review: column headers', ['No.', 'Name', 'Title', 'Level', 'P/R', '(X)DAYS', '(Y) DAYS', 'Total Days', 'O/T', 'EXT', 'IN', 'Signature'].every((h, i) => rv.getCell(8, i + 1).value === h));
ok('review: employee rows read their employee sheet (quoted sheet name in the formula)', f(rv.getCell('F9')).includes(`'${empNames[0]}'!`) && f(rv.getCell('G9')).includes(`'${empNames[0]}'!`));
ok("review: the formula for the person with an apostrophe in the name points at their (sanitised) sheet", f(rv.getCell('F11')).includes(`'${empNames[2]}'!`) && !empNames[2].includes("'"));
ok('review: cached totals (e1: X 3, Y 1, total 4, O/T 32; e2: X 1, Y 1; e5: Y 2, O/T 3)', res(rv.getCell('F9')) === 3 && res(rv.getCell('G9')) === 1 && res(rv.getCell('H9')) === 4 && res(rv.getCell('I9')) === 32 && res(rv.getCell('F10')) === 1 && res(rv.getCell('G10')) === 1 && res(rv.getCell('G13')) === 2 && res(rv.getCell('I13')) === 3);
ok('review: "Total Days" is a formula adding the two day columns', f(rv.getCell('H9')) === 'F9+G9');
const lastRow = 9 + nEmp - 1, T = lastRow + 2;
ok('review: engineer / technician totals are SUMIF formulas on the Title column with the right cached numbers', f(rv.getCell(T, 4)).startsWith('SUMIF($C$9:$C$14,"*Engineer*"') && res(rv.getCell(T, 4)) === 4 + 2 + 2 && f(rv.getCell(T + 2, 4)).includes('*Technician*') && res(rv.getCell(T + 2, 4)) === 1, `${res(rv.getCell(T, 4))} ${res(rv.getCell(T + 2, 4))}`);
ok('review: sign-off names', [...Array(10)].some((_, i) => rv.getCell(T + 3 + i, 1).value === 'Turbo-Machinery SH/DH') && [...Array(10)].some((_, i) => rv.getCell(T + 3 + i, 9).value === 'Turbo-Machinery AGM'));

// ---------- other month lengths
{
  const m2 = buildModel({ dept: { name: 'Ops' }, people: people.slice(0, 2), data: { status: new Map(), overtime: new Map(), holidays: new Set() }, year: 2028, month: 1 });   // Feb 2028 = 29 days
  const w = await buildOfficialWorkbook(m2, official, ExcelJS); const f2 = join(dir, 'feb.xlsx'); await w.xlsx.writeFile(f2);
  const r = new ExcelJS.Workbook(); await r.xlsx.readFile(f2);
  ok('February 2028 (29 days): sheets 1..29, then 2 employees, then Review', r.worksheets.length === 29 + 2 + 1 && r.worksheets[28].name === '29' && r.worksheets[29].name.endsWith('EMC-444'));
  ok('...defaults are used when no print settings exist (department name as title, "<name> SH/DH" sign-off)', r.getWorksheet('1').getCell('A4').value === 'Ops Dept. Daily Attendance Sheet' && [...Array(8)].some((_, i) => r.getWorksheet('1').getCell(9 + 2 + 2 + i, 1).value === 'Ops SH/DH'));
}

// ---------- LibreOffice: recalculate everything from scratch and compare with the data
let soffice = null; try { soffice = execFileSync('which', ['soffice']).toString().trim(); } catch { /* not installed */ }
if (!soffice) console.log('SKIP: LibreOffice not installed - formula recalculation checks skipped');
else {
  const bare = await build('official-nocache.xlsx', { cacheResults: false });   // formulas WITHOUT cached results: the engine must compute them
  const out = join(dir, 'recalc'); execFileSync(soffice, ['--headless', '--convert-to', 'xlsx', '--outdir', out, bare], { stdio: 'ignore', timeout: 180000 });
  const rc = new ExcelJS.Workbook(); await rc.xlsx.readFile(join(out, 'official-nocache.xlsx'));
  // ExcelJS reports a computed 0 as "formula without result" when READING (the file does contain <v>0</v>); LibreOffice always writes computed values
  const val = (ws, a) => { const v = ws.getCell(a).value; if (v && typeof v === 'object' && 'formula' in v) return 'result' in v ? v.result : 0; return v; };
  const e1 = rc.getWorksheet(empNames[0]), rvw = rc.getWorksheet('Review');
  ok('LibreOffice recalculation: the day lookups work (day 1 X, day 3 Y, day 31 X, a day with no record = E)', val(e1, 'B13') === 'X' && val(e1, 'B15') === 'Y' && val(e1, 'M27') === 'X' && val(e1, 'B14') === 'X' && val(e1, 'B20') === 'E', ['B13', 'B15', 'M27', 'B14', 'B20'].map((a) => val(e1, a)).join(','));
  ok('LibreOffice recalculation: overtime and comments come through (2h/"inventory", 6h, 24h)', val(e1, 'I13') === 2 && val(e1, 'J13') === 'inventory' && val(e1, 'I15') === 6 && val(e1, 'T27') === 24);
  ok('LibreOffice recalculation: employee totals (X 3, Y 1, OT normal 26, OT 1.2X 6)', val(e1, addrOf(T0 + 1, 8)) === 3 && val(e1, addrOf(T0 + 1, 19)) === 1 && val(e1, addrOf(T0 + 4, 8)) === 26 && val(e1, addrOf(T0 + 3, 19)) === 6, [val(e1, addrOf(T0 + 1, 8)), val(e1, addrOf(T0 + 1, 19)), val(e1, addrOf(T0 + 4, 8)), val(e1, addrOf(T0 + 3, 19))].join(','));
  // every review number must equal the data-derived expectation
  let bad = [];
  model.employees.forEach((e, i) => {
    const r = 9 + i, x = e.cells.filter((c) => c.status === 'X').length, y = e.cells.filter((c) => c.status === 'Y').length, ot = e.cells.reduce((a, c) => a + c.ot, 0);
    const got = [val(rvw, `F${r}`), val(rvw, `G${r}`), val(rvw, `H${r}`), val(rvw, `I${r}`)];
    if (JSON.stringify(got) !== JSON.stringify([x, y, x + y, ot])) bad.push(`${e.fullName}: got ${got} want ${[x, y, x + y, ot]}`);
  });
  ok(`LibreOffice recalculation: the review sheet is correct for all ${nEmp} employees (X, Y, total, O/T)`, bad.length === 0, bad.join(' ; '));
  ok('LibreOffice recalculation: engineer days 8, technician days 1 (SUMIF by title)', val(rvw, `D${T}`) === 8 && val(rvw, `D${T + 2}`) === 1, `${val(rvw, `D${T}`)} ${val(rvw, `D${T + 2}`)}`);
  ok('LibreOffice recalculation: the formulas produce no errors anywhere (#REF!, #N/A, #NAME?, #VALUE!)', await (async () => { let errs = 0; rc.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => { const v = c.value && typeof c.value === 'object' && 'result' in c.value ? c.value.result : c.value; if (v && typeof v === 'object' && 'error' in v) errs++; if (typeof v === 'string' && /^#(REF|N\/A|NAME|VALUE|DIV)/.test(v)) errs++; }))); return errs === 0; })());
}
function addrOf(r, c) { let s = ''; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return `${s}${r}`; }

console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL OFFICIAL-EXPORT TESTS PASSED ===');
console.log('files:', dir);
process.exit(fails ? 1 : 0);
