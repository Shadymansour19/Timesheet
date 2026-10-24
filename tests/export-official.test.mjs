// Verifies the OFFICIAL monthly report workbook by building real .xlsx files, reading them back from disk, comparing against an
// INDEPENDENT implementation of the Arrival / Departure / transport rules, and having LibreOffice recalculate every formula from
// scratch (cached results stripped). Run: node tests/export-official.test.mjs   (LibreOffice checks skipped if `soffice` is missing)
import ExcelJS from 'exceljs';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildModel } from '../src/export/model.js';
import { comparePeople } from '../src/lib/core.js';
import { buildOfficialWorkbook, buildEmployeeWorkbook, uniqueSheetName, employeeSheetName, reportSettings } from '../src/export/official.js';
import official from '../src/export/templates/official.js';

let fails = 0;
const ok = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond ? '' : ' ' + extra}`); };
const dir = mkdtempSync(join(tmpdir(), 'official-'));
const loadAsset = async (url) => readFileSync(new URL('../public' + url, import.meta.url));

// ---------- synthetic department: October 2028 (31 days), awkward names, work in the neighbouring months
const people = [
  { id: 'e1', position: 'Engineer', full_name: 'Mohamed Salah Rashed', username: 'e1', opr: 'EMC-444', level: 3, job_title: 'First Engineer', contract_no: '033/2019', residence: 'outside', work_location: null },
  { id: 'e2', position: 'Engineer', full_name: 'Mohamed Abdelaziz Ismail Abdelkawy Mahmoud', username: 'e2', opr: 'EMC-459', level: 2, job_title: 'Engineer', contract_no: '033/2019', residence: 'inside', work_location: 'Abu Qir Site' },
  { id: 'e3', position: 'engineer lead', full_name: "Ahmed O'Brien / Hassan [Jr]: *x*", username: 'e3', opr: 'EMC-457', level: 2, job_title: 'Engineer', contract_no: null, residence: null },
  { id: 'e4', position: 'Tech', full_name: 'Mohamed Abdelaziz Ismail Abdelkawy Mahmoud', username: 'e4', opr: 'EMC-460', level: 1, job_title: 'Technician', contract_no: '033/2019', residence: 'inside' },
  { id: 'e5', position: 'Technician', full_name: 'Hamdy Mahmoud Abdelnabi', username: 'e5', opr: 'EMC-102', level: 4, job_title: 'Supervisor', contract_no: '', residence: 'outside' },
  { id: 'e6', position: 'Rigger Foreman', full_name: 'Khaled Orabi Ali', username: 'e6', opr: 'EMC-074', level: 5, job_title: null, contract_no: '033/2019', residence: 'inside' },
];
people.forEach((p) => { p.payroll = p.opr; });   // reports print the PAYROLL number
const byId = (m, id) => m.employees.find((x) => x.id === id);
const status = new Map([
  ['e1|2028-09-30', 'X'], ['e1|2028-10-01', 'X'], ['e1|2028-10-02', 'X'], ['e1|2028-10-03', 'Y'], ['e1|2028-10-31', 'X'], ['e1|2028-11-01', 'X'],   // work continues from September and into November
  ['e2|2028-10-02', 'Y'], ['e2|2028-10-17', 'X'],                                                     // two isolated work days
  ['e3|2028-10-16', 'X'], ['e3|2028-10-17', 'X'],
  ['e4|2028-10-05', 'X'], ['e5|2028-10-05', 'Y'], ['e5|2028-10-06', 'Y'],
]);
const overtime = new Map([
  ['e1|2028-10-01', { hours: 2, note: 'inventory' }], ['e1|2028-10-03', { hours: 6, note: 'night shift' }], ['e1|2028-10-31', { hours: 24, note: 'max' }],
  ['e2|2028-10-02', { hours: 4, note: '' }], ['e3|2028-10-17', { hours: 1, note: 'on call' }], ['e5|2028-10-06', { hours: 3, note: 'x'.repeat(40) }],
]);
const dept = { name: 'Turbo-Machinery', code: '19', approved_engineer: 264, approved_tech: 295, sector: 'Maintenance Sector', field: 'Operations [Fields]', report: { dept_print_name: 'TURBO (MAINT.)', location: 'IDKU Site' } };
const model = buildModel({ sort: false, dept, people, data: { status, overtime, holidays: new Set(['2028-10-02', '2028-10-03', '2028-10-04']) }, year: 2028, month: 9 });
const N = 31, nEmp = people.length;

// ---------- independent expectation of the rules (does not use the model's code)
function expectDay(p, day) {
  const iso = (n) => { const d = new Date(Date.UTC(2028, 9, n)); return d.toISOString().slice(0, 10); };
  const w = (n) => status.has(`${p.id}|${iso(n)}`);
  const arrival = w(day) && !w(day - 1), departure = w(day) && !w(day + 1);
  const marks = [arrival ? 'Arrival' : '', departure ? 'Departure' : ''].filter(Boolean);
  const ov = overtime.get(`${p.id}|${iso(day)}`);
  const trips = marks.length, outside = p.residence === 'outside';
  return { st: status.get(`${p.id}|${iso(day)}`) ?? 'E', comment: [marks.join(' / '), ov?.note ?? ''].filter(Boolean).join(' - '), tin: outside ? 0 : trips, tex: outside ? trips : 0, ot: ov?.hours ?? 0 };
}
const exp = people.map((p) => { const days = Array.from({ length: N }, (_, i) => expectDay(p, i + 1)); return { p, days, x: days.filter((d) => d.st === 'X').length, y: days.filter((d) => d.st === 'Y').length, ot: days.reduce((a, d) => a + d.ot, 0), tin: days.reduce((a, d) => a + d.tin, 0), tex: days.reduce((a, d) => a + d.tex, 0) }; });

async function build(name, opts) { const file = join(dir, name); const wb = await buildOfficialWorkbook(model, official, ExcelJS, opts); await wb.xlsx.writeFile(file); return file; }
const file = await build('official.xlsx', { loadAsset });
const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);   // read back from disk
const names = wb.worksheets.map((w) => w.name);
const f = (cell) => (cell.value && cell.value.formula) || '';
const res = (cell) => (cell.value && typeof cell.value === 'object' && 'formula' in cell.value ? (cell.value.result ?? 0) : cell.value);

// ---------- arrival / departure / transport rules (model)
const mc = (ei, d) => byId(model, 'e' + (ei + 1)).cells[d - 1];
ok('rule: work continuing from the previous month is NOT an arrival (e1 worked 30 Sep, so 1 Oct is not an arrival)', !mc(0, 1).arrival && mc(0, 1).comment === 'inventory');
ok('rule: a work day with a rest day after it is a Departure (e1 on 3 Oct)', mc(0, 3).departure && mc(0, 3).comment.startsWith('Departure'));
ok('rule: work continuing into the next month is NOT a departure (e1 worked 1 Nov, so 31 Oct is not one) but IS an arrival', !mc(0, 31).departure && mc(0, 31).arrival);
ok('rule: an isolated work day is both Arrival and Departure = 2 trips (e2 on 2 Oct)', mc(1, 2).arrival && mc(1, 2).departure && mc(1, 2).trips === 2 && mc(1, 2).comment === 'Arrival / Departure');
ok('rule: trips go to TRANS/EX for a person living OUTSIDE the work city (e1) and TRANS/IN for INSIDE (e2)', mc(0, 31).tex === 1 && mc(0, 31).tin === 0 && mc(1, 2).tin === 2 && mc(1, 2).tex === 0);
ok('rule: unspecified residence counts as inside (e3)', mc(2, 16).tin === 1 && mc(2, 16).tex === 0);
ok('rule: the marks and the overtime note are combined ("Departure - on call"... e3 17 Oct: Departure - on call)', mc(2, 17).comment === 'Departure - on call', mc(2, 17).comment);
ok('rule: rest days (E) have no marks', mc(5, 10).comment === '' && mc(5, 10).trips === 0);
ok('rule (alternative, as in the sample sheets): "rest-day" puts Departure on the first rest day', (() => { const m = buildModel({ sort: false, dept, people, data: { status, overtime, holidays: new Set() }, year: 2028, month: 9, departureRule: 'rest-day' }); return byId(m, 'e1').cells[3].departure === false && byId(m, 'e1').cells[3].comment === 'night shift' ? false : byId(m, 'e1').cells[3].departure === false && byId(m, 'e1').cells[3].status === 'E' ? false : true; })() || (() => { const m = buildModel({ sort: false, dept, people, data: { status, overtime, holidays: new Set() }, year: 2028, month: 9, departureRule: 'rest-day' }); return byId(m, 'e1').cells[3].departure && byId(m, 'e1').cells[3].status === 'E'; })());

// ---------- sheet structure
ok(`sheet count = ${N} days + ${nEmp} employees + Review + Overtime + 2 closeout B2B sheets`, names.length === N + nEmp + 4, String(names.length));
ok('the first sheets are the month days, named 1, 2, 3 ... 31 in order', names.slice(0, N).every((n, i) => n === String(i + 1)));
ok('the last four sheets are Review, Overtime, Closeout B2B Eng, Closeout B2B Tech', names.slice(-4).join('|') === 'Review|Overtime|Closeout B2B Eng|Closeout B2B Tech', names.slice(-4).join('|'));
const empNames = names.slice(N, N + nEmp);
ok('employee sheets come after the days, in employee order, named "<name> <OPR>"', empNames[0] === 'Mohamed Salah Rashed EMC-444' && empNames[4] === 'Hamdy Mahmoud Abdelnabi EMC-102' && empNames[5] === 'Khaled Orabi Ali EMC-074', empNames.join(' | '));
ok('every sheet name is at most 31 characters, has no forbidden character (\\ / ? * [ ] : \') and is unique', names.every((n) => n.length <= 31 && !/[\\/?*[\]:']/.test(n)) && new Set(names.map((n) => n.toLowerCase())).size === names.length);
ok('a long name is shortened but the OPR is kept (two people with the same long name stay distinct)', empNames[1].endsWith(' EMC-459') && empNames[3].endsWith(' EMC-460') && empNames[1] !== empNames[3], `${empNames[1]} / ${empNames[3]}`);
ok('helper: identical shortened names get a numeric suffix; an absurd OPR never crashes', (() => { const u = new Set(); return uniqueSheetName('Same', u) === 'Same' && uniqueSheetName('Same', u) === 'Same 2' && employeeSheetName('Ab', 'X'.repeat(40), new Set()).length <= 31; })());

// ---------- day sheets
const day = (d) => wb.getWorksheet(String(d));
const d2 = day(2);
ok('day sheet: title, manpower line (constant), department name drives the title', d2.getCell('A4').value === 'Turbo-Machinery Dept. Daily Attendance Sheet' && d2.getCell('A5').value === 'EMC MANPOWER');
ok('day sheet: the banner shows the department field and sector on lines 2 and 3', (() => { const t = (d2.getCell('C1').value.richText ?? []).map((r) => r.text).join(''); return t.includes('Rashid Petroleum & BURULLUS Gas Company') && t.includes('Operations [Fields]') && t.includes('Maintenance Sector'); })());
const dv = d2.getCell('A6').value;
ok('day sheet: the date is a real date; a holiday is tagged in its format, a normal day is not', dv instanceof Date && dv.toISOString().slice(0, 10) === '2028-10-02' && String(d2.getCell('A6').numFmt).includes('Holiday') && !String(day(5).getCell('A6').numFmt).includes('Holiday'));
ok('day sheet: both company logos are embedded', d2.getImages().length === 2, String(d2.getImages().length));
ok('day sheet: column headers', ['No.', 'Name', 'Title', 'Level', 'P/R', 'Status', 'Accom.', 'TRANS/IN', 'TRANS/EX', 'Over Time', 'Comments'].every((h, i) => d2.getCell(8, i + 1).value === h));
ok('day sheet: name / title (= position) / level / P/R come from the data', d2.getCell(9, 2).value === 'Mohamed Salah Rashed' && d2.getCell(9, 3).value === 'Engineer' && d2.getCell(9, 4).value === 'Level 3' && d2.getCell(9, 5).value === 'EMC-444');
let bad = [];
for (let d = 1; d <= N; d++) for (let i = 0; i < nEmp; i++) {
  const ws = day(d), r = 9 + i, e = exp[i].days[d - 1];
  const got = [ws.getCell(r, 6).value, ws.getCell(r, 8).value ?? 0, ws.getCell(r, 9).value ?? 0, ws.getCell(r, 10).value ?? 0, ws.getCell(r, 11).value ?? ''];
  const want = [e.st, e.tin, e.tex, e.ot, e.comment];
  if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`d${d} ${people[i].opr}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
}
ok(`ALL ${N * nEmp} day-sheet rows (status, TRANS/IN, TRANS/EX, overtime, comment) equal the independent calculation`, bad.length === 0, bad.slice(0, 3).join(' ; '));
ok('day sheet: sign-off box carries the department name', [...Array(6)].some((_, i) => day(5).getCell(9 + nEmp + 1 + i, 1).value === 'Turbo-Machinery SH/DH') && [...Array(6)].some((_, i) => day(5).getCell(9 + nEmp + 1 + i, 8).value === 'Turbo-Machinery AGM'));

