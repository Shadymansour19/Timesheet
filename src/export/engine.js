import { buildModel } from './model.js';
import defaultTemplate from './templates/default.js';
import officialTemplate from './templates/official.js';
import { buildOfficialWorkbook, buildEmployeeWorkbook } from './official.js';

// Selectable formats; the official monthly report is the default.
export const templates = { official: officialTemplate, simple: defaultTemplate };
export const activeTemplate = officialTemplate;

const colIndex = (letters) => letters.toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colLetter = (n) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const pick = (labels, lang) => labels[lang] ?? labels.en;
// ExcelJS drops a cached result of 0, which leaves the cell blank in viewers that do not recalculate
// (phone previews, scripts). Zero is therefore written as a plain number; non-zero totals stay live formulas.
const live = (formula, result) => (result === 0 ? 0 : { formula, result });
const thin = { style: 'thin', color: { argb: 'FFB0B7BF' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

// Pure: builds an ExcelJS workbook from the model. `ExcelJS` is injected so Node tests can call it too.
export async function buildWorkbook(model, template, lang, ExcelJS, { loadSource, loadAsset } = {}) {
  if (template.mode === 'official') return buildOfficialWorkbook(model, template, ExcelJS, { loadAsset });
  return template.mode === 'fill'
    ? fillWorkbook(model, template, ExcelJS, loadSource)
    : generateWorkbook(model, template, lang, ExcelJS);
}

function generateWorkbook(model, tpl, lang, ExcelJS) {
  const L = pick(tpl.labels, lang);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(tpl.sheetName(model), {
    views: [{ rightToLeft: lang === 'ar', state: 'frozen', xSplit: tpl.columns.length, ySplit: 5 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const nFixed = tpl.columns.length, nDays = model.days.length;
  const firstDay = nFixed + 1, lastDay = nFixed + nDays;
  const lastCol = lastDay + tpl.totals.length;
  const monthName = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en', { month: 'long', year: 'numeric' })
    .format(new Date(model.year, model.month, 1));

  ws.getCell(1, 1).value = `${L.title}`; ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.getCell(2, 1).value = `${L.department}: ${model.department}`;
  ws.getCell(3, 1).value = `${L.month}: ${monthName}`;

  // header rows 4 (labels / day numbers) and 5 (weekday)
  tpl.columns.forEach((c, i) => { ws.getCell(4, i + 1).value = c.header(L); ws.mergeCells(4, i + 1, 5, i + 1); ws.getColumn(i + 1).width = c.width; });
  model.days.forEach((d, i) => {
    const col = firstDay + i;
    ws.getCell(4, col).value = d.day;
    ws.getCell(5, col).value = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en', { weekday: 'narrow' }).format(new Date(model.year, model.month, d.day));
    ws.getColumn(col).width = tpl.dayWidth;
  });
  tpl.totals.forEach((c, i) => { const col = lastDay + 1 + i; ws.getCell(4, col).value = c.header(L); ws.mergeCells(4, col, 5, col); ws.getColumn(col).width = c.width; });
  for (let r = 4; r <= 5; r++) for (let c = 1; c <= lastCol; c++) {
    const cell = ws.getCell(r, c);
    const dayIdx = c - firstDay;
    const hol = dayIdx >= 0 && dayIdx < nDays && model.days[dayIdx].holiday;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hol ? tpl.colors.holidayHeader : tpl.colors.header } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = border;
  }

  model.employees.forEach((e, i) => {
    const r = 6 + i;
    tpl.columns.forEach((c, k) => { const cell = ws.getCell(r, k + 1); cell.value = c.value(e, i); cell.border = border; if (k !== 1) cell.alignment = { horizontal: 'center' }; });
    e.cells.forEach((c, k) => {
      const cell = ws.getCell(r, firstDay + k);
      cell.value = c.eff;
      cell.alignment = { horizontal: 'center' };
      cell.border = border;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tpl.colors[c.eff] } };
      if (c.ot) cell.note = `${L.ot}: ${c.ot}`;
    });
    const range = `${colLetter(firstDay)}${r}:${colLetter(lastDay)}${r}`;
    tpl.totals.forEach((t, k) => {
      const cell = ws.getCell(r, lastDay + 1 + k);
      cell.value = t.count
        ? live(`COUNTIF(${range},"${t.count}")`, e.totals[t.count])
        : e.totals[t.sum];
      cell.alignment = { horizontal: 'center' }; cell.border = border;
    });
  });
  // Overtime is not visible in the status grid, so it is also summed from per-day values kept in a second sheet.
  const otSheet = wb.addWorksheet(lang === 'ar' ? 'الإضافي' : 'Overtime');
  otSheet.getCell(1, 1).value = L.name;
  model.days.forEach((d, i) => { otSheet.getCell(1, 2 + i).value = d.day; });
  otSheet.getCell(1, 2 + nDays).value = L.ot;
  model.employees.forEach((e, i) => {
    otSheet.getCell(2 + i, 1).value = e.fullName;
    e.cells.forEach((c, k) => { otSheet.getCell(2 + i, 2 + k).value = c.ot || null; });
    otSheet.getCell(2 + i, 2 + nDays).value = live(`SUM(${colLetter(2)}${2 + i}:${colLetter(1 + nDays)}${2 + i})`, e.totals.ot);
  });
  otSheet.getColumn(1).width = 28;
  otSheet.views = [{ rightToLeft: lang === 'ar', state: 'frozen', xSplit: 1, ySplit: 1 }];

  // OT total on the main sheet links to the overtime sheet.
  const otCol = tpl.totals.findIndex((t) => t.sum === 'ot');
  if (otCol >= 0) model.employees.forEach((e, i) => {
    ws.getCell(6 + i, lastDay + 1 + otCol).value = live(`'${otSheet.name}'!${colLetter(2 + nDays)}${2 + i}`, e.totals.ot);
  });

  ws.getCell(7 + model.employees.length, 1).value = L.legend;
  ws.mergeCells(7 + model.employees.length, 1, 7 + model.employees.length, lastCol);
  ws.getCell(7 + model.employees.length, 1).font = { italic: true, color: { argb: 'FF66788A' } };
  return wb;
}

async function fillWorkbook(model, tpl, ExcelJS, loadSource) {
  if (!loadSource) throw new Error('fill template needs a loadSource function');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await loadSource(tpl.source));
  const ws = wb.getWorksheet(tpl.sheet);
  if (!ws) throw new Error(`template sheet not found: ${tpl.sheet}`);
  const monthName = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(model.year, model.month, 1));
  if (tpl.cells?.department) ws.getCell(tpl.cells.department).value = model.department;
  if (tpl.cells?.month) ws.getCell(tpl.cells.month).value = monthName;
  const first = colIndex(tpl.firstDayColumn);
  model.employees.forEach((e, i) => {
    const r = tpl.firstEmployeeRow + i;
    if (i > 0) { // extra employees reuse the styling of the first template row
      const src = ws.getRow(tpl.firstEmployeeRow), dst = ws.getRow(r);
      src.eachCell({ includeEmpty: true }, (c, n) => { dst.getCell(n).style = JSON.parse(JSON.stringify(c.style)); });
    }
    for (const [k, col] of Object.entries(tpl.columns)) ws.getCell(`${col}${r}`).value = k === 'no' ? i + 1 : (e[k === 'name' ? 'fullName' : k] ?? '');
    e.cells.forEach((c, k) => { ws.getCell(r, first + k).value = tpl.dayValue === 'status' ? c.status : c.eff; });
    for (const [k, col] of Object.entries(tpl.totals ?? {})) ws.getCell(`${col}${r}`).value = e.totals[k];
  });
  return wb;
}

// Browser: data model -> file download. Libraries (exceljs ~1 MB, jsPDF) are loaded only when exporting.
// format: 'xlsx' | 'pdf'. employeeId: only that person's Monthly Time Report (their own timesheet).
const loadAsset = async (url) => { const r = await fetch(url); return r.ok && (r.headers.get('content-type') || '').startsWith('image/') ? r.arrayBuffer() : null; };   // the host serves index.html for unknown paths: accept real images only
async function loadPdfLogos(tpl) {
  const logos = {};
  for (const side of ['left', 'right']) {
    try {
      const buf = await loadAsset(`${tpl.logoBase}-${side}.png`);
      if (!buf) continue;
      const bytes = new Uint8Array(buf), dv = new DataView(buf);
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      logos[side] = { data: 'data:image/png;base64,' + btoa(bin), width: dv.getUint32(16), height: dv.getUint32(20) };
    } catch { /* no logo */ }
  }
  return logos;
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export async function exportMonth({ dept, people, data, year, month, lang, template = activeTemplate, format = 'xlsx', employeeId = null }) {
  const model = buildModel({ dept, people: employeeId ? people.filter((p) => p.id === employeeId) : people, data, year, month });
  const safe = (employeeId ? (model.employees[0]?.fullName ?? 'timesheet') : (dept?.name ?? 'department')).replace(/[^\p{L}\p{N}_-]+/gu, '_');
  const stamp = `${model.year}-${String(model.month + 1).padStart(2, '0')}`;
  if (format === 'pdf') {
    const [{ jsPDF }, { buildOfficialPdf }] = await Promise.all([import('jspdf'), import('./pdf.js')]);
    const doc = buildOfficialPdf(model, officialTemplate, { jsPDF, logos: await loadPdfLogos(officialTemplate), employeeId });
    download(doc.output('blob'), `timesheet_${safe}_${stamp}.pdf`);
    return;
  }
  const ExcelJS = (await import('exceljs')).default;
  const wb = employeeId && template.mode === 'official'
    ? await buildEmployeeWorkbook(model, template, ExcelJS, { loadAsset, employeeId })
    : await buildWorkbook(model, template, lang, ExcelJS, { loadSource: async (url) => (await fetch(url)).arrayBuffer(), loadAsset });
  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `timesheet_${safe}_${stamp}.xlsx`);
}

// Print only - nothing is downloaded. 1) FAST PATH: the official report is drawn by the same page code as the PDF, but into SVG pages of plain HTML
// (src/export/print-svg.js), which the browser prints at once from a hidden frame: no PDF to build, no PDF viewer to wait for; 2) if that fails, the
// PDF (all A4 pages; with employeeId only that person's page) is built in memory and sent to the printer through the frame (A4 + "print at actual size" hints);
// 3) if that fails too, the Excel version is built in memory, turned into printable A4 HTML and printed; 4) if all fail, an error is thrown (the caller shows a
// message). Returns 'html' (the fast path), 'pdf' or 'excel'.
function printFrame({ url, html }) {
  return new Promise((resolve, reject) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;inset-inline-end:0;inset-block-end:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    let done = false;
    const finish = (err) => { if (done) return; done = true; if (err) { f.remove(); if (url) URL.revokeObjectURL(url); reject(err); } else { resolve(); setTimeout(() => { f.remove(); if (url) URL.revokeObjectURL(url); }, 60000); } };
    f.onload = async () => {
      try {
        const w = f.contentWindow, d = w.document;
        // printing HTML: wait for what the pages need (fonts, the logos), never for anything else
        if (html && d) { try { await d.fonts?.ready; await Promise.all([...(d.images ?? [])].map((i) => i.decode?.().catch(() => {}))); } catch { /* print anyway */ } }
        w.focus(); w.print(); finish();
      } catch (e) { finish(e); }
    };
    f.onerror = () => finish(new Error('print frame failed'));
    setTimeout(() => finish(new Error('print frame did not load')), 15000);
    if (url) f.src = url; else f.srcdoc = html;
    document.body.append(f);
  });
}

