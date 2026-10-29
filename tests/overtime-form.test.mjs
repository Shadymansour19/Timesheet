// The overtime form (src/export/overtime-form.js): the grouping of same notes into one "work required" cell, hours per employee, pages, the printable HTML (Chromium prints it
// upright on A4, one sheet per page, whatever the margins) and the Excel workbook (read back with ExcelJS). Needs Chromium (playwright) and pdfinfo / pdftotext (poppler).
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { buildForms, formsHtml, buildOvertimeWorkbook, formSettings, TEXT } from '../src/export/overtime-form.js';

let fails = 0;
const ok = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond ? '' : ' ' + extra}`); };
const dir = mkdtempSync(join(tmpdir(), 'otf-'));
const asset = (f) => readFileSync(new URL('../public/templates/' + f, import.meta.url));
const png = (f) => { const b = asset(f); return { data: 'data:image/png;base64,' + b.toString('base64'), width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };
const logos = { left: png('logo-left.png'), right: png('logo-right.png') };

const NOTE = 'Invistigation of Discharge valve Trip Train A Booster Compressor';
const names = ['Mohamed Salah', 'Hassan Abdelsalam', 'Mohamed Ahmed', 'Mohamed Gomaa', 'Islam Ashraf', 'Hamdy Mahmoud', 'Ali Fathy'];
const people = names.map((n, i) => ({ id: 'p' + i, full_name: n, payroll: 'EMC-' + (400 + i) }));
const D1 = '2026-10-22', D2 = '2026-10-23';
const ot = new Map([
  ['p0|' + D1, { hours: 1, note: '' }],
  ['p1|' + D1, { hours: 2, note: NOTE }],
  ['p2|' + D1, { hours: 3, note: '  ' + NOTE.toUpperCase().replace(/ /g, '  ') + ' ' }],       // the same note: other case, extra blanks
  ['p3|' + D1, { hours: 2, note: NOTE }],
  ['p4|' + D1, { hours: 4, note: 'مشتريات' }],
  ['p5|' + D1, { hours: 4, note: 'مشتريات' }],
  ['p6|' + D1, { hours: 0, note: 'no hours: not on the form' }],
  ['p0|' + D2, { hours: 2, note: '' }],
  ['p1|' + D2, { hours: 2, note: '' }],                                                          // two people without a note are NOT merged
]);
const dept = { name: 'Turbo', report: { dept_ar: 'التوربينات' } };

// ---------- the model ----------
const forms = buildForms({ dept, people, overtime: ot, days: [D1, D2, '2026-10-24'] });
ok('one form per day with overtime (a day without overtime gets none)', forms.length === 2 && forms[0].day === D1 && forms[1].day === D2);
const f1 = forms[0];
ok('rows are numbered and keep the employees\' order; hours = 0 are left out', f1.rows.map((r) => r.no).join() === '1,2,3,4,5,6' && f1.rows.map((r) => r.name).join() === 'Mohamed Salah,Hassan Abdelsalam,Mohamed Ahmed,Mohamed Gomaa,Islam Ashraf,Hamdy Mahmoud');
ok('no note: not merged (span 1)', f1.rows[0].span === 1 && f1.rows[0].note === '');
ok('three people with the same note (any case / blanks): ONE cell over 3 rows, the first note shown', f1.rows[1].span === 3 && f1.rows[1].note === NOTE && f1.rows[2].span === 0 && f1.rows[2].skip && f1.rows[3].span === 0 && f1.rows[3].skip);
ok('hours stay per employee', f1.rows.map((r) => r.hours).join() === '1,2,3,2,4,4');
ok('the Arabic note is merged over 2 rows', f1.rows[4].span === 2 && f1.rows[4].note === 'مشتريات' && f1.rows[5].skip);
ok('people without a note are not merged with each other', forms[1].rows.every((r) => r.span === 1 && !r.skip));
ok('weekday and date in Arabic form', f1.weekday === 'الخميس' && f1.dateText === '22/10/2026' && forms[1].weekday === 'الجمعة');
ok('department line and sign-off titles come from the settings (Arabic department name)', f1.general === 'الصيانة / التوربينات' && f1.signLeft === TEXT.signLeft && f1.signRight === `${TEXT.signRightPrefix} التوربينات`);
const S = formSettings({ name: 'Turbo', report: { dept_ar: 'X', ot_sign_left: 'L', ot_sign_right: 'R' } });
ok('own sign-off titles win over the defaults; no Arabic name falls back to the department name', S.signLeft === 'L' && S.signRight === 'R' && formSettings({ name: 'Turbo' }).deptAr === 'Turbo');

const many = Array.from({ length: 45 }, (_, i) => ({ id: 'q' + i, full_name: 'Person ' + i, payroll: 'E' + i }));
const otMany = new Map(many.map((p, i) => [`${p.id}|${D1}`, { hours: 1, note: i < 30 ? 'same' : 'n' + i }]));
const pages = buildForms({ dept, people: many, overtime: otMany, days: [D1] });
ok('many rows: several pages, numbering goes on, every page says "page n of m"', pages.length === 3 && pages[1].rows[0].no === pages[0].rows.length + 1 && pages.every((p, i) => p.part === i + 1 && p.parts === 3));
ok('a group longer than a page is split, the note is repeated at the top of each part', pages[0].rows[0].note === 'same' && pages[1].rows[0].note === 'same' && pages[0].rows[0].span === pages[0].rows.length);
ok('no page is longer than 20 rows and all 45 people are on some page', pages.every((p) => p.rows.length <= 20) && pages.reduce((a, p) => a + p.rows.length, 0) === 45);
const small = buildForms({ dept, people: many, overtime: new Map(many.slice(0, 5).map((p) => [`${p.id}|${D1}`, { hours: 1, note: 'together' }])), days: [D1] });
ok('a group that fits is kept together on one page', small.length === 1 && small[0].rows[0].span === 5);
const long = buildForms({ dept, people: many.slice(0, 40), overtime: new Map(many.slice(0, 40).map((p, i) => [`${p.id}|${D1}`, { hours: 1, note: i >= 14 && i < 24 ? 'a' : 'b' + i }])), days: [D1] });
ok('a group that does not fit the rest of a page moves to the next page whole', long.filter((p) => p.rows.some((r) => r.note === 'a')).length === 1 && long.reduce((a, p) => a + p.rows.length, 0) === 40);

// ---------- the printable HTML: Chromium prints it as upright A4 pages ----------
const html = formsHtml(forms, { logos, title: 'Turbo 2026-10' });
ok('A4 portrait is asked for (the form is never rotated)', /@page \{ size: A4 portrait; margin: 0 \}/.test(html) && !/landscape/.test(html));
ok('right-to-left Arabic page, two logos embedded', /dir="rtl"/.test(html) && (html.match(/data:image\/png;base64/g) || []).length === forms.length * 2);
ok('the work cell of a group is one cell with a rowspan', (html.match(/rowspan="3"/g) || []).length === 1 && (html.match(/rowspan="2"/g) || []).length === 1 && (html.match(/Invistigation/g) || []).length === 1);
ok('no blank trailing page rule: the last page does not force a break', /\.pg:last-child \{[^}]*break-after: auto/.test(html));
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {}); const p = await (await b.newContext()).newPage();
await p.setContent(html, { waitUntil: 'load' }); await p.evaluate(() => document.fonts.ready);
const pdfPages = (f) => +/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [f]).toString())[1];
for (const [label, o] of [['A4, no margins', { format: 'A4', margin: { top: '0', right: '0', bottom: '0', left: '0' } }], ['A4, 10 mm margins', { format: 'A4', margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } }], ['Letter, 1 cm margins', { format: 'Letter', margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' } }]]) {
  const f = join(dir, 'p.pdf'); await p.pdf({ path: f, printBackground: true, ...o });
  ok(`${label}: one sheet per form, no blank page (${forms.length})`, pdfPages(f) === forms.length, String(pdfPages(f)));
}
const f = join(dir, 'a4.pdf'); await p.pdf({ path: f, preferCSSPageSize: true, printBackground: true });
const info = execFileSync('pdfinfo', [f]).toString();
ok('the printed file is A4 portrait (594.96 x 841.92 pt)', /Page size:\s+594\.9\d x 841\.9\d pts/.test(info), info.match(/Page size.*/)?.[0]);
const text = (n) => execFileSync('pdftotext', ['-f', String(n), '-l', String(n), '-layout', f, '-']).toString().normalize('NFKC');
const squash = (x) => x.replace(/[\s\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
const has = (txt, word) => squash(txt).includes(word) || squash(txt).includes([...word].reverse().join(''));         // poppler hands Arabic back with gaps between letters, maybe in visual order
ok('page 1 carries the title, the date and the sign-off texts', has(text(1), 'بيان') && has(text(1), 'المكلفين') && text(1).includes('22/10/2026') && has(text(1), 'الصيانة') && has(text(1), 'التوربينات'), text(1).slice(0, 400));
ok('page 1 shows the merged note once and every employee', (text(1).match(/Invistigation/g) || []).length === 1 && names.slice(0, 6).every((n) => text(1).includes(n)) && !text(1).includes('no hours'));
ok('page 2 is the next day', text(2).includes('23/10/2026') && has(text(2), 'الجمعة'));
// wide and tall viewports must not change the page (everything is relative to the sheet)
const big = buildForms({ dept, people: many, overtime: new Map(many.slice(0, 20).map((q, i) => [`${q.id}|${D1}`, { hours: 1 + (i % 3), note: 'x'.repeat(i % 4 === 0 ? 190 : 5) + i }])), days: [D1] });
await p.setContent(formsHtml(big, { logos })); await p.evaluate(() => document.fonts.ready);
const gaps = await p.evaluate(() => [...document.querySelectorAll('.pg')].map((pg) => pg.querySelector('.sign').getBoundingClientRect().top - pg.querySelector('table').getBoundingClientRect().bottom));
ok('the table never reaches the sign-offs (long notes included)', gaps.every((g) => g > 0), gaps.join());
await b.close();

// ---------- the Excel workbook ----------
const wb = await buildOvertimeWorkbook(forms, ExcelJS, { loadAsset: async (u) => { const buf = asset(u.replace('/templates/', '')); return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); } });
const back = new ExcelJS.Workbook(); await back.xlsx.load(await wb.xlsx.writeBuffer());
ok('one sheet per form, named by the day', back.worksheets.map((w) => w.name).join() === '22-Oct,23-Oct');
const ws = back.worksheets[0];
ok('right-to-left sheet, A4 portrait, one page wide', ws.views[0].rightToLeft === true && ws.pageSetup.orientation === 'portrait' && ws.pageSetup.paperSize === 9 && ws.pageSetup.fitToWidth === 1);
ok('both logos are placed', ws.getImages().length === 2);
ok('the table head is the five columns of the form', [1, 2, 3, 4, 5].map((c) => ws.getCell(7, c).value).join() === TEXT.cols.join());
ok('the title and the day are written', ws.getCell(2, 1).value === TEXT.title && ws.getCell(5, 1).value.includes('22/10/2026'));
const merges = ws.model.merges;
ok('the three rows with the same note have one merged work cell, the two others another', merges.includes('D9:D11') && merges.includes('D12:D13'), merges.join());
ok('the merged cell holds the note once; hours and numbers are per row', ws.getCell('D9').value === NOTE && ws.getCell('D10').isMerged && ws.getCell('D10').master.address === 'D9' && ws.getCell('D13').master.address === 'D12' && !ws.getCell('D8').isMerged && [8, 9, 10, 11, 12, 13].map((r) => ws.getCell(r, 5).value).join() === '1,2,3,2,4,4' && [8, 9, 10, 11, 12, 13].map((r) => ws.getCell(r, 1).value).join() === '1,2,3,4,5,6');
ok('names and payroll numbers are in their columns', ws.getCell('B9').value === 'Hassan Abdelsalam' && ws.getCell('C9').value === 'EMC-401');
ok('the two sign-off titles close the sheet (right title in column A, which is on the right)', ws.getCell('A16').value === f1.signRight && ws.getCell('D16').value === f1.signLeft && merges.includes('A16:B16') && merges.includes('D16:E16'), merges.join());

console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL OVERTIME FORM TESTS PASSED ===');
process.exit(fails ? 1 : 0);
