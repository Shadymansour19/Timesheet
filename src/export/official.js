// Official monthly report: one sheet per DAY (named 1, 2, 3 ...), then one sheet per EMPLOYEE ("Name OPR"), then a Review sheet.
// Day sheets hold the recorded data. Employee sheets READ it with formulas (INDEX/MATCH on the P/R = OPR code), and the
// Review sheet reads the employee sheets, so editing a day sheet in Excel flows through. Every formula also carries its
// computed result, so viewers that do not recalculate (phone previews) still show the right numbers.

const FONT = 'Times New Roman';
const thin = { style: 'thin', color: { argb: 'FF000000' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const NAVY = 'FF3C3C8C';
const GREY = 'FFD9D9D9';
const GREEN = 'FFE2EFDA';

let CACHE = true;
const fx = (formula, result) => (CACHE ? { formula, result } : { formula });   // result = cached value shown by viewers that do not recalculate

const NORMAL = ['X', 'C', 'Q'];   // normal-rate work codes
const SHIFT = ['Y', 'O'];         // 1.2X-rate work codes

export const colLetter = (n) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const addr = (c, r, abs = true) => (abs ? `$${colLetter(c)}$${r}` : `${colLetter(c)}${r}`);
const quote = (name) => `'${name.replace(/'/g, "''")}'`;

// Excel sheet names: max 31 chars, none of \ / ? * [ ] :, unique (case-insensitive)
export function uniqueSheetName(base, used) {
  let name = String(base).replace(/[\\/?*[\]:']/g, ' ').replace(/\s+/g, ' ').trim() || 'Sheet';   // apostrophes dropped too: they complicate formula quoting
  name = name.slice(0, 31).trim();
  let out = name, i = 2;
  while (used.has(out.toLowerCase())) { const suffix = ` ${i++}`; out = name.slice(0, 31 - suffix.length).trim() + suffix; }
  used.add(out.toLowerCase());
  return out;
}
// "<name> <OPR>", shortening the NAME (never the OPR) so the sheet name fits and stays recognisable
export function employeeSheetName(fullName, opr, used) {
  const tail = opr ? ` ${opr}` : '';
  const room = Math.max(1, 31 - tail.length);
  const clean = String(fullName).replace(/[\\/?*[\]:']/g, ' ').replace(/\s+/g, ' ').trim();
  return uniqueSheetName(`${clean.slice(0, room).trim()}${tail}`, used);
}

function settings(model, tpl) {
  const d = tpl.defaults, r = model.report ?? {};
  const pick = (k, fallback) => (typeof r[k] === 'string' && r[k].trim() ? r[k].trim() : fallback);
  const deptTitle = pick('dept_title', `${model.department} Dept.`);
  const short = deptTitle.replace(/\s*Dept\.?$/i, '').trim() || model.department;
  return {
    deptTitle, deptCode: pick('dept_code', ''), printName: pick('dept_print_name', model.department.toUpperCase()), location: pick('location', ''),
    manpower: pick('manpower', d.manpower), banner: [pick('banner_1', d.banner[0]), pick('banner_2', d.banner[1]), pick('banner_3', d.banner[2])],
    companyLeft: pick('company_left', d.companyLeft), companyRight: pick('company_right', d.companyRight),
    signLeft: pick('signoff_left', `${short} SH/DH`), signRight: pick('signoff_right', `${short} AGM`),
  };
}

// ---------- small drawing helpers ----------
function setCell(ws, r, c, value, o = {}) {
  const cell = ws.getCell(r, c);
  cell.value = value;
  cell.font = { name: FONT, size: o.size ?? 9, bold: o.bold ?? false, italic: o.italic ?? false, color: o.color ? { argb: o.color } : undefined, underline: o.underline };
  cell.alignment = { horizontal: o.h ?? 'center', vertical: o.v ?? 'middle', wrapText: o.wrap ?? false, textRotation: o.rot, shrinkToFit: o.shrink ?? false };
  if (o.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
  if (o.numFmt) cell.numFmt = o.numFmt;
  if (o.border !== false) cell.border = BORDER;
  return cell;
}
function merge(ws, r1, c1, r2, c2, value, o = {}) {
  if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1, c1, r2, c2);
  setCell(ws, r1, c1, value, o);
  if (o.border !== false) for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = BORDER;   // merged cells need every edge cell
}
function banner(ws, rows, c1, cL, cR, cEnd, S, logos) {
  // rows: first row of a 3-row banner. Left block: company caption (+ logo), centre: three styled lines, right block likewise.
  for (let r = rows; r < rows + 3; r++) ws.getRow(r).height = 24;
  merge(ws, rows, c1, rows + 2, cL, S.companyLeft, { size: 8, v: 'bottom', wrap: true });
  merge(ws, rows, cEnd - cR + 1, rows + 2, cEnd, S.companyRight, { size: 8, v: 'bottom', wrap: true });
  const centreFrom = c1 + cL, centreTo = cEnd - cR;
  merge(ws, rows, centreFrom, rows + 2, centreTo, {
    richText: [
      { text: `${S.banner[0]}\n`, font: { name: FONT, size: 13, bold: true, color: { argb: NAVY } } },
      { text: `${S.banner[1]}\n`, font: { name: FONT, size: 13, bold: true, color: { argb: NAVY } } },
      { text: S.banner[2], font: { name: FONT, size: 15, bold: true, color: { argb: NAVY } } },
    ],
  }, { wrap: true });
  if (logos?.left) logos.place(ws, logos.left, { col: c1 - 1 + 0.15, row: rows - 1 + 0.1 }, 90, 52);
  if (logos?.right) logos.place(ws, logos.right, { col: cEnd - cR + 0.4, row: rows - 1 + 0.1 }, 70, 52);
}
function page(ws, { landscape = false, height = 0, area } = {}) {
  ws.pageSetup = { paperSize: 9, orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: height, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
  if (area) ws.pageSetup.printArea = area;
  ws.views = [{ showGridLines: false }];
}

// ---------- day sheet ----------
const D = { first: 9, no: 1, name: 2, title: 3, level: 4, pr: 5, status: 6, acc: 7, tin: 8, tex: 9, ot: 10, cmt: 11, cols: 11 };
function daySheet(wb, model, S, di, name, logos) {
  const ws = wb.addWorksheet(name);
  page(ws, { height: 0 });
  [5, 36, 16, 10, 11, 9, 10, 11, 11, 10, 30].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  banner(ws, 1, 1, 2, 2, D.cols, S, logos);
  const day = model.days[di];
  merge(ws, 4, 1, 4, D.cols, `${S.deptTitle} Daily Attendance Sheet`, { bold: true, size: 10, border: false });
  merge(ws, 5, 1, 5, D.cols, S.manpower, { bold: true, size: 10, border: false });
  merge(ws, 6, 1, 6, D.cols, new Date(Date.UTC(model.year, model.month, day.day)), { bold: true, size: 10, border: false, numFmt: day.holiday ? 'dd-mmm-yy "(Holiday)"' : 'dd-mmm-yy' });
  ws.getRow(7).height = 6;
  ['No.', 'Name', 'Title', 'Level', 'P/R', 'Status', 'Accom.', 'TRANS/IN', 'TRANS/EX', 'Over Time', 'Comments'].forEach((h, i) => setCell(ws, 8, i + 1, h, { bold: true, size: 9, fill: GREY, wrap: true }));
  ws.getRow(8).height = 24;
  model.employees.forEach((e, i) => {
    const r = D.first + i, c = e.cells[di];
    const code = c.status;                                    // X / Y / E (holidays are shown in the date line)
    setCell(ws, r, D.no, i + 1, { bold: true });
    setCell(ws, r, D.name, e.fullName, { bold: true, h: 'left', shrink: true });
    setCell(ws, r, D.title, e.jobTitle, { bold: true, shrink: true });
    setCell(ws, r, D.level, e.levelText, { bold: true });
    setCell(ws, r, D.pr, e.opr, { bold: true });
    setCell(ws, r, D.status, code, { bold: true, size: 10 });
    setCell(ws, r, D.acc, null); setCell(ws, r, D.tin, null); setCell(ws, r, D.tex, null);
    setCell(ws, r, D.ot, c.ot || null, { bold: true });
    setCell(ws, r, D.cmt, c.note || null, { h: 'left', wrap: true });
    ws.getRow(r).height = 17;
  });
  const end = D.first + model.employees.length - 1;
  const sig = end + 3;
  merge(ws, sig, 1, sig, 4, S.signLeft, { bold: true, size: 9, border: false, h: 'left' });
  merge(ws, sig, 8, sig, D.cols, S.signRight, { bold: true, size: 9, border: false, h: 'right' });
  return { last: end };
}

// ---------- employee sheet ----------
// Columns: left table 1..10, spacer 11, right table 12..21. Each table: Day, Work, B, L, D, Accomd, Trans/IN, Trans/EX, O.V.T, Comment
const E = { hdr1: 11, hdr2: 12, first: 13, leftDays: 16, left: 1, right: 12 };
const eCol = (base, k) => base + k;   // k: 0 day,1 work,2 B,3 L,4 D,5 acc,6 tin,7 tex,8 ovt,9 cmt
function employeeSheet(wb, model, S, e, name, dayNames, dayLast, logos) {
  const ws = wb.addWorksheet(name);
  page(ws, { landscape: true, height: 1 });
  [5, 7, 3, 3, 3, 4, 4, 4, 7, 22, 2, 5, 7, 3, 3, 3, 4, 4, 4, 7, 22].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  // top banner: captions under the (optional) logos, centred title
  for (let r = 1; r <= 3; r++) ws.getRow(r).height = 17;
  merge(ws, 1, 1, 3, 4, S.companyLeft, { size: 8, v: 'bottom', wrap: true, border: false });
  merge(ws, 1, 18, 3, 21, S.companyRight, { size: 8, v: 'bottom', wrap: true, border: false });
  if (logos?.left) logos.place(ws, logos.left, { col: 0.1, row: 0.05 }, 80, 36);
  if (logos?.right) logos.place(ws, logos.right, { col: 18.3, row: 0.05 }, 70, 36);
  merge(ws, 5, 4, 5, 10, 'MONTHLY TIME REPORT', { bold: true, size: 11 });
  const monthDate = new Date(Date.UTC(model.year, model.month, 1));
  // info blocks
  const info = (r, label, value, c1, c2, v1, v2, o = {}) => { merge(ws, r, c1, r, c2, label, { size: 8, h: 'left', bold: true }); merge(ws, r, v1, r, v2, value, { size: 9, ...o }); };
  info(5, 'Department code:', S.deptCode, 12, 15, 16, 21, { bold: true });
  info(6, 'Name:', e.fullName, 1, 2, 3, 10, { bold: true });         info(6, 'Month:', monthDate, 12, 15, 16, 21, { bold: true, numFmt: 'mmm-yy' });
  info(7, 'Title:', e.jobTitle, 1, 2, 3, 10, { bold: true });        info(7, 'Contr. No.:', e.contractNo, 12, 15, 16, 21, { bold: true });
  info(8, 'Level:', e.levelText, 1, 2, 3, 10, { bold: true });       info(8, 'Department:', S.printName, 12, 15, 16, 21, { bold: true });
  info(9, 'Location:', S.location, 1, 2, 3, 10, { bold: true });     info(9, 'PAYROLL', e.opr, 12, 15, 16, 21, { bold: true });
  const prCell = addr(16, 9);                                         // P/R (OPR) used by the lookups below

  // table headers
  for (const base of [E.left, E.right]) {
    merge(ws, E.hdr1, eCol(base, 0), E.hdr2, eCol(base, 0), 'Day', { bold: true, size: 8 });
    merge(ws, E.hdr1, eCol(base, 1), E.hdr2, eCol(base, 1), 'Work', { bold: true, size: 8 });
    merge(ws, E.hdr1, eCol(base, 2), E.hdr1, eCol(base, 4), 'Meal', { bold: true, size: 8 });
    ['B', 'L', 'D'].forEach((m, i) => setCell(ws, E.hdr2, eCol(base, 2 + i), m, { bold: true, size: 8 }));
    [['Accomd.', 5], ['Trans/IN', 6], ['Trans/EX', 7]].forEach(([t, k]) => merge(ws, E.hdr1, eCol(base, k), E.hdr2, eCol(base, k), t, { bold: true, size: 7, rot: 90 }));
    merge(ws, E.hdr1, eCol(base, 8), E.hdr2, eCol(base, 8), 'O.V.T Hrs', { bold: true, size: 8, wrap: true });
    merge(ws, E.hdr1, eCol(base, 9), E.hdr2, eCol(base, 9), 'Comment', { bold: true, size: 8 });
  }
  ws.getRow(E.hdr1).height = 18; ws.getRow(E.hdr2).height = 24;

  // day rows (formulas read the day sheets)
  const idx = (colLtr, ds) => `INDEX(${quote(ds)}!$${colLtr}$${D.first}:$${colLtr}$${dayLast},MATCH(${prCell},${quote(ds)}!$E$${D.first}:$E$${dayLast},0))`;
  const nDays = model.days.length;
  const cells = [];   // { work, ot } per day for cached totals
  for (let d = 1; d <= 31; d++) {
    const left = d <= E.leftDays, base = left ? E.left : E.right, r = E.first + (left ? d - 1 : d - E.leftDays - 1);
    setCell(ws, r, eCol(base, 0), d, { bold: true });
    for (let k = 1; k <= 9; k++) setCell(ws, r, eCol(base, k), null, { h: k === 9 ? 'left' : 'center' });
    if (d > nDays) continue;
    const ds = dayNames[d - 1], c = e.cells[d - 1], work = c.status, ot = c.ot || 0;
    cells.push({ work, ot });
    const put = (k, formula, result, o = {}) => setCell(ws, r, eCol(base, k), fx(formula, result), { size: 9, ...o });
    put(1, `IFERROR(${idx('F', ds)},"E")`, work, { bold: true });
    put(5, `IFERROR(${idx('G', ds)},0)`, 0); put(6, `IFERROR(${idx('H', ds)},0)`, 0); put(7, `IFERROR(${idx('I', ds)},0)`, 0);
    put(8, `IFERROR(${idx('J', ds)},0)`, ot, { bold: true });
    put(9, `IFERROR(${idx('K', ds)}&"","")`, c.note || '', { h: 'left', size: 8 });
    ws.getRow(r).height = 15;
  }
  const lastRow = E.first + E.leftDays - 1;   // 28
  const rng = (c, ) => `${addr(c, E.first)}:${addr(c, lastRow)}`;
  const workL = rng(eCol(E.left, 1)), workR = rng(eCol(E.right, 1)), otL = rng(eCol(E.left, 8)), otR = rng(eCol(E.right, 8));

  // legend
  const L0 = lastRow + 2;
  const leg = [
    [['Work Codes', 'X', 'Work Onshore'], ['', 'Y', 'Day/Night Shift(1.2X)'], ['', 'O', 'Work Offshore']],
    [['', 'C', 'Work at Cairo'], ['', 'Q', 'Work At Abo Qir'], ['', 'E', 'Vacation']],
    [['Meal Codes', 'B', 'Breakfast'], ['', 'L', 'Lunch'], ['', 'D', 'Dinner']],
  ];
  const blocks = [[1, 2, 3, 4, 7], [8, null, 8, 9, 14], [15, null, 15, 16, 21]];   // [catFrom, catTo?, codeCol, descFrom, descTo]
  leg.forEach((row, i) => row.forEach((cell, b) => {
    const r = L0 + i, [catFrom, , codeCol, dFrom, dTo] = blocks[b];
    if (b === 0) merge(ws, r, 1, r, 2, cell[0], { bold: true, size: 8, h: 'left' });
    setCell(ws, r, codeCol === 3 ? 3 : codeCol, cell[1], { bold: true, size: 8 });
    merge(ws, r, dFrom, r, dTo, cell[2], { size: 8, h: 'left' });
  }));

  // totals
  const T0 = L0 + 4;
  const count = (code) => `COUNTIF(${workL},"${code}")+COUNTIF(${workR},"${code}")`;
  const sum = (codes) => codes.map((c) => `SUMIF(${workL},"${c}",${otL})+SUMIF(${workR},"${c}",${otR})`).join('+');
  const cnt = (code) => cells.filter((x) => x.work === code).length;
  const otOf = (codes) => cells.filter((x) => codes.includes(x.work)).reduce((a, x) => a + x.ot, 0);
  merge(ws, T0, 1, T0, 10, 'Codes of Normal Daily Rates', { bold: true, size: 9 });
  merge(ws, T0, 12, T0, 21, 'Codes of 1.2X Daily Rates', { bold: true, size: 9 });
  const tot = (r, label, c1, c2, v1, v2, formula, result) => { merge(ws, r, c1, r, c2, label, { size: 9, h: 'left' }); merge(ws, r, v1, r, v2, fx(formula, result), { bold: true, size: 9 }); };
  const refs = {};
  tot(T0 + 1, 'Total (X) Days', 1, 7, 8, 10, count('X'), cnt('X')); refs.X = addr(8, T0 + 1);
  tot(T0 + 2, 'Total (C) Days', 1, 7, 8, 10, count('C'), cnt('C')); refs.C = addr(8, T0 + 2);
  tot(T0 + 3, 'Total (Q) Days', 1, 7, 8, 10, count('Q'), cnt('Q')); refs.Q = addr(8, T0 + 3);
  tot(T0 + 4, 'Total Overtime Hours', 1, 7, 8, 10, sum(NORMAL), otOf(NORMAL)); refs.otNormal = addr(8, T0 + 4);
  tot(T0 + 1, 'Total (Y) Days', 12, 18, 19, 21, count('Y'), cnt('Y')); refs.Y = addr(19, T0 + 1);
  tot(T0 + 2, 'Total (O) Days', 12, 18, 19, 21, count('O'), cnt('O')); refs.O = addr(19, T0 + 2);
  tot(T0 + 3, 'Total Overtime Hours', 12, 18, 19, 21, sum(SHIFT), otOf(SHIFT)); refs.otShift = addr(19, T0 + 3);
  // meals / accommodation / transportation (not recorded in the app yet: they add up whatever is typed on the day sheets)
  const sumCol = (k) => `SUM(${rng(eCol(E.left, k))})+SUM(${rng(eCol(E.right, k))})`;
  const M0 = T0 + 5;
  merge(ws, M0, 12, M0, 16, 'Total Meals', { bold: true, size: 8 }); merge(ws, M0, 17, M0 + 1, 18, 'Accomd', { bold: true, size: 8 }); merge(ws, M0, 19, M0, 21, 'Transportation', { bold: true, size: 8 });
  ['B', 'L', 'D'].forEach((m, i) => { merge(ws, M0 + 1, 12 + i * 2 - (i ? 0 : 0), M0 + 1, 12 + i * 2 + (i === 2 ? 0 : 1) - (i === 2 ? 0 : 0), m, { bold: true, size: 8 }); });
  setCell(ws, M0 + 1, 19, 'EX', { bold: true, size: 8 }); merge(ws, M0 + 1, 20, M0 + 1, 21, 'IN', { bold: true, size: 8 });
  const sumFormula = (k) => fx(sumCol(k), 0);
  refs.ex = addr(19, M0 + 2); refs.in = addr(20, M0 + 2);
  [[12, 13], [14, 15], [16, 16]].forEach(([a, b], i) => merge(ws, M0 + 2, a, M0 + 2, b, sumFormula(2 + i), { bold: true, size: 8 }));
  merge(ws, M0 + 2, 17, M0 + 2, 18, sumFormula(5), { bold: true, size: 8 });
  setCell(ws, M0 + 2, 19, sumFormula(7), { bold: true, size: 8 }); merge(ws, M0 + 2, 20, M0 + 2, 21, sumFormula(6), { bold: true, size: 8 });
  refs.in = addr(20, M0 + 2);

  // notes + signatures
  const N0 = M0 + 4;
  merge(ws, N0, 1, N0 + 2, 21, 'Notes (Penalty):-', { bold: true, size: 9, h: 'left', v: 'top' });
  const G0 = N0 + 4;
  [['Signature Employee', 1, 7], ['Approval of Supervisor', 9, 15], ['Approval of Department GM', 16, 21]].forEach(([label, c1, c2], i) => {
    merge(ws, G0 + (i === 2 ? 2 : 0), c1, G0 + (i === 2 ? 2 : 0), c2, label, { bold: true, size: 9, h: 'left', border: false });
    merge(ws, G0 + (i === 2 ? 3 : 1), c1, G0 + (i === 2 ? 3 : 1), c2, '------------------------------------', { size: 9, h: 'left', border: false });
  });
  return { sheet: ws.name, refs, totals: { X: cnt('X'), C: cnt('C'), Q: cnt('Q'), Y: cnt('Y'), O: cnt('O'), otNormal: otOf(NORMAL), otShift: otOf(SHIFT) } };
}

// ---------- review sheet ----------
const V = { first: 9, no: 1, name: 2, title: 3, level: 4, pr: 5, x: 6, y: 7, total: 8, ot: 9, ext: 10, in: 11, sig: 12, cols: 12 };
function reviewSheet(wb, model, S, emps, name, logos) {
  const ws = wb.addWorksheet(name);
  page(ws, { landscape: true, height: 0 });
  [5, 36, 16, 10, 11, 10, 10, 11, 9, 9, 9, 28].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  banner(ws, 1, 1, 2, 2, V.cols, S, logos);
  merge(ws, 4, 1, 4, V.cols, `${S.deptTitle} Monthly Attendance Sheet Review`, { bold: true, size: 10, border: false });
  merge(ws, 5, 1, 5, V.cols, S.manpower, { bold: true, size: 10, border: false });
  merge(ws, 6, 1, 6, V.cols, 'Closeout Calculation Sheet', { bold: true, size: 10, border: false });
  ws.getRow(7).height = 6;
  ['No.', 'Name', 'Title', 'Level', 'P/R', '(X)DAYS', '(Y) DAYS', 'Total Days', 'O/T', 'EXT', 'IN', 'Signature'].forEach((h, i) => setCell(ws, 8, i + 1, h, { bold: true, size: 9, fill: i === 7 ? GREY : undefined }));
  const n = model.employees.length, last = V.first + n - 1;
  model.employees.forEach((e, i) => {
    const r = V.first + i, x = emps[i], q = quote(x.sheet);
    const nx = x.totals.X + x.totals.C + x.totals.Q, ny = x.totals.Y + x.totals.O, ot = x.totals.otNormal + x.totals.otShift;
    setCell(ws, r, V.no, i + 1, { bold: true });
    setCell(ws, r, V.name, e.fullName, { bold: true, h: 'left', shrink: true });
    setCell(ws, r, V.title, e.jobTitle, { bold: true, shrink: true }); setCell(ws, r, V.level, e.levelText, { bold: true }); setCell(ws, r, V.pr, e.opr, { bold: true });
    setCell(ws, r, V.x, fx(`${q}!${x.refs.X}+${q}!${x.refs.C}+${q}!${x.refs.Q}`, nx), { bold: true });
    setCell(ws, r, V.y, fx(`${q}!${x.refs.Y}+${q}!${x.refs.O}`, ny), { bold: true });
    setCell(ws, r, V.total, fx(`${addr(V.x, r, false)}+${addr(V.y, r, false)}`, nx + ny), { bold: true, fill: GREY });
    setCell(ws, r, V.ot, fx(`${q}!${x.refs.otNormal}+${q}!${x.refs.otShift}`, ot), { bold: true });
    setCell(ws, r, V.ext, fx(`${q}!${x.refs.ex}`, 0), { bold: true });
    setCell(ws, r, V.in, fx(`${q}!${x.refs.in}`, 0), { bold: true });
    setCell(ws, r, V.sig, null);
    ws.getRow(r).height = 17;
  });
  // totals by job title
  const T = last + 2;
  const titleRng = `$C$${V.first}:$C$${last}`, totalRng = `$H$${V.first}:$H$${last}`;
  const sumBy = (re) => model.employees.reduce((a, e, i) => (re.test(e.jobTitle) ? a + emps[i].totals.X + emps[i].totals.C + emps[i].totals.Q + emps[i].totals.Y + emps[i].totals.O : a), 0);
  [['Total Engineer days', '*Engineer*', /engineer/i, 'Total approved (Engineers )'], ['Total Technition days', '*Technician*', /technician/i, 'Total approved (Tech )']].forEach(([label, pattern, re, approved], i) => {
    const r = T + i * 2;
    merge(ws, r, 2, r, 3, label, { bold: true, size: 9 });
    setCell(ws, r, 4, fx(`SUMIF(${titleRng},"${pattern}",${totalRng})`, sumBy(re)), { bold: true, fill: GREEN });
    merge(ws, r, 5, r, 9, approved, { bold: true, size: 9 });
    setCell(ws, r, 10, null); setCell(ws, r, 11, null); setCell(ws, r, 12, null);
  });
  const sig = T + 5;
  merge(ws, sig, 1, sig, 4, S.signLeft, { bold: true, size: 9, border: false, h: 'left' });
  merge(ws, sig, 9, sig, V.cols, S.signRight, { bold: true, size: 9, border: false, h: 'right' });
}

// ---------- entry point ----------
export async function buildOfficialWorkbook(model, tpl, ExcelJS, { loadAsset, cacheResults = true } = {}) {
  CACHE = cacheResults;
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;          // Excel / LibreOffice recompute every formula when the file is opened
  const S = settings(model, tpl);
  // optional logos (public/templates/logo-left.png, logo-right.png)
  const logos = { left: null, right: null, place: (ws, id, tl, w, h) => ws.addImage(id, { tl, ext: { width: w, height: h } }) };
  if (loadAsset) for (const side of ['left', 'right']) {
    try { const buf = await loadAsset(`${tpl.logoBase}-${side}.png`); if (buf) logos[side] = wb.addImage({ buffer: buf, extension: 'png' }); } catch { /* no logo: captions only */ }
  }
  const used = new Set();
  const dayNames = model.days.map((d) => uniqueSheetName(String(d.day), used));
  let dayLast = D.first;
  model.days.forEach((_, i) => { dayLast = daySheet(wb, model, S, i, dayNames[i], logos).last; });
  dayLast = Math.max(dayLast, D.first);
  const emps = model.employees.map((e) => employeeSheet(wb, model, S, e, employeeSheetName(e.fullName, e.opr, used), dayNames, dayLast, logos));
  reviewSheet(wb, model, S, emps, uniqueSheetName('Review', used), logos);
  return wb;
}