// ---------- employee sheets
const rows = Math.max(15, N - 15), lastRow = 15 + rows - 1, L0 = lastRow + 2, T0 = L0 + 4;   // 16 rows for a 31-day month
const ws1 = wb.getWorksheet(empNames[0]);
ok('employee sheet: heading and both logos', ws1.getCell('A5').value === 'MONTHLY TIME REPORT' && ws1.getImages().length === 2 && ws1.getCell('A4').value === 'Egyptian Maintenance Company' && ws1.getCell('Q4').value === 'Burullus Gas Company');
{ const P = (id, position, job_title, payroll, name) => ({ id, username: id, full_name: name ?? id, position, job_title, payroll });
  const order = (arr) => buildModel({ dept, people: arr, data: { status: new Map(), overtime: new Map(), holidays: new Set() }, year: 2028, month: 9 }).employees.map((e) => e.id).join(',');
  ok('ordering: engineers first, then techs, then others', order([P('o', 'Rigger', 'Rigger', 'EMC-1'), P('t', 'Tech', 'Technician', 'EMC-2'), P('e', 'Engineer', 'Engineer', 'EMC-3')]) === 'e,t,o');
  ok('ordering: the same position is sorted by the payroll NUMBER (95 before 300 before 1000, not as text) and the job title is ignored', order([P('c', 'Engineer', 'Zeta title', 'EMC-1000'), P('a', 'Engineer', 'Omega title', 'EMC-95'), P('b', 'Engineer', 'Alpha title', 'OPR-300')]) === 'a,b,c');
  ok('ordering: all engineers are one group sorted by payroll number even when their position text differs (Engineer / Sr. Engineer)', order([P('c', 'Sr. Engineer', 'x', 'EMC-300'), P('a', 'Engineer', 'x', 'EMC-95'), P('b', 'engineer', 'x', 'EMC-120')]) === 'a,b,c');
  ok('ordering: the position decides the group, not the job title', order([P('r', 'Rigger', 'Engineer', 'EMC-1'), P('t', 'Tech', 'Engineer II', 'EMC-2'), P('e', 'Engineer', 'Chief Technician', 'EMC-3')]) === 'e,t,r');
  ok('ordering: no number goes last inside its title, ties fall back to the name', order([P('x', 'Tech', 'T', 'NONE', 'Zed'), P('y', 'Tech', 'T', 'EMC-5', 'Bob'), P('z', 'Tech', 'T', 'EMC-5', 'Amy')]) === 'z,y,x'); }
