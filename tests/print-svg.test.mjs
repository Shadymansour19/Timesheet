// The fast print path (SVG pages in HTML) must look like the PDF it replaces: same page count and orientations, and almost the same pixels.
// The same report is built twice with the same page code (src/export/pdf.js): once as a real PDF (jsPDF), once as SVG HTML (src/export/print-svg.js); Chromium prints
// the HTML to PDF and poppler renders both for a pixel comparison. Needs Chromium (playwright), pdftoppm / pdfinfo (poppler) and python3 with PIL + numpy.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { jsPDF } from 'jspdf';
import { buildModel } from '../src/export/model.js';
import { buildOfficialPdf } from '../src/export/pdf.js';
import { makeSvgDoc } from '../src/export/print-svg.js';
import official from '../src/export/templates/official.js';

let fails = 0;
const ok = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond ? '' : ' ' + extra}`); };
const dir = mkdtempSync(join(tmpdir(), 'psvg-'));
const png = (f) => { const b = readFileSync(new URL('../public/templates/' + f, import.meta.url)); return { data: 'data:image/png;base64,' + b.toString('base64'), width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };
const logos = { left: png('logo-left.png'), right: png('logo-right.png') };
const N = 8;
const people = Array.from({ length: N }, (_, i) => ({ id: 'p' + i, full_name: `Person Number ${i}`, username: 'p' + i, opr: 'OPR-' + (100 + i), payroll: 'EMC-' + (100 + i), level: 3, position: i % 3 ? 'Engineer' : 'Tech', job_title: 'Engineer', contract_no: '033/2019', work_location: 'IDKU', residence: 'inside', y_allowed: true }));
const status = new Map(), overtime = new Map();
for (let d = 1; d <= 31; d++) for (let i = 0; i < N; i++) if ((d + i) % 3) { const k = `p${i}|2028-10-${String(d).padStart(2, '0')}`; status.set(k, (d + i) % 2 ? 'X' : 'Y'); if ((d + i) % 7 === 0) overtime.set(k, { hours: 2, note: 'night work' }); }
const model = buildModel({ dept: { name: 'Turbo', code: '19', approved_engineer: 264, approved_tech: 295, report: { dept_print_name: 'TURBO', location: 'IDKU' } }, people, data: { status, overtime, holidays: new Set() }, year: 2028, month: 9 });

let t0 = performance.now();
const pdf = buildOfficialPdf(model, official, { jsPDF, logos }); const tPdf = performance.now() - t0;
writeFileSync(join(dir, 'a.pdf'), Buffer.from(pdf.output('arraybuffer')));
t0 = performance.now();
const sd = buildOfficialPdf(model, official, { jsPDF: makeSvgDoc(jsPDF), logos }); const html = sd.toHtml('test'); const tSvg = performance.now() - t0;
ok(`the SVG build is faster than the PDF build (${Math.round(tSvg)} ms vs ${Math.round(tPdf)} ms)`, tSvg < tPdf);
ok('same number of pages as the PDF', sd.getNumberOfPages() === pdf.getNumberOfPages(), `${sd.getNumberOfPages()} vs ${pdf.getNumberOfPages()}`);
ok('portrait and landscape pages are marked (named @page rules)', /@page landscape/.test(html) && /class="pg l"/.test(html) && /class="pg p"/.test(html));
ok('the logos are embedded once and reused (not once per page)', (html.match(/data:image\/png;base64/g) || []).length === 2);
ok('no trailing blank page rule problems: the last page does not force a page break', /\.pg:last-child \{ break-after: auto/.test(html));
ok('the full report mixes portrait and landscape pages, so it is NOT sent through the HTML path (the PDF carries the orientation of every page)', sd.isUniform() === false);
const one = buildOfficialPdf(model, official, { jsPDF: makeSvgDoc(jsPDF), logos, employeeId: 'p1' });
ok('one person\'s page is a single-orientation job (HTML path)', one.isUniform() === true && one.getNumberOfPages() === 1 && /size: A4 portrait/.test(one.toHtml('t')));
const portrait = buildOfficialPdf(model, official, { jsPDF: makeSvgDoc(jsPDF), logos }); portrait.pages = portrait.pages.filter((q) => !q.land);
ok('the 31 + 8 portrait pages of the report are a single-orientation job too', portrait.isUniform() && portrait.getNumberOfPages() === 39);
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {}); const p = await (await b.newContext()).newPage();
await p.setContent(html, { waitUntil: 'load' }); await p.evaluate(() => document.fonts.ready);
await p.pdf({ path: join(dir, 'b.pdf'), preferCSSPageSize: true, printBackground: true }); await b.close();
const pages = (f) => +/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [f]).toString())[1];
ok('Chromium prints the HTML to the same number of pages (no blank or lost pages)', pages(join(dir, 'b.pdf')) === pdf.getNumberOfPages(), `${pages(join(dir, 'b.pdf'))} vs ${pdf.getNumberOfPages()}`);
for (const f of ['a', 'b']) execFileSync('pdftoppm', ['-r', '110', '-png', join(dir, `${f}.pdf`), join(dir, f)]);
const out = execFileSync('python3', ['-c', `
import glob, sys, numpy as np
from PIL import Image
a = sorted(glob.glob('${dir}/a-*.png')); b = sorted(glob.glob('${dir}/b-*.png'))
worst_mean = worst_pct = 0; bad = 0
for fa, fb in zip(a, b):
    A = Image.open(fa).convert('L'); B = Image.open(fb).convert('L')
    w = min(A.size[0], B.size[0]); h = min(A.size[1], B.size[1])
    if abs(A.size[0] - B.size[0]) > 2 or abs(A.size[1] - B.size[1]) > 2: bad += 1
    d = np.abs(np.asarray(A.crop((0, 0, w, h)), dtype=int) - np.asarray(B.crop((0, 0, w, h)), dtype=int))
    worst_mean = max(worst_mean, d.mean()); worst_pct = max(worst_pct, (d > 80).mean() * 100)
print(len(a), len(b), bad, round(worst_mean, 2), round(worst_pct, 2))
`]).toString().trim().split(' ').map(Number);
const [na, nb, badSize, worstMean, worstPct] = out;
ok('all pages have the same size as the PDF pages (orientation included)', na === nb && badSize === 0, out.join(' '));
ok(`the pages look like the PDF pages: worst page mean difference ${worstMean} (limit 5), differing pixels ${worstPct}% (limit 3.5%)`, worstMean < 5 && worstPct < 3.5);
{ const b2 = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {}); const p2 = await (await b2.newContext()).newPage(); await p2.setContent(portrait.toHtml('t'));
  for (const [label, o] of [['A4, no margins', { format: 'A4', margin: { top: '0', right: '0', bottom: '0', left: '0' } }], ['A4, 10 mm margins', { format: 'A4', margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } }], ['Letter, 1 cm margins', { format: 'Letter', margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' } }]]) {
    const f = join(dir, 'm.pdf'); await p2.pdf({ path: f, printBackground: true, ...o });
    ok(`no blank pages: ${label} still gives one sheet per page (${portrait.getNumberOfPages()})`, pages(f) === portrait.getNumberOfPages(), String(pages(f))); }
  await b2.close(); }
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL PRINT-SVG TESTS PASSED ===');
process.exit(fails ? 1 : 0);
