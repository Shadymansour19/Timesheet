// Official report as PDF: builds a real PDF, then reads it back with poppler (pdftotext / pdfinfo / pdfimages).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { jsPDF } from 'jspdf';
import { buildModel } from '../src/export/model.js';
import { buildOfficialPdf, buildGridPdf } from '../src/export/pdf.js';
import official from '../src/export/templates/official.js';

let fails = 0;
const ok = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond ? '' : ' ' + extra}`); };
const dir = mkdtempSync(join(tmpdir(), 'pdf-'));
const png = (f) => { const b = readFileSync(new URL('../public/templates/' + f, import.meta.url)); return { data: 'data:image/png;base64,' + b.toString('base64'), width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };
const logos = { left: png('logo-left.png'), right: png('logo-right.png') };
const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, full_name: i === 1 ? 'Ahmed محمد Ali' : `Person Number ${i}`, username: 'p' + i, opr: 'OPR-' + (100 + i), level: 2, job_title: i % 2 ? 'Engineer' : 'Technician', contract_no: '033/2019', residence: i % 3 ? 'inside' : 'outside', position: i % 2 ? 'Engineer' : 'Tech' }));
const run = (n, extra = {}) => {
  const people = mk(n), status = new Map(), overtime = new Map();
  status.set('p0|2028-10-05', 'X'); status.set('p0|2028-10-06', 'Y'); status.set('p0|2028-10-07', 'X'); overtime.set('p0|2028-10-06', { hours: 3, note: 'night' });
  const dept = { name: 'Turbo', code: '19', approved_engineer: 264, approved_tech: 295, report: { dept_print_name: 'TURBO', location: 'IDKU' } };
  const model = buildModel({ dept, people, data: { status, overtime, holidays: new Set() }, year: 2028, month: 9 });
  const doc = buildOfficialPdf(model, official, { jsPDF, logos, ...extra });
  const f = join(dir, `r${n}-${extra.employeeId ?? 'all'}.pdf`);
  writeFileSync(f, Buffer.from(doc.output('arraybuffer')));
  const info = execFileSync('pdfinfo', [f]).toString();
  return { f, pages: +/Pages:\s+(\d+)/.exec(info)[1], text: execFileSync('pdftotext', ['-layout', f, '-']).toString(), model };
};

const a = run(6);
ok('6 people: 31 day pages + 6 employee pages + review + overtime = 39 pages', a.pages === 39, a.pages);
ok('banner, title, manpower', /Rashid Petroleum & BURULLUS Gas Company/.test(a.text) && /Turbo Dept\. Daily Attendance Sheet/.test(a.text) && /EMC MANPOWER/.test(a.text));
ok('employee page labels', /MONTHLY TIME REPORT/.test(a.text) && /Contr\. No:/.test(a.text) && /PAYROLL/.test(a.text) && /033\/2019/.test(a.text));
ok('review + overtime titles', /Monthly Attendance Sheet Review/.test(a.text) && /Turbo EMC overtime/.test(a.text) && /Turbo SH\/DH/.test(a.text) && /Turbo AGM/.test(a.text));
ok('non-Latin characters replaced, not crashing', /Ahmed \?+ Ali/.test(a.text));
ok('arrival comment present', /Arrival/.test(a.text) && /Departure/.test(a.text));
ok('two logos embedded (one image object each, reused)', execFileSync('pdfimages', ['-list', a.f]).toString().split('\n').filter((l) => /\bimage\b/.test(l)).length >= 2);
import { fmtOpr } from '../src/lib/core.js';
ok('payroll display: integer gets EMC- prefix, existing prefix / text untouched', fmtOpr('1234') === 'EMC-1234' && fmtOpr(77) === 'EMC-77' && fmtOpr('EMC-5') === 'EMC-5' && fmtOpr(null) === '' && fmtOpr('OPR-1') === 'OPR-1');
const one = run(6, { employeeId: 'p0' });
ok('single employee PDF = 1 page with that person only', one.pages === 1 && /OPR-100/.test(one.text) && !/OPR-101/.test(one.text));
ok('single page: totals X=2 Y=1 OT 3', /Total \(X\) Days:\s+2/.test(one.text) && /Total \(Y\) Days:\s+1/.test(one.text));
ok('review page shows the approved totals from the department data', /Total Approved \(Engineer\)\s+264/.test(a.text) && /Total Approved \(Tech\)\s+295/.test(a.text), (a.text.match(/Total Approved[^\n]*/g) || []).join(' | '));
const big = run(40);
ok('40 people paginate: more pages than 6 people, review still has totals', big.pages > 31 + 40 + 2 && /Total Engineer Days/.test(big.text), big.pages);
const bigDay = execFileSync('pdftotext', ['-f', '1', '-l', '2', '-layout', big.f, '-']).toString();
ok('40-person day continues on a second page with header repeated', (bigDay.match(/TRANS\/IN/g) || []).length === 2, (bigDay.match(/TRANS\/IN/g) || []).length);
// ---- print sheet: the department month grid on ONE landscape A4 page
const gridOf = (n) => { const r = run(2).model; const people = mk(n); const model = buildModel({ dept: { name: 'Turbo', code: '19' }, people, data: { status: new Map([['p0|2028-10-05', 'X'], ['p0|2028-10-06', 'Y']]), overtime: new Map(), holidays: new Set(['2028-10-02']) }, year: 2028, month: 9 }); const doc = buildGridPdf(model, official, { jsPDF, logos }); const f = join(dir, `grid${n}.pdf`); writeFileSync(f, Buffer.from(doc.output('arraybuffer'))); const info = execFileSync('pdfinfo', [f]).toString(); return { f, pages: +/Pages:\s+(\d+)/.exec(info)[1], size: /Page size:\s+([\d.]+) x ([\d.]+)/.exec(info), text: execFileSync('pdftotext', ['-layout', f, '-']).toString() }; };
const g = gridOf(28);
ok('print grid: 28 people on ONE page, landscape A4', g.pages === 1 && Math.round(+g.size[1]) === 842 && Math.round(+g.size[2]) === 595, JSON.stringify([g.pages, g.size?.[0]]));
ok('print grid: title, month, names, totals and legend', /Turbo Dept\. - Monthly Timesheet/.test(g.text) && /Oct-28/.test(g.text) && /Person Number 27/.test(g.text) && /XH \/ YH/.test(g.text));
ok('print grid: 60 people still ONE page (rows shrink)', gridOf(60).pages === 1);
ok('print grid: an extreme headcount (200) continues on more pages instead of unreadable rows', gridOf(200).pages > 1);
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