ok('level text: digits print as "Level N", other text as typed', model.employees.every((e, i) => e.levelText === (/^\d+$/.test(String(people[i].level)) ? `Level ${people[i].level}` : String(people[i].level ?? ''))) && buildModel({ sort: false, dept, people: [{ id: 'z', full_name: 'Z', username: 'z', level: '3A' }, { id: 'y', full_name: 'Y', username: 'y', level: ' 4 ' }, { id: 'x', full_name: 'X', username: 'x', level: null }], data: { status: new Map(), overtime: new Map(), holidays: new Set() }, year: 2028, month: 9 }).employees.map((e) => e.levelText).join('|') === '3A|Level 4|');
ok('employee sheet: name, title, level, location the own location of the person; blank when none, no department fallback', ws1.getCell('C8').value === 'Mohamed Salah Rashed' && ws1.getCell('C9').value === 'Engineer' && ws1.getCell('C10').value === 'Level 3' && !ws1.getCell('C11').value);
ok("employee sheet: a person's own work location wins over the department's", wb.getWorksheet(empNames[1]).getCell('C11').value === 'Abu Qir Site');
ok('employee sheet: department code, month, contract number, department, payroll (OPR)', ws1.getCell('P7').value === '19' && ws1.getCell('P8').value instanceof Date && ws1.getCell('P8').value.toISOString().slice(0, 7) === '2028-10' && ws1.getCell('P9').value === '033/2019' && ws1.getCell('P10').value === 'TURBO (MAINT.)' && ws1.getCell('P11').value === 'EMC-444');
ok('employee sheet: left table = days 1-15, right table = days 16-31 (the form splits at 15/16)', ws1.getCell('A15').value === 1 && ws1.getCell('A29').value === 15 && ws1.getCell('L15').value === 16 && ws1.getCell('L30').value === 31);
ok('employee sheet: day 1 "Work" is a formula that looks the person up by P/R on day sheet 1', f(ws1.getCell('B15')).includes("'1'!$F$9:$F$14") && f(ws1.getCell('B15')).includes('MATCH($P$11') && f(ws1.getCell('B15')).includes("'1'!$E$9:$E$14"), f(ws1.getCell('B15')));
ok('employee sheet: day 16 and day 31 read sheets 16 and 31', f(ws1.getCell('M15')).includes("'16'!") && f(ws1.getCell('M30')).includes("'31'!"));
ok('employee sheet: cached results match (day 3 Y/6h/Departure/TEX 0..., day 31 X/24h/Arrival/EX 1)', res(ws1.getCell('B17')) === 'Y' && res(ws1.getCell('I17')) === 6 && String(res(ws1.getCell('J17'))).startsWith('Departure') && res(ws1.getCell('M30')) === 'X' && res(ws1.getCell('T30')) === 24 && String(res(ws1.getCell('U30'))).startsWith('Arrival') && res(ws1.getCell('S30')) === 1);
let badTot = [];
people.forEach((p, i) => {
  const s = wb.getWorksheet(empNames[i]), x = exp[i];
  const got = [res(s.getCell(T0 + 1, 5)), res(s.getCell(T0 + 1, 17)), res(s.getCell(T0 + 4, 5)) + res(s.getCell(T0 + 3, 17)), res(s.getCell(T0 + 4 + 2, 21)), res(s.getCell(T0 + 4 + 2, 20))];
  const want = [x.x, x.y, x.ot, x.tin, x.tex];
  if (JSON.stringify(got) !== JSON.stringify(want)) badTot.push(`${p.opr}: ${got} vs ${want}`);
});
ok('employee sheet totals (X days, Y days, overtime, Transportation IN / EX) equal the independent calculation for every employee', badTot.length === 0, badTot.join(' ; '));
ok('employee sheet: totals are COUNTIF / SUMIF / SUM formulas', f(ws1.getCell(T0 + 1, 5)).startsWith('COUNTIF(') && f(ws1.getCell(T0 + 4, 5)).includes('SUMIF(') && f(ws1.getCell(T0 + 6, 21)).startsWith('SUM('));
ok('employee sheet: legends, totals boxes, notes and signature lines are present', ['Work Codes', 'Meal Codes', 'Codes of Normal Daily Rates', 'Codes of 1.2X Daily Rates', 'Total Meals', 'Transportation', 'Notes (Penalty):-', 'Signature Employee', 'Approval of Supervisor', 'Approval of Department GM'].every((t) => { let found = false; ws1.eachRow((r) => r.eachCell((c) => { if (c.value === t) found = true; })); return found; }));
ok('employee sheet: a missing contract number prints as empty; the Title is the POSITION (job title is not used)', (wb.getWorksheet(empNames[2]).getCell('P9').value ?? '') === '' && wb.getWorksheet(empNames[5]).getCell('C9').value === 'Rigger Foreman' && wb.getWorksheet(empNames[0]).getCell('C9').value !== 'First Engineer');