export async function printMonth({ dept, people, data, year, month, lang, employeeId = null }) {
  const model = buildModel({ dept, people: employeeId ? people.filter((p) => p.id === employeeId) : people, data, year, month });
  try {                                                                    // 1) the fast path: SVG pages in HTML
    // the report mixes portrait and landscape pages: that needs named @page rules (Chrome, Edge, Firefox); a browser without them (Safari) takes the PDF instead
    if (typeof CSS === 'undefined' || !CSS.supports?.('page', 'portrait')) throw new Error('named pages are not supported here');
    const [{ jsPDF }, pdf, { makeSvgDoc }] = await Promise.all([import('jspdf'), import('./pdf.js'), import('./print-svg.js')]);
    const doc = pdf.buildOfficialPdf(model, officialTemplate, { jsPDF: makeSvgDoc(jsPDF), logos: await loadPdfLogos(officialTemplate), employeeId });
    if (!doc.isUniform()) throw new Error('the report mixes portrait and landscape pages: the PDF carries both');
    await printFrame({ html: doc.toHtml(`${dept?.name ?? 'Report'} ${year}-${String(month + 1).padStart(2, '0')}`) });
    return 'html';
  } catch (e0) {
    console.warn('fast HTML print failed, building the PDF instead', e0);
  }
  try {                                                                    // 2) the PDF
    const [{ jsPDF }, pdf] = await Promise.all([import('jspdf'), import('./pdf.js')]);
    const doc = pdf.buildOfficialPdf(model, officialTemplate, { jsPDF, logos: await loadPdfLogos(officialTemplate), employeeId });
    try { doc.viewerPreferences({ PrintScaling: 'None', PickTrayByPDFSize: true, NumCopies: 1 }, true); } catch { /* hints only */ }
    await printFrame({ url: URL.createObjectURL(doc.output('blob')) });
    return 'pdf';
  } catch (e1) {
    console.warn('PDF print failed, printing the Excel version instead', e1);
  }
  const ExcelJS = (await import('exceljs')).default;
  const wb = employeeId ? await buildEmployeeWorkbook(model, officialTemplate, ExcelJS, { loadAsset, employeeId }) : await buildOfficialWorkbook(model, officialTemplate, ExcelJS, { loadAsset });
  const { workbookToPrintHtml } = await import('./print-html.js');
  await printFrame({ html: workbookToPrintHtml(wb) });
  return 'excel';
}

