// PDF version of the official monthly report: day pages, one page per employee, the review and the overtime summary,
// drawn directly (selectable text, vector tables, the company logos). Layout follows the company form / its Excel version.
// Standard PDF fonts only (Times / Helvetica), so text is Latin: characters outside Latin-1 print as "?".
import { reportSettings } from './official.js';

const NORMAL = ['X', 'C', 'Q'], SHIFT = ['Y', 'O'];

const M = 28;                                        // page margin (pt)
const BLUE = [59, 79, 160];
const GREY = [217, 217, 217], GREEN = [226, 239, 218];
const latin = (v) => String(v ?? '').replace(/[^ -~ -ÿ]/g, '?');

// ---------- drawing helpers ----------
function tx(doc, str, x, y, { size = 8, bold = false, font = 'sans', align = 'left', maxW, color = [0, 0, 0], angle = 0, underline = false } = {}) {
  const s = latin(str);
  if (s === '') return;
  doc.setFont(font === 'times' ? 'times' : 'helvetica', bold ? 'bold' : 'normal');
  let sz = size;
  doc.setFontSize(sz);
  if (maxW) while (doc.getTextWidth(s) > maxW && sz > 4) { sz -= 0.5; doc.setFontSize(sz); }
  doc.setTextColor(...color);
  doc.text(s, x, y, { align, baseline: 'middle', angle });
  if (underline) {
    const w = doc.getTextWidth(s), x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    doc.setDrawColor(0); doc.setLineWidth(0.5); doc.line(x0, y + sz * 0.5, x0 + w, y + sz * 0.5);
  }
}
// bordered cell with text
function cell(doc, x, y, w, h, str, o = {}) {
  if (o.fill) { doc.setFillColor(...o.fill); doc.rect(x, y, w, h, 'F'); }
  if (o.border !== false) { doc.setDrawColor(0); doc.setLineWidth(0.5); doc.rect(x, y, w, h, 'S'); }
  const align = o.h ?? 'center', pad = 2.5;
  const tx0 = align === 'left' ? x + pad : align === 'right' ? x + w - pad : x + w / 2;
  tx(doc, str, tx0, y + h / 2 + (o.dy ?? 0), { size: o.size ?? 8, bold: o.bold ?? false, font: o.font ?? 'sans', align, maxW: w - pad * 2, angle: o.angle ?? 0, underline: o.underline, color: o.color });
}
function logo(doc, logos, side, x, y, w, h) {
  const l = logos?.[side];
  if (!l) return;
  const ratio = l.width && l.height ? l.width / l.height : 1;
  let dw = w, dh = w / ratio;
  if (dh > h) { dh = h; dw = h * ratio; }
  doc.addImage(l.data, 'PNG', x + (w - dw) / 2, y + (h - dh) / 2, dw, dh, `logo-${side}`, 'FAST');
}
// the blue three-line banner box: logo | title | logo
function banner(doc, S, logos, x, y, w, h, leftW, rightW) {
  doc.setDrawColor(0); doc.setLineWidth(0.8); doc.rect(x, y, w, h, 'S');
  doc.setLineWidth(0.5); doc.line(x + leftW, y, x + leftW, y + h); doc.line(x + w - rightW, y, x + w - rightW, y + h);
  logo(doc, logos, 'left', x + 4, y + 3, leftW - 8, h - 6); logo(doc, logos, 'right', x + w - rightW + 4, y + 3, rightW - 8, h - 6);
  const cx = x + leftW + (w - leftW - rightW) / 2;
  tx(doc, S.banner[0], cx, y + h * 0.24, { size: 12, bold: true, align: 'center', color: BLUE, maxW: w - leftW - rightW - 10 });
  tx(doc, S.banner[1], cx, y + h * 0.5, { size: 12, bold: true, align: 'center', color: BLUE, maxW: w - leftW - rightW - 10 });
  tx(doc, S.banner[2], cx, y + h * 0.78, { size: 15, bold: true, align: 'center', color: BLUE, maxW: w - leftW - rightW - 10 });
}
const dateText = (model, d) => new Date(Date.UTC(model.year, model.month, d)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' }).replace(/ /g, '-');
const monthText = (model) => new Date(Date.UTC(model.year, model.month, 1)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace(' ', '-');


const PW = 595.28, PH = 841.89;
const TIMES = { font: 'times', bold: true };

// ---------- day pages ----------
const DW = [5.5, 29, 17, 10, 11, 8.5, 9.5, 10.5, 10.5, 10.5, 28];
function dayPages(model, S, logos, newPage, doc) {
  const W = PW - 2 * M, u = W / DW.reduce((a, b) => a + b, 0), cw = DW.map((w) => w * u);
  const xs = cw.map((_, i) => M + cw.slice(0, i).reduce((a, b) => a + b, 0));
  const RH = 18.5, HH = 22, SIGN = 70;
  model.days.forEach((dy, di) => {
    let i = 0, first = true;
    do {
      newPage('portrait');
      let y = 30;
      if (first) {
        banner(doc, S, logos, M, y, W, 66, 128, 128); y += 66;
        tx(doc, `${S.deptTitle} Daily Attendance Sheet`, M + W / 2, y + 12, { size: 8.5, ...TIMES, align: 'center' });
        tx(doc, S.manpower, M + W / 2, y + 28, { size: 8.5, ...TIMES, align: 'center' });
        tx(doc, dateText(model, dy.day) + (dy.holiday ? ' (Holiday)' : ''), M + W / 2, y + 44, { size: 8.5, ...TIMES, align: 'center' });
        y += 56;
      }
      ['No.', 'Name', 'Title', 'Level', 'P/R', 'Status', 'Accom.', 'TRANS/IN', 'TRANS/EX', 'Over Time', 'Comments'].forEach((h, k) => cell(doc, xs[k], y, cw[k], HH, h, { ...TIMES, size: 7.5 }));
      y += HH;
      const room = Math.floor((PH - M - y) / RH);
      const left = model.employees.length - i;
      const n = left <= room - Math.ceil(SIGN / RH) ? left : Math.min(room, left);   // keep the sign-off with the last rows when it fits
      for (let k = 0; k < n; k++, i++) {
        const e = model.employees[i], c = e.cells[di], r = y + k * RH, b = { ...TIMES, size: 7.5 };
        cell(doc, xs[0], r, cw[0], RH, String(i + 1), b); cell(doc, xs[1], r, cw[1], RH, e.fullName, { ...b, h: 'left' });
        cell(doc, xs[2], r, cw[2], RH, e.jobTitle, b); cell(doc, xs[3], r, cw[3], RH, e.levelText, b); cell(doc, xs[4], r, cw[4], RH, e.opr, b);
        cell(doc, xs[5], r, cw[5], RH, c.status, { ...b, size: 10 }); cell(doc, xs[6], r, cw[6], RH, '', b);
        cell(doc, xs[7], r, cw[7], RH, c.tin ? String(c.tin) : '', { ...b, size: 9 }); cell(doc, xs[8], r, cw[8], RH, c.tex ? String(c.tex) : '', { ...b, size: 9 });
        cell(doc, xs[9], r, cw[9], RH, c.ot ? String(c.ot) : '', { ...b, size: 9 }); cell(doc, xs[10], r, cw[10], RH, c.comment, { ...b, size: 9 });
      }
      y += n * RH;
      if (i >= model.employees.length && y + SIGN <= PH - M + 10) {
        tx(doc, S.signLeft, M + 6, y + 24, { size: 8, ...TIMES });
        tx(doc, S.signRight, M + W - 6, y + 24, { size: 8, ...TIMES, align: 'right' });
      } else if (i >= model.employees.length) {            // sign-off alone on a follow-up page
        newPage('portrait');
        tx(doc, S.signLeft, M + 6, 60, { size: 8, ...TIMES });
        tx(doc, S.signRight, M + W - 6, 60, { size: 8, ...TIMES, align: 'right' });
      }
      first = false;
    } while (i < model.employees.length);
  });
}

// ---------- employee page ----------
const EW = [5, 6.5, 2.4, 2.4, 2.4, 3.6, 3.6, 3.6, 6.5, 19];
function employeePage(model, S, logos, e, doc) {
  const W = PW - 2 * M, half = W / 2 - 4, u = half / EW.reduce((a, b) => a + b, 0), cw = EW.map((w) => w * u);
  const colX = (x0, k) => x0 + cw.slice(0, k).reduce((a, b) => a + b, 0);
  const X0 = M, X1 = M + W / 2 + 4;
  let y = 30;
  banner(doc, S, logos, M, y, W, 60, 120, 120); y += 62;
  tx(doc, S.captionLeft, M + 4, y + 7, { size: 7.5, ...TIMES });
  tx(doc, S.captionRight, M + W - 4, y + 7, { size: 7.5, ...TIMES, align: 'right' });
  y += 20;
  tx(doc, 'MONTHLY TIME REPORT', M + W / 2, y + 6, { size: 9, ...TIMES, align: 'center', underline: true });
  y += 22;
  const RH = 15, lw = 48, vw = half - lw;
  const row = (x0, r, label, value, lwid = lw) => { cell(doc, x0, y + r * RH, lwid, RH, label, { ...TIMES, size: 7.5, h: 'left' }); cell(doc, x0 + lwid, y + r * RH, half - lwid, RH, value, { size: 8.5, h: 'left' }); };
  const mon = monthText(model);
  row(X1, 0, 'Department code:', S.code, 70);
  row(X0, 1, 'Name:', e.fullName); row(X0, 2, 'Title:', e.jobTitle); row(X0, 3, 'Level:', e.levelText); row(X0, 4, 'Location:', e.workLocation || S.site);
  row(X1, 1, 'Month:', mon, 70); row(X1, 2, 'Contr. No:', e.contractNo, 70); row(X1, 3, 'Department:', S.printName, 70); row(X1, 4, 'PAYROLL', e.opr, 70);
  void vw;
  y += 5 * RH + 8;
  // table header
  const hd = (x0) => {
    const H1 = 12, H2 = 22;
    cell(doc, colX(x0, 0), y, cw[0], H1 + H2, 'Day', { ...TIMES, size: 7 }); cell(doc, colX(x0, 1), y, cw[1], H1 + H2, 'Work', { ...TIMES, size: 7 });
    cell(doc, colX(x0, 2), y, cw[2] + cw[3] + cw[4], H1, 'Meal', { ...TIMES, size: 7 });
    ['B', 'L', 'D'].forEach((m, k) => cell(doc, colX(x0, 2 + k), y + H1, cw[2 + k], H2, m, { ...TIMES, size: 7 }));
    [['Accomd.', 5], ['Trans/IN', 6], ['Trans/EX', 7]].forEach(([t, k]) => { cell(doc, colX(x0, k), y, cw[k], H1 + H2, '', {}); tx(doc, t, colX(x0, k) + cw[k] / 2 + 2.5, y + (H1 + H2) / 2, { size: 6, ...TIMES, align: 'center', angle: 90, maxW: H1 + H2 - 4 }); });
    cell(doc, colX(x0, 8), y, cw[8], H1 + H2, 'OVT Hrs', { ...TIMES, size: 6.5 }); cell(doc, colX(x0, 9), y, cw[9], H1 + H2, 'Comment', { ...TIMES, size: 7 });
  };
  hd(X0); hd(X1);
  y += 34;
  const n = model.days.length, rows = Math.max(15, n - 15), DR = 15.5;
  for (let k = 0; k < rows; k++) {
    [[X0, 1 + k, 15], [X1, 16 + k, n]].forEach(([x0, d, lim]) => {
      for (let q = 0; q < 10; q++) cell(doc, colX(x0, q), y + k * DR, cw[q], DR, '', {});
      if (d > lim) return;
      const c = e.cells[d - 1], b = { size: 8 };
      cell(doc, colX(x0, 0), y + k * DR, cw[0], DR, String(d), { ...TIMES, size: 8, border: false }); cell(doc, colX(x0, 1), y + k * DR, cw[1], DR, c.status, { ...b, border: false });
      cell(doc, colX(x0, 6), y + k * DR, cw[6], DR, c.tin ? String(c.tin) : '', { ...b, border: false }); cell(doc, colX(x0, 7), y + k * DR, cw[7], DR, c.tex ? String(c.tex) : '', { ...b, border: false });
      cell(doc, colX(x0, 8), y + k * DR, cw[8], DR, c.ot ? String(c.ot) : '', { ...b, border: false }); cell(doc, colX(x0, 9), y + k * DR, cw[9], DR, c.comment, { size: 6.5, border: false });
    });
  }
  y += rows * DR + 8;
  // legend
  const leg = [['Work Codes', 'X  Work Onshore', 'Y  Day/Night Shift (1.2X)', 'Meal Codes', 'B  Breakfast'], ['', 'C  Work at Cairo', 'Q  Work At Abo Qir', '', 'L  Lunch'], ['', 'O  Work Offshore', 'E  Vacation', '', 'D  Dinner']];
  leg.forEach((r, k) => { tx(doc, r[0], X0, y + k * 10, { size: 7, ...TIMES, underline: !!r[0] }); tx(doc, r[1], X0 + 60, y + k * 10, { size: 7 }); tx(doc, r[2], X0 + 190, y + k * 10, { size: 7 }); tx(doc, r[3], X1 + 90, y + k * 10, { size: 7, ...TIMES, underline: !!r[3] }); tx(doc, r[4], X1 + 150, y + k * 10, { size: 7 }); });
  y += 40;
  // totals
  const t = e.cells.reduce((a, c) => { a[c.status] = (a[c.status] || 0) + 1; if (NORMAL.includes(c.status)) a.otN += c.ot; if (SHIFT.includes(c.status)) a.otS += c.ot; a.tin += c.tin; a.tex += c.tex; return a; }, { otN: 0, otS: 0, tin: 0, tex: 0 });
  const line = (x0, yy, label, v) => { tx(doc, label, x0 + 90, yy, { size: 8, align: 'right' }); cell(doc, x0 + 96, yy - 7, 50, 14, String(v), { size: 8.5 }); };
  tx(doc, 'Codes of Normal Daily Rates', X0, y, { size: 7.5, ...TIMES, underline: true }); tx(doc, 'Codes of 1.2X Daily Rates', X1, y, { size: 7.5, ...TIMES, underline: true });
  line(X0, y + 16, 'Total (X) Days:', t.X || 0); line(X0, y + 32, 'Total (C) Days:', t.C || 0); line(X0, y + 48, 'Total (Q) Days:', t.Q || 0); line(X0, y + 64, 'Total Overtime Hours', t.otN);
  line(X1, y + 16, 'Total (Y) Days:', t.Y || 0); line(X1, y + 32, 'Total (O) Days:', t.O || 0); line(X1, y + 48, 'Total Overtime Hours', t.otS);
  tx(doc, 'Total Meals  B 0  L 0  D 0', X1, y + 66, { size: 7.5, ...TIMES });
  tx(doc, `Accomd 0   Transportation  EX ${t.tex}   IN ${t.tin}`, X1, y + 78, { size: 7.5, ...TIMES });
  y += 92;
  doc.setDrawColor(0); doc.setLineWidth(0.5); doc.rect(M, y, W, 28, 'S');
  tx(doc, 'Notes (Penalty):-', M + 4, y + 8, { size: 8, ...TIMES });
  y += 46;
  tx(doc, 'Signature Employee', X0, y, { size: 8, ...TIMES }); tx(doc, 'Approval of Supervisor', X1, y, { size: 8, ...TIMES });
  tx(doc, '.....................................', X0, y + 12, { size: 8 }); tx(doc, '.....................................', X1, y + 12, { size: 8 });
  tx(doc, 'Approval of Department GM', X1, y + 34, { size: 8, ...TIMES }); tx(doc, '.....................................', X1, y + 46, { size: 8 });
  return { t };
}

// ---------- review page(s) ----------
const VW = [5, 36, 17, 10, 11, 10, 10, 11, 9, 9, 9, 30];
function reviewPages(model, S, logos, newPage, doc, sums) {
  const W = 841.89 - 2 * M, u = W / VW.reduce((a, b) => a + b, 0), cw = VW.map((w) => w * u), xs = cw.map((_, i) => M + cw.slice(0, i).reduce((a, b) => a + b, 0));
  const RH = 17;
  let i = 0, first = true;
  do {
    newPage('landscape');
    let y = 26;
    if (first) {
      banner(doc, S, logos, M, y, W, 56, 130, 130); y += 60;
      tx(doc, `${S.deptTitle} Monthly Attendance Sheet Review`, M, y + 6, { size: 9, ...TIMES }); tx(doc, S.manpower, M, y + 18, { size: 9, ...TIMES }); tx(doc, 'Closeout Calculation Sheet', M, y + 30, { size: 9, ...TIMES });
      y += 38;
    }
    ['No.', 'Name', 'Title', 'Level', 'P/R', '(X)DAYS', '(Y) DAYS', 'Total Days', 'O/T', 'EXT', 'IN', 'Signature'].forEach((h, k) => cell(doc, xs[k], y, cw[k], 16, h, { ...TIMES, size: 7.5, fill: k === 7 ? GREY : undefined }));
    y += 16;
    const room = Math.floor((PH_L - M - y) / RH), left = model.employees.length - i, tail = 6 * RH;
    const n = left <= room - 6 ? left : Math.min(room, left);
    for (let k = 0; k < n; k++, i++) {
      const e = model.employees[i], s = sums[i], r = y + k * RH, b = { ...TIMES, size: 7.5 };
      const nx = s.X + s.C + s.Q, ny = s.Y + s.O;
      cell(doc, xs[0], r, cw[0], RH, String(i + 1), b); cell(doc, xs[1], r, cw[1], RH, e.fullName, { ...b, h: 'left' }); cell(doc, xs[2], r, cw[2], RH, e.jobTitle, b);
      cell(doc, xs[3], r, cw[3], RH, e.levelText, b); cell(doc, xs[4], r, cw[4], RH, e.opr, b); cell(doc, xs[5], r, cw[5], RH, String(nx), b); cell(doc, xs[6], r, cw[6], RH, String(ny), b);
      cell(doc, xs[7], r, cw[7], RH, String(nx + ny), { ...b, fill: GREY }); cell(doc, xs[8], r, cw[8], RH, String(s.otN + s.otS), b);
      cell(doc, xs[9], r, cw[9], RH, String(s.tex), b); cell(doc, xs[10], r, cw[10], RH, String(s.tin), b); cell(doc, xs[11], r, cw[11], RH, '', b);
    }
    y += n * RH;
    if (i >= model.employees.length) {
      void tail;
      const days = (k) => sums[k].X + sums[k].C + sums[k].Q + sums[k].Y + sums[k].O;
      let eng = 0, all = 0; model.employees.forEach((e, k) => { all += days(k); if (/engineer/i.test(e.jobTitle)) eng += days(k); });
      y += 12;
      const b9 = { ...TIMES, size: 8.5 };
      cell(doc, xs[1], y, cw[1] + cw[2], 18, 'Total Engineer Days', b9); cell(doc, xs[3], y, cw[3], 18, String(eng), { ...b9, fill: GREEN }); cell(doc, xs[4], y, cw[4] + cw[5] + cw[6] + cw[7] + cw[8], 18, 'Total Approved (Engineer)', b9);
      y += 26;
      cell(doc, xs[1], y, cw[1] + cw[2], 18, 'Total Technition Days', b9); cell(doc, xs[3], y, cw[3], 18, String(all - eng), { ...b9, fill: GREEN }); cell(doc, xs[4], y, cw[4] + cw[5] + cw[6] + cw[7] + cw[8], 18, 'Total Approved (Tech)', b9);
      y += 34;
      tx(doc, S.signLeft, M, y, { size: 8, ...TIMES }); tx(doc, S.signRight, M + W, y, { size: 8, ...TIMES, align: 'right' });
    }
    first = false;
  } while (i < model.employees.length);
}
const PH_L = 595.28;

// ---------- overtime page ----------
function overtimePage(model, S, newPage, doc, sums) {
  newPage('landscape');
  const W = 841.89 - 2 * M, who = model.employees.map((e, i) => ({ e, i })).filter(({ e }) => e.totals.ot > 0);
  tx(doc, S.otTitle, M + W / 2, 44, { size: 16, bold: true, align: 'center', maxW: W });
  const xs = [M + 80, M + 130, M + 440, M + 590], RH = 24;
  let y = 70;
  ['No.', 'Name', 'P/R', 'Total'].forEach((h, k) => cell(doc, xs[k], y, [50, 310, 150, 100][k], RH, h, { bold: true, size: 11 }));
  y += RH;
  who.forEach(({ e, i }, k) => {
    if (y + RH > PH_L - 80) { newPage('landscape'); y = 40; }
    const s = sums[i];
    [String(k + 1), e.fullName, e.opr, String(s.otN + s.otS)].forEach((v, q) => cell(doc, xs[q], y, [50, 310, 150, 100][q], RH, v, { bold: true, size: 11, h: q === 1 ? 'left' : 'center' }));
    y += RH;
  });
  y += 36;
  tx(doc, S.signRight, xs[1], y, { size: 11, bold: true }); tx(doc, S.otMiddle, xs[2], y, { size: 11, bold: true }); tx(doc, S.otRight, xs[3] + 50, y, { size: 11, bold: true, align: 'center' });
}

function sumsOf(e) {
  const a = { X: 0, C: 0, Q: 0, Y: 0, O: 0, otN: 0, otS: 0, tin: 0, tex: 0 };
  for (const c of e.cells) { if (a[c.status] !== undefined) a[c.status]++; if (NORMAL.includes(c.status)) a.otN += c.ot; else if (SHIFT.includes(c.status)) a.otS += c.ot; a.tin += c.tin; a.tex += c.tex; }
  return a;
}

// logos: { left: {data:'data:image/png;base64,...', width, height}, right: {...} } (optional)
// employeeId: only that person's Monthly Time Report page.
export function buildOfficialPdf(model, tpl, { jsPDF, logos = {}, employeeId = null } = {}) {
  const S = reportSettings(model, tpl);
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true });
  let started = false;
  const newPage = (orientation) => { if (started) doc.addPage('a4', orientation); else { started = true; if (orientation !== 'portrait') doc.deletePage(1), doc.addPage('a4', orientation); } };
  const sums = model.employees.map(sumsOf);
  if (employeeId) {
    const k = Math.max(0, model.employees.findIndex((x) => x.id === employeeId));
    newPage('portrait'); employeePage(model, S, logos, model.employees[k], doc);
    return doc;
  }
  dayPages(model, S, logos, newPage, doc);
  model.employees.forEach((e) => { newPage('portrait'); employeePage(model, S, logos, e, doc); });
  reviewPages(model, S, logos, newPage, doc, sums);
  overtimePage(model, S, newPage, doc, sums);
  return doc;
}
