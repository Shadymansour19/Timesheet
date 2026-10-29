// The OVERTIME FORM ("بيان بالمكلفين بالعمل الاضافي بعد انتهاء مواعيد العمل الرسمية"): one A4 LANDSCAPE page per day listing the employees who worked overtime that day, ready
// to print and sign. Built from what is entered in the app (hours + note per employee), as HTML (print / PDF) and as an Excel workbook (one sheet per page).
//  - employees with the SAME note share ONE "work required" cell (merged), but the hours stay per employee;
//  - the page is A4 landscape as in the company's sample (the scan of the sample is a landscape sheet), right-to-left Arabic;
//  - the names are the Arabic ones (profiles.full_name_ar), the English name when a person has none; the "general management" line and the two sign-off titles are
//    built from the Arabic sector and department (departments.sector_ar / name_ar): "الصيانة / التوربينات", "مدير عام الصيانة", "مدير عام مساعد التوربينات";
//    the report settings may give the two titles themselves (departments.report: ot_sign_left, ot_sign_right).
export const TEXT = {
  title: 'بيان بالمكلفين بالعمل الاضافي بعد انتهاء مواعيد العمل الرسمية',
  general: 'الإدارة العامة', maint: 'الصيانة', day: 'اليوم', date: 'الموافق',
  cols: ['م', 'الاسم', 'الرقم الوظيفي', 'الأعمال المطلوبة', 'عدد الساعات'],
  gm: 'مدير عام', agm: 'مدير عام مساعد', page: 'صفحة', of: 'من',
};
const AR_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = (n) => String(n ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// department texts of the form: sector (default "الصيانة") and department (default: its name as entered) in Arabic; the signature titles as given in the
// report settings, else "مدير عام <sector>" (left) and "مدير عام مساعد <department>" (right)
export function formSettings(dept) {
  const r = dept?.report ?? {};
  const sectorAr = (dept?.sector_ar ?? '').trim() || TEXT.maint, deptAr = (dept?.name_ar ?? '').trim() || dept?.name || '';
  return {
    sectorAr, deptAr, general: `${sectorAr} / ${deptAr}`.replace(/ \/ $/, ''),
    signLeft: String(r.ot_sign_left ?? '').trim() || `${TEXT.gm} ${sectorAr}`, signRight: String(r.ot_sign_right ?? '').trim() || `${TEXT.agm} ${deptAr}`.trim(),
  };
}

// the employees with overtime on one day, same notes next to each other (first appearance decides the order of the groups)
function rowsOfDay(people, overtime, day) {
  const groups = new Map(), order = [];
  for (const p of people) {
    const v = overtime.get(`${p.id}|${day}`);
    if (!v || !(v.hours > 0)) continue;
    const note = String(v.note ?? '').trim(), k = note ? norm(note) : `\u0000${p.id}`;        // no note: never grouped
    if (!groups.has(k)) { groups.set(k, []); order.push(k); }
    groups.get(k).push({ name: (p.full_name_ar ?? '').trim() || p.full_name, payroll: p.payroll ?? '', note, hours: v.hours, group: k });
  }
  return order.map((k) => groups.get(k));
}

// groups -> pages. The body of a page is BODY mm tall (what is left between the table head and the sign-offs); a row is ROW_H mm, taller when its name or its
// merged note needs more lines (CHARS_NAME / CHARS_NOTE characters per line of that column, estimated on the safe side). A group is kept together unless it is taller than a page.
const ROW_H = 8.2, LINE_H = 5.6, PAD_H = 3.4, BODY = 79, CHARS_NAME = 28, CHARS_NOTE = 40;
const lines = (s, chars) => Math.max(1, Math.ceil(String(s ?? '').length / chars));
const rowH = (r) => (lines(r.name, CHARS_NAME) > 1 ? Math.max(ROW_H, lines(r.name, CHARS_NAME) * LINE_H + PAD_H) : ROW_H);
const groupH = (rows) => Math.max(rows.reduce((a, r) => a + rowH(r), 0), rows[0]?.note ? lines(rows[0].note, CHARS_NOTE) * LINE_H + PAD_H : 0);
function paginate(groups) {
  const pages = []; let cur = [], used = 0;
  const flush = () => { if (cur.length) pages.push(cur); cur = []; used = 0; };
  for (const g of groups) {
    let rest = g;
    if (groupH(rest) > BODY - used && groupH(rest) <= BODY) flush();
    while (rest.length) {
      let n = rest.length; while (n > 0 && groupH(rest.slice(0, n)) > BODY - used) n--;
      if (!n && used) { flush(); continue; }
      n = Math.max(n, 1);
      const take = rest.slice(0, n); cur.push(take); used += groupH(take); rest = rest.slice(n);
      if (rest.length) flush();
    }
  }
  flush();
  return pages;
}

// -> forms: one per page: { day, weekday, dateText, general, deptAr, signLeft, signRight, part, parts, rows: [{ no, name, payroll, hours, note, span, skip }] }
export function buildForms({ dept, people, overtime, days }) {
  const S = formSettings(dept), forms = [];
  for (const day of days) {
    const pages = paginate(rowsOfDay(people, overtime, day));
    if (!pages.length) continue;
    const d = new Date(`${day}T00:00:00Z`);
    const dateText = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
    let no = 0;
    pages.forEach((groups, pi) => {
      const rows = [];
      for (const g of groups) g.forEach((r, i) => rows.push({ no: ++no, name: r.name, payroll: r.payroll, hours: r.hours, note: i === 0 ? r.note : '', span: i === 0 ? g.length : 0, skip: i > 0 && !!r.note, mergedNote: !!r.note }));
      forms.push({ day, weekday: AR_DAYS[d.getUTCDay()], dateText, general: S.general, deptAr: S.deptAr, sectorAr: S.sectorAr, signLeft: S.signLeft, signRight: S.signRight, part: pi + 1, parts: pages.length, rows, sheetName: `${String(d.getUTCDate()).padStart(2, '0')}-${MON[d.getUTCMonth()]}${pages.length > 1 ? `-${pi + 1}` : ''}` });
    });
  }
  return forms;
}

// ---------- HTML (print and PDF): every length is in units of u = 1 mm of an A4 LANDSCAPE page (297 x 210), so the page scales to whatever the print dialog gives it ----------
const m = (n) => `calc(var(--u) * ${n})`;
export const formCss = (root = '.otf') => `
${root}, ${root} * { box-sizing: border-box; }
${root} { direction: rtl; color: #000; font-family: "Noto Naskh Arabic", "Noto Sans Arabic", "Segoe UI", Tahoma, Arial, sans-serif; line-height: 1.35; }
${root} .pg { position: relative; width: ${m(297)}; height: ${m(209)}; padding: ${m(19.2)} ${m(33.6)} ${m(24)}; background: #fff; overflow: hidden; page-break-after: always; break-after: page; }
${root} .pg:last-child { page-break-after: auto; break-after: auto; }
${root} .logos { display: flex; justify-content: space-between; align-items: center; height: ${m(22)}; }
${root} .logos img { height: ${m(20)}; width: auto; max-width: ${m(60)}; object-fit: contain; }
${root} .ttl { text-align: center; font-weight: 700; font-size: ${m(5.3)}; margin: ${m(3)} 0 ${m(5)}; }
${root} .ttl span { display: inline-block; line-height: 1.4; padding-bottom: ${m(0.7)}; border-bottom: ${m(0.5)} solid #000; }   /* a border, not text-decoration: it sits below the descenders in print and in the PDF (html2canvas) alike */
${root} .meta { font-size: ${m(4.2)}; font-weight: 700; margin: ${m(1.5)} 0; display: flex; gap: ${m(14)}; }
${root} table { width: 100%; border-collapse: collapse; margin-top: ${m(4)}; font-size: ${m(4)}; table-layout: fixed; }
${root} th, ${root} td { border: ${m(0.3)} solid #000; padding: ${m(1.6)} ${m(1.5)}; text-align: center; vertical-align: middle; word-wrap: break-word; overflow-wrap: anywhere; height: ${m(8.2)}; }
${root} th { font-weight: 700; }
${root} td.work { white-space: pre-wrap; }
${root} .sign { position: absolute; left: ${m(33.6)}; right: ${m(33.6)}; bottom: ${m(24)}; display: flex; justify-content: space-between; font-weight: 700; font-size: ${m(4.2)}; }
${root} .sign div { width: ${m(70)}; border-top: ${m(0.4)} solid #000; padding-top: ${m(2)}; text-align: center; }
${root} .cont { position: absolute; bottom: ${m(10)}; left: 0; right: 0; text-align: center; font-size: ${m(3)}; color: #444; }
`;

export function formsBody(forms, { logos = {} } = {}) {
  const img = (l) => (l?.data ? `<img src="${esc(l.data)}" alt="">` : '<span></span>');
  return forms.map((f) => `<div class="pg">
<div class="logos">${img(logos.right)}${img(logos.left)}</div>
<div class="ttl"><span>${esc(TEXT.title)}</span></div>
<div class="meta"><span>${esc(TEXT.general)}: ${esc(f.general)}</span></div>
<div class="meta"><span>${esc(TEXT.day)}: ${esc(f.weekday)}</span><span>${esc(TEXT.date)}: <bdi>${esc(f.dateText)}</bdi></span></div>
<table><colgroup><col style="width:${m(10)}"><col style="width:${m(66)}"><col style="width:${m(34)}"><col><col style="width:${m(26)}"></colgroup>
<thead><tr>${TEXT.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
${f.rows.map((r) => `<tr><td>${r.no}</td><td>${esc(r.name)}</td><td><bdi>${esc(r.payroll)}</bdi></td>${r.skip ? '' : `<td class="work"${r.span > 1 ? ` rowspan="${r.span}"` : ''}>${esc(r.note)}</td>`}<td>${r.hours}</td></tr>`).join('\n')}
</tbody></table>
<div class="sign"><div>${esc(f.signRight)}</div><div>${esc(f.signLeft)}</div></div>
${f.parts > 1 ? `<div class="cont">${esc(TEXT.page)} ${f.part} ${esc(TEXT.of)} ${f.parts}</div>` : ''}
</div>`).join('\n');
}

// the whole printable document (a hidden frame prints it): A4 landscape, no margins, pages scale to the printable area
export function formsHtml(forms, { logos, title = 'Overtime' } = {}) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { size: A4 landscape; margin: 0 }
html, body { margin: 0; padding: 0; background: #fff }
.otf { --u: min(calc(100vw / 297), calc(100vh / 210)); }
${formCss('.otf')}
</style></head><body><div class="otf">${formsBody(forms, { logos })}</div></body></html>`;
}

// ---------- Excel: one sheet per page, A4 landscape, one page per sheet ----------
// The columns are laid out in their VISUAL order (hours | work | payroll | name | no.) in an ordinary left-to-right sheet, with right-to-left text: the page looks like
// the form in every viewer, also in those that ignore a right-to-left sheet view.
export async function buildOvertimeWorkbook(forms, ExcelJS, { loadAsset } = {}) {
  const wb = new ExcelJS.Workbook();
  const logos = {};
  for (const side of ['left', 'right']) {
    try {
      const buf = await loadAsset?.(`/templates/logo-${side}.png`);
      if (buf) { const dv = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer); logos[side] = { id: wb.addImage({ buffer: buf, extension: 'png' }), w: dv.getUint32(16), h: dv.getUint32(20) }; }
    } catch { /* no logo */ }
  }
  const thin = { style: 'thin', color: { argb: 'FF000000' } }, box = { top: thin, left: thin, bottom: thin, right: thin };
  const font = (o = {}) => ({ name: 'Arial', size: 12, ...o });
  const used = new Set();
  for (const f of forms) {
    let name = f.sheetName, k = 2; while (used.has(name)) name = `${f.sheetName}-${k++}`; used.add(name);
    const ws = wb.addWorksheet(name, { views: [{ showGridLines: false }], pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true, margins: { left: 0.96, right: 0.96, top: 1.2, bottom: 1.2, header: 0.3, footer: 0.3 } } });
    const WIDTHS = [14, 33, 33, 18, 36, 6], px = (w) => w * 7 + 5, total = WIDTHS.reduce((a, w) => a + px(w), 0);
    WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });              // A hours | B-C work required (merged) | D payroll | E name | F no.  (the form read from the right: no. first)
    const merged = (r, text, o = {}) => { ws.mergeCells(r, 1, r, 6); const c = ws.getCell(r, 1); c.value = text; c.font = font(o.font); c.alignment = { horizontal: o.align ?? 'center', vertical: 'middle', readingOrder: 'rtl' }; return c; };
    ws.getRow(1).height = 60;
    // logos as in the form: EMC at the left corner, Burullus at the right corner
    const at = (x) => { let acc = 0; for (let i = 0; i < WIDTHS.length; i++) { if (x < acc + px(WIDTHS[i]) || i === WIDTHS.length - 1) return { nativeCol: i, nativeColOff: Math.round((x - acc) * 9525), nativeRow: 0, nativeRowOff: 19050 }; acc += px(WIDTHS[i]); } };   // pixels from the left edge -> column + exact offset (EMU: ExcelJS scales a fractional "col" by its own column width, which put the logo in the wrong place)
    const place = (lg, fromEnd) => { if (!lg) return; const h = 76, w = Math.round(h * lg.w / lg.h); ws.addImage(lg.id, { tl: at(fromEnd ? total - w - 4 : 4), ext: { width: w, height: h } }); };
    place(logos.left, false); place(logos.right, true);
    ws.getRow(2).height = 30; merged(2, TEXT.title, { font: font({ bold: true, size: 15, underline: true }) });
    ws.getRow(3).height = 8;
    ws.getRow(4).height = 22; merged(4, `${TEXT.general}: ${f.general}`, { align: 'right', font: font({ bold: true, size: 13 }) });
    ws.getRow(5).height = 22; merged(5, `${TEXT.day}: ${f.weekday}        ${TEXT.date}: ${f.dateText}`, { align: 'right', font: font({ bold: true, size: 13 }) });
    ws.getRow(6).height = 8;
    const cellAt = (r, c, v, o = {}) => { const cell = ws.getCell(r, c); if (v !== undefined) cell.value = v; cell.font = font(o.font); cell.border = box; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: o.ltr ? 'ltr' : 'rtl' }; return cell; };
    const COL = { hours: 1, work: 2, payroll: 4, name: 5, no: 6 };      // TEXT.cols = no. | name | payroll | work | hours
    [[COL.no, 0], [COL.name, 1], [COL.payroll, 2], [COL.work, 3], [COL.hours, 4]].forEach(([c, i]) => cellAt(7, c, TEXT.cols[i], { font: { bold: true } }));
    cellAt(7, 3); ws.mergeCells(7, 2, 7, 3);
    ws.getRow(7).height = 24;
    let r = 8;
    for (const row of f.rows) {
      const noteLines = row.span ? Math.max(1, Math.ceil(String(row.note).length * 1.15 / 62)) : 1, nameLines = Math.max(1, Math.ceil(String(row.name).length / 32));   // a merged note / a long name needs enough height
      ws.getRow(r).height = Math.max(24, nameLines > 1 ? nameLines * 17 + 6 : 24, row.span ? Math.ceil((noteLines * 17 + 6) / row.span) : 24);
      cellAt(r, COL.no, row.no); cellAt(r, COL.name, row.name); cellAt(r, COL.payroll, row.payroll, { ltr: true }); cellAt(r, COL.hours, row.hours);
      cellAt(r, COL.work, row.skip ? undefined : row.note); cellAt(r, 3);
      if (!row.skip) ws.mergeCells(r, 2, r + Math.max(row.span, 1) - 1, 3);       // one cell over the rows of a group, else over the two columns of the row
      r++;
    }
    ws.getRow(r + 1).height = 56;                                      // room above the line to sign
    r += 2;
    ws.getRow(r).height = 30;
    const sign = (c, text) => { const cell = ws.getCell(r, c); cell.value = text; cell.font = font({ bold: true }); cell.alignment = { horizontal: 'center', vertical: 'top', wrapText: true, readingOrder: 'rtl' }; cell.border = { top: thin }; };
    sign(2, f.signLeft); sign(5, f.signRight);                          // left title under the work column, right title under the name column: a short line each
    ws.pageSetup.printArea = `A1:F${r}`;
  }
  return wb;
}