// ---------- the overtime form (one A4 portrait page per day; see overtime-form.js) ----------
// days: ['YYYY-MM-DD', ...] that are looked at; overtime: Map `uid|day` -> { hours, note }; name: file name without the extension
async function overtimeForms({ dept, people, overtime, days }) {
  const form = await import('./overtime-form.js');
  const forms = form.buildForms({ dept, people, overtime, days });
  if (!forms.length) throw Object.assign(new Error('no overtime'), { code: 'NO_OVERTIME' });
  return { form, forms };
}

export async function printOvertimeForm({ dept, people, overtime, days, title = 'Overtime' }) {
  const { form, forms } = await overtimeForms({ dept, people, overtime, days });
  await printFrame({ html: form.formsHtml(forms, { logos: await loadPdfLogos(officialTemplate), title }) });
}

// format: 'xlsx' | 'pdf'. The PDF is made from the same HTML pages (drawn off screen, then put on A4 pages as images): jsPDF cannot write Arabic text itself.
export async function exportOvertimeForm({ dept, people, overtime, days, name, format = 'xlsx' }) {
  const { form, forms } = await overtimeForms({ dept, people, overtime, days });
  if (format === 'pdf') {
    const [{ jsPDF }, html2canvas] = await Promise.all([import('jspdf'), import('html2canvas').then((m) => m.default)]);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:840px;pointer-events:none';
    host.innerHTML = `<style>.otf{--u:4px}${form.formCss('.otf')}</style><div class="otf">${form.formsBody(forms, { logos: await loadPdfLogos(officialTemplate) })}</div>`;
    document.body.append(host);
    try {
      await document.fonts?.ready;
      await Promise.all([...host.querySelectorAll('img')].map((i) => i.decode?.().catch(() => {})));
      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
      const pages = [...host.querySelectorAll('.pg')];
      for (let i = 0; i < pages.length; i++) {
        const canvas = await html2canvas(pages[i], { scale: 2.5, backgroundColor: '#ffffff', logging: false });
        if (i) doc.addPage('a4', 'portrait');
        doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      }
      download(doc.output('blob'), `${name}.pdf`);
    } finally { host.remove(); }
    return;
  }
  const ExcelJS = (await import('exceljs')).default;
  const wb = await form.buildOvertimeWorkbook(forms, ExcelJS, { loadAsset: (u) => loadAsset(u) });
  download(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${name}.xlsx`);
}
