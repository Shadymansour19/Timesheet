// Builds real .xlsx files from synthetic data, re-reads them from disk and checks the cell contents.
// Run: node tests/export.test.mjs
import ExcelJS from 'exceljs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildModel } from '../src/export/model.js';
import { buildWorkbook } from '../src/export/engine.js';
import defaultTemplate from '../src/export/templates/default.js';

let fails = 0;
const ok = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond ? '' : ' ' + extra}`); };
const dir = mkdtempSync(join(tmpdir(), 'xlsx-'));

// Feb 2028 (leap year, 29 days). Holiday on the 2nd and 3rd.
const people = [
  { id: 'u1', full_name: 'Alice A', username: 'alice', opr: 'OPR-1', payroll: 'OPR-1', level: 3 },
  { id: 'u2', full_name: 'Bob B', username: 'bob', opr: 'OPR-2', payroll: 'OPR-2', level: null },
  { id: 'u3', full_name: 'Zoe Z', username: 'zoe', opr: 'OPR-3', payroll: 'OPR-3', level: 1 },
];
const data = {
  status: new Map([
    ['u1|2028-02-01', 'X'], ['u1|2028-02-02', 'X'],   // 2nd is a holiday -> XH
    ['u1|2028-02-03', 'Y'],                           // holiday -> YH
    ['u1|2028-02-10', 'Y'],
    ['u2|2028-02-29', 'X'],                           // last day of a leap month
  ]),
  overtime: new Map([['u1|2028-02-01', { hours: 2 }], ['u1|2028-02-10', { hours: 24 }], ['u2|2028-02-15', { hours: 5 }]]),
  holidays: new Set(['2028-02-02', '2028-02-03', '2028-02-04']), // the 4th: nobody has a status -> E stays E
};
const model = buildModel({ dept: { name: 'Operations' }, people, data, year: 2028, month: 1 });

ok('model has 29 days', model.days.length === 29);
ok('model: alice totals', JSON.stringify(model.employees[0].totals) === JSON.stringify({ X: 1, Y: 1, XH: 1, YH: 1, E: 25, ot: 26 }), JSON.stringify(model.employees[0].totals));
ok('model: every employee has 29 cells that sum to 29', model.employees.every((e) => e.cells.length === 29 && e.totals.X + e.totals.Y + e.totals.XH + e.totals.YH + e.totals.E === 29));

for (const lang of ['en', 'ar']) {
  const file = join(dir, `default-${lang}.xlsx`);
  await (await buildWorkbook(model, defaultTemplate, lang, ExcelJS)).xlsx.writeFile(file);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);          // read back from disk
  const ws = wb.worksheets[0];
  const L = defaultTemplate.labels[lang];
  ok(`[${lang}] sheet name 2028-02`, ws.name === '2028-02');
  ok(`[${lang}] title + department`, ws.getCell('A1').value === L.title && ws.getCell('A2').value === `${L.department}: Operations`);
  ok(`[${lang}] RTL flag ${lang === 'ar'}`, (ws.views[0].rightToLeft ?? false) === (lang === 'ar'));
  ok(`[${lang}] header names`, ws.getCell('B4').value === L.name && ws.getCell('C4').value === L.opr);
  const d1 = 5; // first day column index (4 fixed columns)
  ok(`[${lang}] day header 1 and 29`, ws.getCell(4, d1).value === 1 && ws.getCell(4, d1 + 28).value === 29);
  // rows: alice=6 bob=7 zoe=8 (sorted as given)
  const v = (r, day) => ws.getCell(r, d1 + day - 1).value;
  ok(`[${lang}] alice d1=X d2=XH d3=YH d4=E d10=Y`, v(6, 1) === 'X' && v(6, 2) === 'XH' && v(6, 3) === 'YH' && v(6, 4) === 'E' && v(6, 10) === 'Y', [1, 2, 3, 4, 10].map((d) => v(6, d)).join());
  ok(`[${lang}] bob d29=X (leap day), d1=E`, v(7, 29) === 'X' && v(7, 1) === 'E');
  ok(`[${lang}] zoe all E`, Array.from({ length: 29 }, (_, i) => v(8, i + 1)).every((x) => x === 'E'));
  ok(`[${lang}] names/OPR/level`, ws.getCell('B6').value === 'Alice A' && ws.getCell('C7').value === 'OPR-2' && ws.getCell('D6').value === 3 && (ws.getCell('D7').value ?? '') === '');
  ok(`[${lang}] holiday header cells flagged amber`, ws.getCell(4, d1 + 1).fill.fgColor.argb === defaultTemplate.colors.holidayHeader && ws.getCell(4, d1 + 4).fill.fgColor.argb === defaultTemplate.colors.header);
  const raw = (r, k) => ws.getCell(r, d1 + 29 + k).value;          // totals: X Y XH YH OT
  const tot = (r, k) => { const x = raw(r, k); return typeof x === 'object' ? x : { result: x }; };
  ok(`[${lang}] alice totals X=1 Y=1 XH=1 YH=1`, tot(6, 0).result === 1 && tot(6, 1).result === 1 && tot(6, 2).result === 1 && tot(6, 3).result === 1);
  ok(`[${lang}] zero totals are visible numbers, never blank (zoe, bob)`, [0, 1, 2, 3, 4].every((k) => raw(8, k) === 0) && raw(7, 1) === 0 && tot(7, 0).result === 1 && tot(7, 4).result === 5);
  ok(`[${lang}] totals are live COUNTIF formulas over the right range`, tot(6, 0).formula === 'COUNTIF(E6:AG6,"X")' && tot(6, 2).formula === 'COUNTIF(E6:AG6,"XH")', tot(6, 0).formula);
  ok(`[${lang}] alice overtime total 26 (2+24), bob 5, zoe 0`, tot(6, 4).result === 26 && tot(7, 4).result === 5 && tot(8, 4).result === 0, `${tot(6, 4).result}`);
  ok(`[${lang}] overtime cell note present on OT day`, ws.getCell(6, d1).note != null);
  const ot = wb.worksheets[1];
  ok(`[${lang}] overtime sheet per-day values`, ot.getCell(2, 2).value === 2 && ot.getCell(2, 11).value === 24 && ot.getCell(3, 16).value === 5);
  ok(`[${lang}] legend row present`, String(ws.getCell(10, 1).value) === L.legend);
}

// Arabic content really is Arabic
{
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(join(dir, 'default-ar.xlsx'));
  ok('[ar] Arabic title text', /[؀-ۿ]/.test(String(wb.worksheets[0].getCell('A1').value)));
}

// 'fill' mode: write into a supplied template, keeping its own formatting
{
  const tplWb = new ExcelJS.Workbook(); const s = tplWb.addWorksheet('Form');
  s.getCell('A1').value = 'OFFICIAL FORM HEADER';
  s.getCell('A8').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  s.getCell('A8').border = { top: { style: 'medium' } };
  const tplFile = join(dir, 'official.xlsx'); await tplWb.xlsx.writeFile(tplFile);
  const fillTpl = { id: 't', mode: 'fill', source: tplFile, sheet: 1, cells: { department: 'C2', month: 'C3' }, firstEmployeeRow: 8,
    columns: { no: 'A', name: 'B', opr: 'C', level: 'D' }, firstDayColumn: 'E', dayValue: 'eff', totals: { X: 'AI', Y: 'AJ', XH: 'AK', YH: 'AL', ot: 'AM' } };
  const wb = await buildWorkbook(model, fillTpl, 'en', ExcelJS, { loadSource: async (f) => (await import('node:fs/promises')).readFile(f) });
  const out = join(dir, 'filled.xlsx'); await wb.xlsx.writeFile(out);
  const r = new ExcelJS.Workbook(); await r.xlsx.readFile(out); const ws = r.getWorksheet(1);
  ok('[fill] template content preserved', ws.getCell('A1').value === 'OFFICIAL FORM HEADER');
  ok('[fill] header cells', ws.getCell('C2').value === 'Operations' && ws.getCell('C3').value === 'February 2028');
  ok('[fill] employee rows 8..10 with names', ws.getCell('B8').value === 'Alice A' && ws.getCell('B9').value === 'Bob B' && ws.getCell('B10').value === 'Zoe Z');
  ok('[fill] day values (alice d2=XH, bob d29=X)', ws.getCell('F8').value === 'XH' && ws.getCell(9, 5 + 28).value === 'X');
  ok('[fill] totals columns', ws.getCell('AI8').value === 1 && ws.getCell('AM8').value === 26 && ws.getCell('AM9').value === 5);
  ok('[fill] row styling cloned to extra employee rows', ws.getCell('A10').fill?.fgColor?.argb === 'FFFFFF00' && ws.getCell('A10').border?.top?.style === 'medium');
}

console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL EXPORT TESTS PASSED ===');
console.log('files:', dir);
process.exit(fails ? 1 : 0);