// ---------- review sheet
const rv = wb.getWorksheet('Review');
ok('review: titles, banner logos', rv.getCell('A4').value === 'Turbo-Machinery Dept. Monthly Attendance Sheet Review' && rv.getCell('A5').value === 'EMC MANPOWER' && rv.getCell('A6').value === 'Closeout Calculation Sheet' && rv.getImages().length === 2);
ok('review: column headers', ['No.', 'Name', 'Title', 'Level', 'P/R', '(X)DAYS', '(Y) DAYS', 'Total Days', 'O/T', 'EXT', 'IN', 'Signature'].every((h, i) => rv.getCell(8, i + 1).value === h));
ok("review: employee rows read their employee sheet; the person with an apostrophe has a sanitised sheet", f(rv.getCell('F9')).includes(`'${empNames[0]}'!`) && f(rv.getCell('F11')).includes(`'${empNames[2]}'!`) && !empNames[2].includes("'"));
let badRv = [];
people.forEach((p, i) => { const r = 9 + i, x = exp[i], got = [res(rv.getCell(r, 6)), res(rv.getCell(r, 7)), res(rv.getCell(r, 8)), res(rv.getCell(r, 9)), res(rv.getCell(r, 10)), res(rv.getCell(r, 11))]; const want = [x.x, x.y, x.x + x.y, x.ot, x.tex, x.tin]; if (JSON.stringify(got) !== JSON.stringify(want)) badRv.push(`${p.opr}: ${got} vs ${want}`); });
ok('review: (X)DAYS, (Y) DAYS, Total, O/T, EXT, IN for every employee equal the independent calculation', badRv.length === 0, badRv.join(' ; '));
ok('review: "Total Days" is a formula adding the two day columns', f(rv.getCell('H9')) === 'F9+G9');
const T = 9 + nEmp - 1 + 3;
const engDays = exp.filter((x) => /engineer/i.test(x.p.position ?? '')).reduce((a, x) => a + x.x + x.y, 0), techDays = exp.filter((x) => /tech/i.test(x.p.position ?? '')).reduce((a, x) => a + x.x + x.y, 0);
ok('review: Total Engineer / Technition Days = SUMIF on the POSITION (hidden column M); other positions in neither', rv.getCell(T, 2).value === 'Total Engineer Days' && f(rv.getCell(T, 4)).startsWith('SUMIF($M$9:$M$14,"*engineer*"') && res(rv.getCell(T, 4)) === engDays && rv.getCell(T + 2, 2).value === 'Total Technition Days' && f(rv.getCell(T + 2, 4)).startsWith('SUMIF($M$9:$M$14,"*tech*"') && res(rv.getCell(T + 2, 4)) === techDays && rv.getColumn(13).hidden === true && rv.getCell('M9').value === 'Engineer', `${res(rv.getCell(T, 4))}/${engDays} ${res(rv.getCell(T + 2, 4))}/${techDays}`);
ok('review: Total Approved values come from the department data (264 / 295)', rv.getCell(T, 12).value === 264 && rv.getCell(T + 2, 12).value === 295);
ok('review: "Total Approved" labels and sign-offs', rv.getCell(T, 5).value === 'Total Approved (Engineer)' && rv.getCell(T + 2, 5).value === 'Total Approved (Tech)' && [...Array(8)].some((_, i) => rv.getCell(T + 5 + i, 1).value === 'Turbo-Machinery SH/DH') && [...Array(8)].some((_, i) => rv.getCell(T + 5 + i, 9).value === 'Turbo-Machinery AGM'));

