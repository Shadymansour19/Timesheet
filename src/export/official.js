// Official monthly report: one sheet per DAY (named 1, 2, 3 ...), then one sheet per EMPLOYEE ("Name Payroll"), then a Review
// sheet and an Overtime summary. Day sheets hold the recorded data (incl. Arrival / Departure and TRANS/IN-EX). Employee
// sheets READ them with formulas (INDEX/MATCH on the P/R = payroll number), the Review and Overtime sheets read the employee
// sheets, so editing a day sheet in Excel flows through. Every formula also carries its computed result, so viewers that do
// not recalculate (phone previews) still show the right numbers.

const TIMES = 'Times New Roman';
const CAL = 'Calibri';
const thin = { style: 'thin', color: { argb: 'FF000000' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const BLUE = 'FF3B4FA0';
const GREY = 'FFD9D9D9';
const GREEN = 'FFE2EFDA';

let CACHE = true;
const fx = (formula, result) => (CACHE ? { formula, result } : { formula });   // result = cached value for viewers that do not recalculate

const NORMAL = ['X', 'C', 'Q'];   // normal-rate work codes
const SHIFT = ['Y', 'O'];         // 1.2X-rate work codes

export const colLetter = (n) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const addr = (c, r, abs = true) => (abs ? `$${colLetter(c)}$${r}` : `${colLetter(c)}${r}`);
const quote = (name) => `'${name.replace(/'/g, "''")}'`;

// Excel sheet names: max 31 chars, none of \ / ? * [ ] : (apostrophes dropped too), unique (case-insensitive)
export function uniqueSheetName(base, used) {
  let name = String(base).replace(/[\\/?*[\]:']/g, ' ').replace(/\s+/g, ' ').trim() || 'Sheet';
  name = name.slice(0, 31).trim();
  let out = name, i = 2;
  while (used.has(out.toLowerCase())) { const suffix = ` ${i++}`; out = name.slice(0, 31 - suffix.length).trim() + suffix; }
  used.add(out.toLowerCase());
  return out;
}
// "<name> <payroll>", shortening the NAME (never the payroll) so the sheet name fits and stays recognisable
export function employeeSheetName(fullName, payroll, used) {
  const tail = payroll ? ` ${payroll}` : '';
  const room = Math.max(1, 31 - tail.length);
  const clean = String(fullName).replace(/[\\/?*[\]:']/g, ' ').replace(/\s+/g, ' ').trim();
  return uniqueSheetName(`${clean.slice(0, room).trim()}${tail}`, used);
}

// Everything the sheets print that is not per-employee. `exported` for tests / the PDF renderer.
export function reportSettings(model, tpl) {
  const c = tpl.constants, r = model.report ?? {};
  const pick = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
  const name = model.department;
  return {
    deptName: name, deptTitle: `${name} Dept.`, code: model.deptCode ?? '',
    printName: pick(r.dept_print_name, name.toUpperCase()),
    manpower: c.manpower, banner: [c.banner1, pick(model.field, c.defaultField), pick(model.sector, c.defaultSector)],
    captionLeft: c.captionLeft, captionRight: c.captionRight,
    signLeft: `${name} SH/DH`, signRight: `${name} AGM`,
    otTitle: `${name} EMC overtime`, otMiddle: c.overtimeSignoffMiddle, otRight: c.overtimeSignoffRight,
  };
}

// ---------- small drawing helpers ----------
function setCell(ws, r, c, value, o = {}) {
  const cell = ws.getCell(r, c);
  cell.value = value;
  cell.font = { name: o.font ?? TIMES, size: o.size ?? 9, bold: o.bold ?? false, italic: o.italic ?? false, color: o.color ? { argb: o.color } : undefined, underline: o.underline };
  cell.alignment = { horizontal: o.h ?? 'center', vertical: o.v ?? 'middle', wrapText: o.wrap ?? false, textRotation: o.rot, shrinkToFit: o.shrink ?? false };
  if (o.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
  if (o.numFmt) cell.numFmt = o.numFmt;
  if (o.border !== false) cell.border = typeof o.border === 'object' ? o.border : BORDER;
  return cell;
}
function merge(ws, r1, c1, r2, c2, value, o = {}) {
  if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1, c1, r2, c2);
  setCell(ws, r1, c1, value, o);
  if (o.border !== false) for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = typeof o.border === 'object' ? o.border : BORDER;   // merged cells need every edge cell
}
// logo images (optional): place(ws, imageId, { col, row }, widthPx, heightPx)
function logoAt(ws, logos, side, col, row, w, h) {
  const id = logos?.[side];
  if (id !== null && id !== undefined) ws.addImage(id, { tl: { col, row }, ext: { width: w, height: h } });
}
// The three-line blue banner (the company's WordArt look is approximated with a bold condensed font)
function bannerText(S) {
  const run = (text, size) => ({ text, font: { name: 'Impact', size, color: { argb: BLUE } } });
  return { richText: [run(`${S.banner[0]}\n`, 14), run(`${S.banner[1]}\n`, 14), run(S.banner[2], 17)] };
}
function page(ws, { landscape = false, height = 0 } = {}) {
  ws.pageSetup = { paperSize: 9, orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: height, margins: { left: 0.35, right: 0.35, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
  ws.views = [{ showGridLines: false }];
}
// outer frame only (no inner lines) around a block of cells
function frame(ws, r1, c1, r2, c2) {
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
    const cell = ws.getCell(r, c), b = { ...(cell.border ?? {}) };
    if (r === r1) b.top = thin; if (r === r2) b.bottom = thin; if (c === c1) b.left = thin; if (c === c2) b.right = thin;
    cell.border = b;
  }
}

// ---------- day sheet ----------
const D = { first: 9, no: 1, name: 2, title: 3, level: 4, pr: 5, status: 6, acc: 7, tin: 8, tex: 9, ot: 10, cmt: 11, cols: 11 };
function daySheet(wb, model, S, di, name, logos) {
  const ws = wb.addWorksheet(name);
  page(ws, { height: 0 });
  [5.5, 29, 17, 10, 11, 8.5, 9.5, 10.5, 10.5, 10.5, 28].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  // banner box: logo | blue title | logo
  for (let r = 1; r <= 3; r++) ws.getRow(r).height = 25;
  merge(ws, 1, 1, 3, 2, null); merge(ws, 1, 3, 3, 9, bannerText(S), { wrap: true }); merge(ws, 1, 10, 3, 11, null);
  logoAt(ws, logos, 'left', 0.15, 0.1, 118, 70); logoAt(ws, logos, 'right', 9.45, 0.05, 74, 74);
  const day = model.days[di];
  const line = (r, v, o = {}) => { merge(ws, r, 1, r, D.cols, v, { bold: true, size: 9, border: false, ...o }); ws.getRow(r).height = 21; };
  line(4, `${S.deptTitle} Daily Attendance Sheet`); line(5, S.manpower);
  line(6, new Date(Date.UTC(model.year, model.month, day.day)), { numFmt: day.holiday ? 'dd-mmm-yy "(Holiday)"' : 'dd-mmm-yy' });
  ['No.', 'Name', 'Title', 'Level', 'P/R', 'Status', 'Accom.', 'TRANS/IN', 'TRANS/EX', 'Over Time', 'Comments'].forEach((h, i) => setCell(ws, 8, i + 1, h, { bold: true, size: 8, wrap: true }));
  ws.getRow(8).height = 24;
  model.employees.forEach((e, i) => {
    const r = D.first + i, c = e.cells[di];
    setCell(ws, r, D.no, i + 1, { bold: true, size: 8 });
    setCell(ws, r, D.name, e.fullName, { bold: true, size: 8, h: 'left', shrink: true });
    setCell(ws, r, D.title, e.position, { bold: true, size: 8, shrink: true });
    setCell(ws, r, D.level, e.levelText, { bold: true, size: 8 });
    setCell(ws, r, D.pr, e.payroll, { bold: true, size: 8 });
    setCell(ws, r, D.status, c.status, { bold: true, size: 11 });                  // X / Y / E (holidays are shown in the date line)
    setCell(ws, r, D.acc, null);
    setCell(ws, r, D.tin, c.tin || null, { bold: true, size: 9 });
    setCell(ws, r, D.tex, c.tex || null, { bold: true, size: 9 });
    setCell(ws, r, D.ot, c.ot || null, { bold: true, size: 9 });
    setCell(ws, r, D.cmt, c.comment || null, { bold: true, size: 11, wrap: true, shrink: true });
    ws.getRow(r).height = 22;
  });
  const end = D.first + model.employees.length - 1;
  // sign-off box
  const sig = end + 2;
  ws.getRow(sig).height = 44;
  merge(ws, sig, 1, sig, 5, S.signLeft, { bold: true, size: 8, h: 'left', border: false });
  merge(ws, sig, 6, sig, 7, null, { border: false });
  merge(ws, sig, 8, sig, 11, S.signRight, { bold: true, size: 8, h: 'right', border: false });
  frame(ws, sig, 1, sig, 11);
  return { last: end };
}

// ---------- employee sheet ----------
// Columns: left table 1..10, spacer 11, right table 12..21. Each table: Day, Work, B, L, D, Accomd, Trans/IN, Trans/EX, O.V.T, Comment
const E = { dept: 7, name: 8, hdr1: 13, hdr2: 14, first: 15, left: 1, right: 12, half: 15 };
const eCol = (base, k) => base + k;   // k: 0 day,1 work,2 B,3 L,4 D,5 acc,6 tin,7 tex,8 ovt,9 cmt
function employeeSheet(wb, model, S, e, name, dayNames, dayLast, logos, standalone = false) {
  const ws = wb.addWorksheet(name);
  page(ws, { height: 1 });
  [5, 6.5, 2.4, 2.4, 2.4, 3.6, 3.6, 3.6, 6.5, 19, 3.5, 5, 6.5, 2.4, 2.4, 2.4, 3.6, 3.6, 3.6, 6.5, 19].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  // top: logos, captions, title
  for (let r = 1; r <= 3; r++) ws.getRow(r).height = 19;
  logoAt(ws, logos, 'left', 0.25, 0.1, 104, 61); logoAt(ws, logos, 'right', 18.1, 0.1, 62, 62);
  merge(ws, 4, 1, 4, 10, S.captionLeft, { bold: true, size: 8, h: 'left', border: false });
  merge(ws, 4, 12, 4, 21, S.captionRight, { bold: true, size: 8, h: 'right', border: false });
  ws.getRow(4).height = 16;
  merge(ws, 5, 1, 5, 21, 'MONTHLY TIME REPORT', { bold: true, size: 9, underline: true, border: false }); ws.getRow(5).height = 18;
  ws.getRow(6).height = 8;
  const monthDate = new Date(Date.UTC(model.year, model.month, 1));
  const lab = (r, c1, c2, text, o = {}) => merge(ws, r, c1, r, c2, text, { bold: true, size: 8, h: 'left', ...o });
  const val = (r, c1, c2, value, o = {}) => merge(ws, r, c1, r, c2, value, { font: CAL, size: 9, bold: false, ...o });
  // right block: header + 4 rows; left block: 4 rows
  lab(E.dept, 12, 15, 'Department code:', { h: 'center' }); val(E.dept, 16, 21, S.code);
  lab(E.name, 1, 2, 'Name:'); val(E.name, 3, 10, e.fullName);
  lab(E.name + 1, 1, 2, 'Title:'); val(E.name + 1, 3, 10, e.position);
  lab(E.name + 2, 1, 2, 'Level:'); val(E.name + 2, 3, 10, e.levelText);
  lab(E.name + 3, 1, 2, 'Location:'); val(E.name + 3, 3, 10, e.workLocation);
  lab(E.name, 12, 15, 'Month:'); val(E.name, 16, 21, monthDate, { numFmt: 'mmm-yy' });
  lab(E.name + 1, 12, 15, 'Contr. No:'); val(E.name + 1, 16, 21, e.contractNo);
  lab(E.name + 2, 12, 15, 'Department:'); val(E.name + 2, 16, 21, S.printName);
  lab(E.name + 3, 12, 15, 'PAYROLL'); val(E.name + 3, 16, 21, e.payroll);
  const prCell = addr(16, E.name + 3);                       // P/R (payroll) used by the lookups below

  // table headers
  for (const base of [E.left, E.right]) {
    const hd = { bold: true, size: 8 };
    merge(ws, E.hdr1, eCol(base, 0), E.hdr2, eCol(base, 0), 'Day', hd);
    merge(ws, E.hdr1, eCol(base, 1), E.hdr2, eCol(base, 1), 'Work', hd);
    merge(ws, E.hdr1, eCol(base, 2), E.hdr1, eCol(base, 4), 'Meal', hd);
    ['B', 'L', 'D'].forEach((m, i) => setCell(ws, E.hdr2, eCol(base, 2 + i), m, hd));
    [['Accomd.', 5], ['Trans/IN', 6], ['Trans/EX', 7]].forEach(([t, k]) => merge(ws, E.hdr1, eCol(base, k), E.hdr2, eCol(base, k), t, { bold: true, size: 7, rot: 90 }));
    merge(ws, E.hdr1, eCol(base, 8), E.hdr2, eCol(base, 8), 'O.V.T Hrs', { ...hd, wrap: true });
    merge(ws, E.hdr1, eCol(base, 9), E.hdr2, eCol(base, 9), 'Comment', hd);
  }
  ws.getRow(E.hdr1).height = 18; ws.getRow(E.hdr2).height = 26;

  // day rows: left table days 1..15, right table days 16..N. Formulas read the day sheets (or plain values for a stand-alone sheet)
  const idx = (colLtr, ds) => `INDEX(${quote(ds)}!$${colLtr}$${D.first}:$${colLtr}$${dayLast},MATCH(${prCell},${quote(ds)}!$E$${D.first}:$E$${dayLast},0))`;
  const nDays = model.days.length, nRows = Math.max(E.half, nDays - E.half);
  const cells = [];
  for (let k = 0; k < nRows; k++) {
    for (const base of [E.left, E.right]) {
      const d = (base === E.left ? 1 : E.half + 1) + k, r = E.first + k;
      const valid = base === E.left ? d <= E.half : d <= nDays;
      const lblOpt = { bold: true, size: 9 };
      if (!valid && base === E.left) { for (let q = 0; q <= 9; q++) setCell(ws, r, eCol(base, q), null); continue; }
      if (!valid) { for (let q = 0; q <= 9; q++) setCell(ws, r, eCol(base, q), null); continue; }
      setCell(ws, r, eCol(base, 0), d, lblOpt);
      for (let q = 1; q <= 9; q++) setCell(ws, r, eCol(base, q), null, { font: CAL, size: 9 });
      const c = e.cells[d - 1];
      cells.push({ work: c.status, ot: c.ot });
      const put = (q, formula, result, plain, o = {}) => setCell(ws, r, eCol(base, q), standalone ? plain : fx(formula, result), { font: CAL, size: 9, ...o });
      const ds = dayNames[d - 1];
      put(1, `IFERROR(${idx('F', ds)},"E")`, c.status, c.status);
      put(5, `IFERROR(${idx('G', ds)},0)`, 0, 0);
      put(6, `IFERROR(${idx('H', ds)},0)`, c.tin, c.tin);
      put(7, `IFERROR(${idx('I', ds)},0)`, c.tex, c.tex);
      put(8, `IFERROR(${idx('J', ds)},0)`, c.ot, c.ot);
      put(9, `IFERROR(${idx('K', ds)}&"","")`, c.comment, c.comment, { size: 9 });
      ws.getRow(r).height = 15;
    }
  }
  const lastRow = E.first + nRows - 1;
  const rng = (c) => `${addr(c, E.first)}:${addr(c, lastRow)}`;
  const workL = rng(eCol(E.left, 1)), workR = rng(eCol(E.right, 1)), otL = rng(eCol(E.left, 8)), otR = rng(eCol(E.right, 8));

  // legend: three blocks, as on the form
  const L0 = lastRow + 2;
  const legend = [
    [['Work Codes', 'X', 'Work Onshore'], ['Y', 'Day/Night Shift(1.2X)'], ['O', 'Work Offshore']],
    [[null, 'C', 'Work at Cairo'], ['Q', 'Work At Abo Qir'], ['E', 'Vacation']],
    [['Meal Codes', 'B', 'Breakfast'], ['L', 'Lunch'], ['D', 'Dinner']],
  ];
  merge(ws, L0, 1, L0 + 1, 2, 'Work Codes', { bold: true, size: 8, underline: true });
  merge(ws, L0 + 2, 1, L0 + 2, 2, 'Meal Codes', { bold: true, size: 8, underline: true });
  legend.forEach((row, i) => {
    const r = L0 + i;
    setCell(ws, r, 3, row[0][1], { bold: true, size: 8 }); merge(ws, r, 4, r, 8, row[0][2], { font: CAL, size: 8 });
    setCell(ws, r, 9, row[1][0], { bold: true, size: 8 }); merge(ws, r, 10, r, 12, row[1][1], { font: CAL, size: 8 });
    setCell(ws, r, 18, row[2][0], { bold: true, size: 8 }); merge(ws, r, 19, r, 21, row[2][1], { font: CAL, size: 8 });
  });

  // totals
  const T0 = L0 + 4;
  const count = (code) => `COUNTIF(${workL},"${code}")+COUNTIF(${workR},"${code}")`;
  const sum = (codes) => codes.map((c) => `SUMIF(${workL},"${c}",${otL})+SUMIF(${workR},"${c}",${otR})`).join('+');
  const cnt = (code) => cells.filter((x) => x.work === code).length;
  const otOf = (codes) => cells.filter((x) => codes.includes(x.work)).reduce((a, x) => a + x.ot, 0);
  const box = (r, c1, c2, text) => merge(ws, r, c1, r, c2, text, { bold: true, size: 8, underline: true });
  box(T0, 1, 8, 'Codes of Normal Daily Rates'); box(T0, 12, 20, 'Codes of 1.2X Daily Rates');
  const tot = (r, label, c1, c2, v1, v2, formula, result, small = false) => { merge(ws, r, c1, r, c2, label, { font: CAL, size: small ? 7 : 9, h: 'right' }); merge(ws, r, v1, r, v2, fx(formula, result), { font: CAL, size: 9 }); };
  const refs = {};
  tot(T0 + 1, 'Total (X) Days:', 1, 4, 5, 8, count('X'), cnt('X')); refs.X = addr(5, T0 + 1);
  tot(T0 + 2, 'Total (C) Days:', 1, 4, 5, 8, count('C'), cnt('C')); refs.C = addr(5, T0 + 2);
  tot(T0 + 3, 'Total (Q) Days:', 1, 4, 5, 8, count('Q'), cnt('Q')); refs.Q = addr(5, T0 + 3);
  tot(T0 + 4, 'Total Overtime Hours', 1, 4, 5, 8, sum(NORMAL), otOf(NORMAL), true); refs.otNormal = addr(5, T0 + 4);
  tot(T0 + 1, 'Total (Y) Days:', 12, 16, 17, 20, count('Y'), cnt('Y')); refs.Y = addr(17, T0 + 1);
  tot(T0 + 2, 'Total (O) Days:', 12, 16, 17, 20, count('O'), cnt('O')); refs.O = addr(17, T0 + 2);
  tot(T0 + 3, 'Total Overtime Hours', 12, 16, 17, 20, sum(SHIFT), otOf(SHIFT), true); refs.otShift = addr(17, T0 + 3);
  // meals / accommodation / transportation: sums of the day columns (meals are not recorded in the app: 0)
  const sumCol = (k) => `SUM(${rng(eCol(E.left, k))})+SUM(${rng(eCol(E.right, k))})`;
  const sumVal = (k) => e.cells.reduce((a, c) => a + (k === 6 ? c.tin : k === 7 ? c.tex : 0), 0);
  const M0 = T0 + 4;
  merge(ws, M0, 12, M0, 17, 'Total Meals', { bold: true, size: 8, underline: true }); merge(ws, M0, 18, M0 + 1, 19, 'Accomd', { bold: true, size: 8, underline: true });
  merge(ws, M0, 20, M0, 21, 'Transportation', { bold: true, size: 8, underline: true });
  [['B', 12, 13], ['L', 14, 15], ['D', 16, 17]].forEach(([m, a, b]) => merge(ws, M0 + 1, a, M0 + 1, b, m, { bold: true, size: 8 }));
  setCell(ws, M0 + 1, 20, 'EX', { font: CAL, size: 8 }); setCell(ws, M0 + 1, 21, 'IN', { font: CAL, size: 8 });
  [[12, 13, 2], [14, 15, 3], [16, 17, 4]].forEach(([a, b, k]) => merge(ws, M0 + 2, a, M0 + 2, b, fx(sumCol(k), 0), { font: CAL, size: 8 }));
  merge(ws, M0 + 2, 18, M0 + 2, 19, fx(sumCol(5), 0), { font: CAL, size: 8 });
  setCell(ws, M0 + 2, 20, fx(sumCol(7), sumVal(7)), { font: CAL, size: 8 }); setCell(ws, M0 + 2, 21, fx(sumCol(6), sumVal(6)), { font: CAL, size: 8 });
  refs.ex = addr(20, M0 + 2); refs.in = addr(21, M0 + 2);

  // notes + signatures
  const N0 = M0 + 4;
  merge(ws, N0, 1, N0 + 2, 21, 'Notes (Penalty):-', { bold: true, size: 9, h: 'left', v: 'top' });
  const G0 = N0 + 4, dash = '------------------------------';
  ws.getCell(G0, 1).value = null;
  merge(ws, G0, 1, G0, 8, 'Signature Employee', { bold: true, size: 8, h: 'left', border: false });
  merge(ws, G0 + 1, 1, G0 + 1, 8, dash, { size: 8, h: 'left', v: 'bottom', border: false });
  merge(ws, G0, 12, G0, 21, 'Approval of Supervisor', { bold: true, size: 8, h: 'left', border: false });
  merge(ws, G0 + 1, 12, G0 + 1, 21, dash, { size: 8, h: 'left', v: 'bottom', border: false });
  merge(ws, G0 + 3, 12, G0 + 3, 21, 'Approval of Department GM', { bold: true, size: 8, h: 'left', border: false });
  merge(ws, G0 + 4, 12, G0 + 4, 21, dash, { size: 8, h: 'left', v: 'bottom', border: false });
  [G0 + 1, G0 + 4].forEach((r) => { ws.getRow(r).height = 40; }); ws.getRow(G0 + 2).height = 24;   // room to sign
  return {
    sheet: ws.name, refs,
    totals: { X: cnt('X'), C: cnt('C'), Q: cnt('Q'), Y: cnt('Y'), O: cnt('O'), otNormal: otOf(NORMAL), otShift: otOf(SHIFT), ex: sumVal(7), in: sumVal(6) },
  };
}

// ---------- review sheet ----------
const V = { first: 9, no: 1, name: 2, title: 3, level: 4, pr: 5, x: 6, y: 7, total: 8, ot: 9, ext: 10, in: 11, sig: 12, cols: 12, pos: 13 };   // column 13 = the person's position (hidden), used by the totals
function reviewSheet(wb, model, S, emps, name, logos) {
  const ws = wb.addWorksheet(name);
  page(ws, { landscape: true, height: 0 });
  [5, 36, 17, 10, 11, 10, 10, 11, 9, 9, 9, 30].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (let r = 1; r <= 3; r++) ws.getRow(r).height = 22;
  merge(ws, 1, 1, 3, 2, null); merge(ws, 1, 3, 3, 10, bannerText(S), { wrap: true }); merge(ws, 1, 11, 3, 12, null);
  logoAt(ws, logos, 'left', 0.15, 0.1, 118, 62); logoAt(ws, logos, 'right', 10.2, 0.05, 66, 66);
  const line = (r, v) => { merge(ws, r, 1, r, V.cols, v, { bold: true, size: 9, border: false }); ws.getRow(r).height = 16; };
  line(4, `${S.deptTitle} Monthly Attendance Sheet Review`); line(5, S.manpower); line(6, 'Closeout Calculation Sheet');
  ws.getRow(7).height = 5;
  ['No.', 'Name', 'Title', 'Level', 'P/R', '(X)DAYS', '(Y) DAYS', 'Total Days', 'O/T', 'EXT', 'IN', 'Signature'].forEach((h, i) => setCell(ws, 8, i + 1, h, { bold: true, size: 8, fill: i === 7 ? GREY : undefined }));
  const n = model.employees.length, last = V.first + n - 1;
  model.employees.forEach((e, i) => {
    const r = V.first + i, x = emps[i], q = quote(x.sheet);
    const nx = x.totals.X + x.totals.C + x.totals.Q, ny = x.totals.Y + x.totals.O, ot = x.totals.otNormal + x.totals.otShift;
    const b = { bold: true, size: 8 };
    setCell(ws, r, V.no, i + 1, b);
    setCell(ws, r, V.name, e.fullName, { ...b, h: 'left', shrink: true });
    setCell(ws, r, V.title, e.position, { ...b, shrink: true }); setCell(ws, r, V.level, e.levelText, b); setCell(ws, r, V.pr, e.payroll, b);
    setCell(ws, r, V.x, fx(`${q}!${x.refs.X}+${q}!${x.refs.C}+${q}!${x.refs.Q}`, nx), b);
    setCell(ws, r, V.y, fx(`${q}!${x.refs.Y}+${q}!${x.refs.O}`, ny), b);
    setCell(ws, r, V.total, fx(`${addr(V.x, r, false)}+${addr(V.y, r, false)}`, nx + ny), { ...b, fill: GREY });
    setCell(ws, r, V.ot, fx(`${q}!${x.refs.otNormal}+${q}!${x.refs.otShift}`, ot), b);
    setCell(ws, r, V.ext, fx(`${q}!${x.refs.ex}`, x.totals.ex), b);
    setCell(ws, r, V.in, fx(`${q}!${x.refs.in}`, x.totals.in), b);
    setCell(ws, r, V.sig, null);
    setCell(ws, r, V.pos, e.position, { border: false });
    ws.getRow(r).height = 18;
  });
  ws.getColumn(V.pos).hidden = true; setCell(ws, 8, V.pos, 'Position', { border: false });
  // totals by the person's POSITION (free text): positions containing "engineer" / "tech" (case-insensitive); other positions are in neither
  const T = last + 3;
  const totalRng = `$H$${V.first}:$H$${last}`, posRng = `$M$${V.first}:$M$${last}`;
  const daysOf = (i) => emps[i].totals.X + emps[i].totals.C + emps[i].totals.Q + emps[i].totals.Y + emps[i].totals.O;
  const engDays = model.employees.reduce((a, e, i) => (/engineer/i.test(e.position) ? a + daysOf(i) : a), 0);
  const techDays = model.employees.reduce((a, e, i) => (/tech/i.test(e.position) ? a + daysOf(i) : a), 0);
  const b9 = { bold: true, size: 9 };
  merge(ws, T, 2, T, 3, 'Total Engineer Days', b9);
  setCell(ws, T, 4, fx(`SUMIF(${posRng},"*engineer*",${totalRng})`, engDays), { ...b9, fill: GREEN });
  merge(ws, T, 5, T, 11, 'Total Approved (Engineer)', b9); setCell(ws, T, 12, model.approvedEngineer, b9);
  ws.getRow(T).height = 20;
  merge(ws, T + 2, 2, T + 2, 3, 'Total Technition Days', b9);
  setCell(ws, T + 2, 4, fx(`SUMIF(${posRng},"*tech*",${totalRng})`, techDays), { ...b9, fill: GREEN });
  merge(ws, T + 2, 5, T + 2, 11, 'Total Approved (Tech)', b9); setCell(ws, T + 2, 12, model.approvedTech, b9);
  ws.getRow(T + 2).height = 20;
  const sig = T + 5;
  merge(ws, sig, 1, sig, 4, S.signLeft, { bold: true, size: 8, border: false, h: 'left' });
  merge(ws, sig, 9, sig, V.cols, S.signRight, { bold: true, size: 8, border: false, h: 'right' });
  return { engineerDays: engDays, technicianDays: techDays };
}

// ---------- overtime summary ----------
// People with overtime x the DATES that had overtime, a Total column and the three sign-offs. The date columns are hidden
// (as in the printed form, which shows No. / Name / P/R / Total); unhide them in Excel to see the breakdown.
function overtimeSheet(wb, model, S, emps, name) {
  const ws = wb.addWorksheet(name);
  page(ws, { landscape: true, height: 1 });
  const who = model.employees.map((e, i) => ({ e, i })).filter(({ e }) => e.totals.ot > 0);
  const dates = model.days.filter((d, di) => who.some(({ e }) => e.cells[di].ot > 0));
  const dateCols = dates.length, totalCol = 4 + dateCols;
  ws.getColumn(1).width = 6; ws.getColumn(2).width = 36; ws.getColumn(3).width = 18;
  dates.forEach((_, k) => { ws.getColumn(4 + k).width = 8; ws.getColumn(4 + k).hidden = true; });
  ws.getColumn(totalCol).width = 14;
  const span = totalCol;
  ws.getRow(1).height = 30;
  merge(ws, 1, 1, 1, Math.max(span, 4), S.otTitle, { font: CAL, bold: true, size: 16, border: false });
  ws.getRow(2).height = 6;
  const hd = { bold: true, size: 11 };
  setCell(ws, 3, 1, 'No.', hd); setCell(ws, 3, 2, 'Name', hd); setCell(ws, 3, 3, 'P/R', hd);
  dates.forEach((d, k) => setCell(ws, 3, 4 + k, new Date(Date.UTC(model.year, model.month, d.day)), { ...hd, numFmt: 'd-mmm' }));
  setCell(ws, 3, totalCol, 'Total', { ...hd, font: CAL });
  ws.getRow(3).height = 24;
  who.forEach(({ e, i }, k) => {
    const r = 4 + k, ob = { bold: true, size: 11 };
    setCell(ws, r, 1, k + 1, ob); setCell(ws, r, 2, e.fullName, { ...ob, h: 'left', shrink: true }); setCell(ws, r, 3, e.payroll, ob);
    dates.forEach((d, c) => setCell(ws, r, 4 + c, e.cells[d.day - 1].ot || null, { ...ob, font: CAL }));
    const x = emps[i];
    setCell(ws, r, totalCol, fx(`${quote(x.sheet)}!${x.refs.otNormal}+${quote(x.sheet)}!${x.refs.otShift}`, x.totals.otNormal + x.totals.otShift), { ...ob, font: CAL });
    ws.getRow(r).height = 24;
  });
  const end = 4 + Math.max(who.length, 1) - 1;
  if (!who.length) { ['', '', '', ...Array(dateCols)].forEach((_, c) => setCell(ws, 4, c + 1, null)); setCell(ws, 4, totalCol, null); }
  const sig = end + 3;
  ws.getRow(sig).height = 24;
  const sg = { font: 'Arial', bold: true, size: 11, border: false };
  setCell(ws, sig, 2, S.signRight, sg); setCell(ws, sig, 3, S.otMiddle, sg); setCell(ws, sig, totalCol, S.otRight, sg);
  merge(ws, sig + 1, 1, sig + 2, Math.max(totalCol, 4), null, {});
}

// ---------- closeout back-to-back (B2B) sheets: one for the engineers, one for the techs ----------
// Per person: days by work code, overtime by code, meals, transportation and the total of days, all read from the employee
// sheets. "Actual No. of days" = the sum of the total column; "Total No. B/B days" = the approved total of the department data.
function b2bSheet(wb, model, S, emps, name, logos, kind) {
  const ws = wb.addWorksheet(name);
  page(ws, { landscape: true, height: 0 });
  [5, 12, 28, 10, 5, 5, 5, 5, 5, 9, 9, 9, 5, 5, 5, 6, 6, 9, 9, 10, 34].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const mine = model.employees.map((e, i) => ({ e, i })).filter(({ e }) => (kind === 'eng' ? /engineer/i.test(e.position) : /tech/i.test(e.position)));
  const approved = kind === 'eng' ? model.approvedEngineer : model.approvedTech;
  for (let r = 1; r <= 3; r++) ws.getRow(r).height = 20;
  logoAt(ws, logos, 'left', 1.1, 0.1, 118, 56); logoAt(ws, logos, 'right', 17.9, 0.05, 62, 62);
  merge(ws, 4, 4, 4, 14, 'MONTHLY TIME SHEET REPORT (For Back to Back)', { font: CAL, size: 9, underline: true, border: false }); ws.getRow(4).height = 18;
  merge(ws, 5, 1, 5, 3, S.captionLeft, { font: CAL, size: 9, h: 'left', border: false });
  merge(ws, 5, 4, 5, 5, 'Month:', { font: CAL, size: 11, bold: true, h: 'left', border: false });
  merge(ws, 5, 6, 5, 9, new Date(Date.UTC(model.year, model.month, 1)), { font: CAL, size: 9, underline: true, numFmt: 'mmm-yy', border: false });
  merge(ws, 5, 17, 5, 21, S.captionRight, { font: CAL, size: 9, border: false }); ws.getRow(5).height = 24;
  const loc = mine.map(({ e }) => e.workLocation).find((v) => v) ?? '';
  merge(ws, 7, 1, 7, 2, 'Location:', { font: CAL, size: 8, h: 'left' }); merge(ws, 7, 3, 7, 4, loc, { font: CAL, size: 8, bold: true });
  merge(ws, 7, 11, 7, 13, 'Department:', { font: CAL, size: 8 }); merge(ws, 7, 14, 7, 17, S.deptName, { font: CAL, size: 8, bold: true });
  merge(ws, 7, 19, 7, 21, `Department Code: ${S.code}`, { font: CAL, size: 8, bold: true, h: 'left' }); ws.getRow(7).height = 18;
  // headers
  const hd = { font: CAL, size: 8, bold: true, wrap: true };
  [['Ser', 1], ['Payroll', 2], ['Name', 3], ['Level', 4], ['Total No. of days', 18], ['Actual No. of days', 19], ['Total No. B/B days', 20], ['Comments', 21]].forEach(([t, c]) => merge(ws, 9, c, 10, c, t, hd));
  merge(ws, 9, 5, 9, 9, 'Days No', hd); ['C', 'X', 'Y', 'O', 'Q'].forEach((t, i) => setCell(ws, 10, 5 + i, t, hd));
  merge(ws, 9, 10, 9, 12, 'Over time', hd); ['X_overtime', 'Y_overtime', 'O_overtime'].forEach((t, i) => setCell(ws, 10, 10 + i, t, { ...hd, size: 7 }));
  merge(ws, 9, 13, 9, 15, 'Meals', hd); ['B', 'L', 'D'].forEach((t, i) => setCell(ws, 10, 13 + i, t, hd));
  merge(ws, 9, 16, 9, 17, 'Transportation', { ...hd, size: 7 }); ['In', 'Ex'].forEach((t, i) => setCell(ws, 10, 16 + i, t, hd));
  ws.getRow(9).height = 16; ws.getRow(10).height = 24;
  const first = 11, last = first + Math.max(mine.length, 1) - 1, hide = '0;-0;;@';
  let actual = 0;
  const body = { font: CAL, size: 9 };
  for (let k = 0; k < Math.max(mine.length, 1); k++) {
    const r = first + k, m = mine[k];
    ws.getRow(r).height = 24;
    if (!m) { for (let c = 1; c <= 21; c++) setCell(ws, r, c, null); continue; }
    const { e, i } = m, x = emps[i], q = quote(x.sheet), t = x.totals;
    const days = t.X + t.C + t.Q + t.Y + t.O; actual += days;
    setCell(ws, r, 1, k + 1, body); setCell(ws, r, 2, e.payroll, body); setCell(ws, r, 3, e.fullName, { ...body, shrink: true }); setCell(ws, r, 4, e.levelText, body);
    const ref = (a) => `${q}!${a}`;
    setCell(ws, r, 5, fx(ref(x.refs.C), t.C), { ...body, numFmt: hide });
    setCell(ws, r, 6, fx(ref(x.refs.X), t.X), body);
    setCell(ws, r, 7, fx(ref(x.refs.Y), t.Y), body);
    setCell(ws, r, 8, fx(ref(x.refs.O), t.O), { ...body, numFmt: hide });
    setCell(ws, r, 9, fx(ref(x.refs.Q), t.Q), { ...body, numFmt: hide });
    setCell(ws, r, 10, fx(ref(x.refs.otNormal), t.otNormal), body);      // overtime on X (normal-rate) days
    setCell(ws, r, 11, fx(ref(x.refs.otShift), t.otShift), body);        // overtime on Y (1.2X) days
    setCell(ws, r, 12, null, body);                                      // O_overtime: the app records no offshore work
    for (const c of [13, 14, 15]) setCell(ws, r, c, null, body);          // meals are not recorded
    setCell(ws, r, 16, fx(ref(x.refs.in), t.in), { ...body, numFmt: hide });
    setCell(ws, r, 17, fx(ref(x.refs.ex), t.ex), { ...body, numFmt: hide });
    setCell(ws, r, 18, fx(`SUM(${addr(5, r, false)}:${addr(9, r, false)})`, days), body);
    setCell(ws, r, 21, null, body);
  }
  merge(ws, first, 19, last, 19, mine.length ? fx(`SUM(${addr(18, first, false)}:${addr(18, last, false)})`, actual) : null, { font: CAL, size: 10 });
  merge(ws, first, 20, last, 20, approved, { font: CAL, size: 10 });
  const sg = last + 3, sgo = { font: CAL, size: 9, bold: true, h: 'left', border: false };
  merge(ws, sg, 1, sg, 5, 'Approval of Department AGM', sgo); merge(ws, sg + 1, 1, sg + 1, 5, '------------------------------', { ...sgo, bold: false, v: 'top' });
  merge(ws, sg, 11, sg, 17, 'Approval of Department GM', sgo); merge(ws, sg + 1, 11, sg + 1, 17, '------------------------------', { ...sgo, bold: false, v: 'top' });
  merge(ws, sg + 3, 11, sg + 3, 17, 'Approval of DFGM', sgo); merge(ws, sg + 4, 11, sg + 4, 17, '------------------------------', { ...sgo, bold: false, v: 'top' });
  [sg + 1, sg + 4].forEach((r) => { ws.getRow(r).height = 22; });
  return { rows: mine.length, actual };
}

// ---------- entry points ----------
async function loadLogos(wb, tpl, loadAsset) {
  const logos = { left: null, right: null };
  if (!loadAsset) return logos;
  for (const side of ['left', 'right']) {
    try { const buf = await loadAsset(`${tpl.logoBase}-${side}.png`); if (buf) logos[side] = wb.addImage({ buffer: buf, extension: 'png' }); } catch { /* no logo: captions only */ }
  }
  return logos;
}

export async function buildOfficialWorkbook(model, tpl, ExcelJS, { loadAsset, cacheResults = true } = {}) {
  CACHE = cacheResults;
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;          // Excel / LibreOffice recompute every formula when the file is opened
  const S = reportSettings(model, tpl);
  const logos = await loadLogos(wb, tpl, loadAsset);
  const used = new Set();
  const dayNames = model.days.map((d) => uniqueSheetName(String(d.day), used));
  let dayLast = D.first;
  model.days.forEach((_, i) => { dayLast = daySheet(wb, model, S, i, dayNames[i], logos).last; });
  dayLast = Math.max(dayLast, D.first);
  const emps = model.employees.map((e) => employeeSheet(wb, model, S, e, employeeSheetName(e.fullName, e.payroll, used), dayNames, dayLast, logos));
  reviewSheet(wb, model, S, emps, uniqueSheetName('Review', used), logos);
  overtimeSheet(wb, model, S, emps, uniqueSheetName('Overtime', used));
  b2bSheet(wb, model, S, emps, uniqueSheetName('Closeout B2B Eng', used), logos, 'eng');      // the last two sheets: back-to-back closeout for engineers / techs
  b2bSheet(wb, model, S, emps, uniqueSheetName('Closeout B2B Tech', used), logos, 'tech');
  return wb;
}

// One person's "Monthly Time Report" on its own (no day sheets): what a person downloads from their calendar.
export async function buildEmployeeWorkbook(model, tpl, ExcelJS, { loadAsset, employeeId, cacheResults = true } = {}) {
  CACHE = cacheResults;
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const S = reportSettings(model, tpl);
  const logos = await loadLogos(wb, tpl, loadAsset);
  const e = model.employees.find((x) => x.id === employeeId) ?? model.employees[0];
  employeeSheet(wb, model, S, e, employeeSheetName(e.fullName, e.payroll, new Set()), model.days.map((d) => String(d.day)), D.first, logos, true);   // names unused: plain values
  return wb;
}
