import { buildModel } from './model.js';
import defaultTemplate from './templates/default.js';
import officialTemplate from './templates/official.js';
import { buildOfficialWorkbook } from './official.js';

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

// Browser: fetch data model -> workbook -> file download. exceljs (~1 MB) is loaded only when exporting.
export async function exportMonth({ dept, people, data, year, month, lang, template = activeTemplate }) {
  const ExcelJS = (await import('exceljs')).default;
  const model = buildModel({ dept, people, data, year, month });
  const wb = await buildWorkbook(model, template, lang, ExcelJS, {
    loadSource: async (url) => (await fetch(url)).arrayBuffer(),
    // optional images (logos): the host serves index.html for unknown paths, so only accept real images
    loadAsset: async (url) => { const r = await fetch(url); return r.ok && (r.headers.get('content-type') || '').startsWith('image/') ? r.arrayBuffer() : null; },
  });
  const buf = await wb.xlsx.writeBuffer();
  const safe = (dept?.name ?? 'department').replace(/[^\p{L}\p{N}_-]+/gu, '_');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `timesheet_${safe}_${model.year}-${String(model.month + 1).padStart(2, '0')}.xlsx`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