// ---------- closeout B2B sheets (engineers / techs)
for (const [sheet, kind, re, approved] of [['Closeout B2B Eng', 'eng', /engineer/i, 264], ['Closeout B2B Tech', 'tech', /tech/i, 295]]) {
  const ws = wb.getWorksheet(sheet), who = people.filter((p) => re.test(p.position ?? ''));
  const rowsGot = []; for (let r = 11; r < 11 + who.length; r++) rowsGot.push(ws.getCell(r, 2).value);
  ok(`${sheet}: title, header groups and only the ${kind === 'eng' ? 'engineers' : 'techs'} in report order`, ws.getCell('D4').value === 'MONTHLY TIME SHEET REPORT (For Back to Back)' && ws.getCell('E9').value === 'Days No' && ws.getCell('J9').value === 'Over time' && ws.getCell('M9').value === 'Meals' && ws.getCell('P9').value === 'Transportation' && JSON.stringify(rowsGot) === JSON.stringify(who.map((p) => p.payroll)) && !ws.getCell(11 + who.length, 2).value, JSON.stringify(rowsGot));
  let bad = []; who.forEach((p, k) => { const r = 11 + k, x = exp[people.indexOf(p)]; const got = [res(ws.getCell(r, 6)), res(ws.getCell(r, 7)), res(ws.getCell(r, 18))]; const want = [x.xdays ?? null]; void want; const days = Number(res(ws.getCell(r, 6))) + Number(res(ws.getCell(r, 7))); if (days !== x.x + x.y || got[2] !== x.x + x.y || !f(ws.getCell(r, 6)).includes("'")) bad.push(p.payroll + ' ' + got); });
  ok(`${sheet}: X / Y days and the total per person equal the independent calculation and read the employee sheets`, bad.length === 0, bad.join(' ; '));
  const actual = who.reduce((a, p) => { const x = exp[people.indexOf(p)]; return a + x.x + x.y; }, 0);
  ok(`${sheet}: Actual No. of days = the sum of the totals (formula), Total No. B/B days = the approved total of the department (${approved})`, (who.length ? res(ws.getCell(11, 19)) === actual && f(ws.getCell(11, 19)).startsWith('SUM(') : true) && ws.getCell(11, 20).value === approved, `${res(ws.getCell(11, 19))}/${actual} ${ws.getCell(11, 20).value}`);
  ok(`${sheet}: header block (month, location, department, code) and the sign-offs`, ws.getCell('F5').value instanceof Date && ws.getCell('N7').value === 'Turbo-Machinery' && ws.getCell('S7').value === 'Department Code: 19' && [...Array(12)].some((_, i) => ws.getCell(11 + who.length + 2 + i, 1).value === 'Approval of Department AGM'));
}
// ---------- overtime summary
const ov = wb.getWorksheet('Overtime');
const withOt = exp.filter((x) => x.ot > 0);
ok('overtime sheet: title and only the people WITH overtime, in order, numbered', ov.getCell('A1').value === 'Turbo-Machinery EMC overtime' && withOt.every((x, k) => ov.getCell(4 + k, 2).value === x.p.full_name && ov.getCell(4 + k, 1).value === k + 1 && ov.getCell(4 + k, 3).value === x.p.opr) && !ov.getCell(4 + withOt.length, 2).value, `${withOt.length} people`);
const dateDays = [...new Set(people.flatMap((p) => exp[people.indexOf(p)].days.map((d, i) => (d.ot > 0 ? i + 1 : 0))).filter(Boolean))].sort((a, b) => a - b);
const totalCol = 4 + dateDays.length;
ok('overtime sheet: one DATE column per date that had overtime (hidden, as on the printed form), then Total', ov.getCell(3, totalCol).value === 'Total' && dateDays.every((d, k) => ov.getCell(3, 4 + k).value instanceof Date && ov.getCell(3, 4 + k).value.getUTCDate() === d && ov.getColumn(4 + k).hidden), `${dateDays}`);
ok('overtime sheet: each cell holds that person\'s hours on that date and Total reads the employee sheet (formula) with the right result', withOt.every((x, k) => dateDays.every((d, c) => (ov.getCell(4 + k, 4 + c).value ?? 0) === x.days[d - 1].ot) && res(ov.getCell(4 + k, totalCol)) === x.ot && f(ov.getCell(4 + k, totalCol)).includes(`'${empNames[people.indexOf(x.p)]}'!`)));
ok('overtime sheet: the three sign-offs (department AGM, Maintenance GM, DFGM) and the stamp box', (() => { const found = new Set(); ov.eachRow((r) => r.eachCell((c) => { if (c.value === 'Turbo-Machinery AGM' || c.value === 'Maintenance GM' || c.value === 'DFGM') found.add(c.value); })); return found.size === 3; })());

// ---------- stand-alone employee workbook (a person's own download)
{
  const w = await buildEmployeeWorkbook(model, official, ExcelJS, { loadAsset, employeeId: 'e1' }); const fl = join(dir, 'one.xlsx'); await w.xlsx.writeFile(fl);
  const r = new ExcelJS.Workbook(); await r.xlsx.readFile(fl); const s = r.worksheets[0];
  ok('single employee workbook: exactly one sheet, the Monthly Time Report of that person', r.worksheets.length === 1 && s.getCell('C8').value === 'Mohamed Salah Rashed' && s.getCell('P11').value === 'EMC-444');
  ok('...day cells hold plain VALUES (no day sheets to read) and the totals are still formulas', s.getCell('B17').value === 'Y' && s.getCell('I17').value === 6 && s.getCell('U30').value === 'Arrival - max' && f(s.getCell(T0 + 1, 5)).startsWith('COUNTIF(') && res(s.getCell(T0 + 1, 5)) === exp[0].x);
}

// ---------- other month lengths
{
  const m2 = buildModel({ sort: false, dept: { name: 'Ops' }, people: people.slice(0, 2), data: { status: new Map(), overtime: new Map(), holidays: new Set() }, year: 2028, month: 1 });   // Feb 2028 = 29 days
  const w = await buildOfficialWorkbook(m2, official, ExcelJS); const f2 = join(dir, 'feb.xlsx'); await w.xlsx.writeFile(f2);
  const r = new ExcelJS.Workbook(); await r.xlsx.readFile(f2);
  ok('February 2028 (29 days, no overtime -> no Overtime sheet): sheets 1..29, 2 employees, Review, B2B Eng, B2B Tech; day 29 sits in the right table', r.worksheets.length === 29 + 2 + 3 &&  !r.getWorksheet('Overtime') && r.worksheets[28].name === '29' && r.worksheets[r.worksheets.length - 1].name === 'Closeout B2B Tech' && r.worksheets[29].getCell('L28').value === 29);
  ok('...defaults when nothing is configured: "<name> Dept." title, "<name> SH/DH" sign-off, default field and sector in the banner, no department code', r.getWorksheet('1').getCell('A4').value === 'Ops Dept. Daily Attendance Sheet' && (r.getWorksheet('1').getCell('C1').value.richText ?? []).map((x) => x.text).join('').includes('Maintenance Sector') && (r.worksheets[29].getCell('P7').value ?? '') === '');
  ok('...an Overtime sheet with nobody in it is still created (title + sign-offs)', r.getWorksheet('Overtime').getCell('A1').value === 'Ops EMC overtime');
}
ok('report settings: banner defaults come from the form when the department has no field/sector', reportSettings({ department: 'X', report: {}, deptCode: '', sector: '', field: '' }, official).banner.join('|') === 'Rashid Petroleum & BURULLUS Gas Company|Operations [Fields]|Maintenance Sector');

// ---------- LibreOffice: recalculate everything from scratch and compare with the independent calculation
let soffice = null; try { soffice = execFileSync('which', ['soffice']).toString().trim(); } catch { /* not installed */ }
if (!soffice) console.log('SKIP: LibreOffice not installed - formula recalculation checks skipped');
else {
  const bare = await build('official-nocache.xlsx', { cacheResults: false });   // formulas WITHOUT cached results: the engine must compute them
  const out = join(dir, 'recalc'); execFileSync(soffice, ['--headless', '--convert-to', 'xlsx', '--outdir', out, bare], { stdio: 'ignore', timeout: 240000 });
  const rc = new ExcelJS.Workbook(); await rc.xlsx.readFile(join(out, 'official-nocache.xlsx'));
  const val = (ws, a, b) => { const v = (b === undefined ? ws.getCell(a) : ws.getCell(a, b)).value; if (v && typeof v === 'object' && 'formula' in v) return 'result' in v ? v.result : 0; return v; };
  const e1 = rc.getWorksheet(empNames[0]);
  ok('LibreOffice recalculation: day lookups (day 1 X, day 3 Y, day 31 X, a day with no record = E)', val(e1, 'B15') === 'X' && val(e1, 'B17') === 'Y' && val(e1, 'M30') === 'X' && val(e1, 'B20') === 'E', ['B15', 'B17', 'M30', 'B20'].map((a) => val(e1, a)).join(','));
  ok('LibreOffice recalculation: overtime, comments and transport columns come through (2h/"inventory", 6h/"Departure - night shift", 24h, EX 1 on 31)', val(e1, 'I15') === 2 && val(e1, 'J15') === 'inventory' && val(e1, 'I17') === 6 && val(e1, 'J17') === 'Departure - night shift' && val(e1, 'T30') === 24 && val(e1, 'S30') === 1 && val(e1, 'U30') === 'Arrival - max', ['I15', 'J15', 'I17', 'J17', 'T30', 'S30', 'U30'].map((a) => val(e1, a)).join(' | '));
  let badLo = [];
  people.forEach((p, i) => {
    const s = rc.getWorksheet(empNames[i]), x = exp[i];
    const got = [val(s, T0 + 1, 5), val(s, T0 + 1, 17), val(s, T0 + 4, 5) + val(s, T0 + 3, 17), val(s, T0 + 6, 21), val(s, T0 + 6, 20)], want = [x.x, x.y, x.ot, x.tin, x.tex];
    if (JSON.stringify(got) !== JSON.stringify(want)) badLo.push(`${p.opr}: ${got} vs ${want}`);
    const r = 9 + i, gr = [val(rc.getWorksheet('Review'), r, 6), val(rc.getWorksheet('Review'), r, 7), val(rc.getWorksheet('Review'), r, 8), val(rc.getWorksheet('Review'), r, 9), val(rc.getWorksheet('Review'), r, 10), val(rc.getWorksheet('Review'), r, 11)], wr = [x.x, x.y, x.x + x.y, x.ot, x.tex, x.tin];
    if (JSON.stringify(gr) !== JSON.stringify(wr)) badLo.push(`review ${p.opr}: ${gr} vs ${wr}`);
  });
  ok(`LibreOffice recalculation: employee totals AND the review sheet are correct for all ${nEmp} employees`, badLo.length === 0, badLo.join(' ; '));
  const rvl = rc.getWorksheet('Review');
  ok('LibreOffice recalculation: engineer days and technician days', val(rvl, T, 4) === engDays && val(rvl, T + 2, 4) === techDays, `${val(rvl, T, 4)} ${val(rvl, T + 2, 4)}`);
  const ovl = rc.getWorksheet('Overtime');
  ok('LibreOffice recalculation: the overtime summary totals', withOt.every((x, k) => val(ovl, 4 + k, totalCol) === x.ot), withOt.map((x, k) => val(ovl, 4 + k, totalCol)).join(','));
  ok('LibreOffice recalculation: no formula anywhere produces an error (#REF!, #N/A, #NAME?, #VALUE!)', await (async () => { let errs = 0; rc.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => { const v = c.value && typeof c.value === 'object' && 'result' in c.value ? c.value.result : c.value; if (v && typeof v === 'object' && 'error' in v) errs++; if (typeof v === 'string' && /^#(REF|N\/A|NAME|VALUE|DIV)/.test(v)) errs++; }))); return errs === 0; })());
}

console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL OFFICIAL-EXPORT TESTS PASSED ===');
console.log('files:', dir);
process.exit(fails ? 1 : 0);
