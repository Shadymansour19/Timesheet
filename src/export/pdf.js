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
        cell(doc, xs[2], r, cw[2], RH, e.jobTitle, b); cell(doc, xs[3], r, cw[3], RH, e.levelText, b); cell(doc, xs[4], r, cw[4], RH, e.payroll, b);
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
// Drawn in the coordinates of the company's printed form (a 920 x 1300 grid) and scaled to the A4 page.
const K = PW / 920;
function employeePage(model, S, logos, e, doc) {
  const X = (v) => v * K, Y = (v) => v * K;
  const line = (x1, y1, x2, y2, w = 0.6) => { doc.setDrawColor(0); doc.setLineWidth(w); doc.line(X(x1), Y(y1), X(x2), Y(y2)); };
  const box = (x1, y1, x2, y2, w = 0.6) => { doc.setDrawColor(0); doc.setLineWidth(w); doc.rect(X(x1), Y(y1), X(x2 - x1), Y(y2 - y1), 'S'); };
  const put = (str, x1, y1, x2, y2, o = {}) => {                       // text inside a cell, centred (or left / right)
    const h = o.h ?? 'center', pad = 3;
    const x = h === 'left' ? X(x1) + pad : h === 'right' ? X(x2) - pad : X((x1 + x2) / 2);
    tx(doc, str, x, Y((y1 + y2) / 2) + 0.3, { size: o.size ?? 7.5, bold: o.bold ?? false, font: o.font ?? 'sans', align: h, maxW: X(x2 - x1) - pad * 2, underline: o.underline });
  };
  const rot = (str, x1, y1, x2, y2, size = 6.5) => {                  // vertical header text, centred both ways in its cell
    doc.setFont('times', 'bold'); doc.setFontSize(size); doc.setTextColor(0);
    const w = doc.getTextWidth(latin(str));
    doc.text(latin(str), X((x1 + x2) / 2) + size * 0.33, Y((y1 + y2) / 2) + w / 2, { angle: 90 });
  };
  const T = { font: 'times', bold: true };

  // top: the two logos (no frame), captions under them, form title
  logo(doc, logos, 'left', X(95), Y(88), X(200), Y(64));
  logo(doc, logos, 'right', X(722), Y(84), X(70), Y(70));
  tx(doc, S.captionLeft, X(92), Y(160), { size: 8, ...T });
  tx(doc, S.captionRight, X(757), Y(160), { size: 8, ...T, align: 'center' });   // centred under the right logo
  tx(doc, 'MONTHLY TIME REPORT', X(492), Y(180), { size: 8, ...T, align: 'center', underline: true });

  // data block
  const RH = 13.4, mon = monthText(model);
  const info = (y0, x1, xl, x2, label, value) => { box(x1, y0, x2, y0 + RH); line(xl, y0, xl, y0 + RH); put(label, x1, y0, xl, y0 + RH, { ...T, h: 'left' }); put(value, xl, y0, x2, y0 + RH, { size: 7.5 }); };
  box(481, 205, 872, 219); line(652, 205, 652, 219); put('Department code:', 481, 205, 652, 219, T); put(S.code, 652, 205, 872, 219, { size: 7.5 });
  [['Name:', e.fullName], ['Title:', e.jobTitle], ['Level:', e.levelText], ['Location:', e.workLocation]].forEach(([l, v], i) => info(220 + i * RH, 75, 155, 466, l, v));
  [['Month:', mon], ['Contr. No:', e.contractNo], ['Department:', S.printName], ['PAYROLL', e.payroll]].forEach(([l, v], i) => info(220 + i * RH, 481, 560, 872, l, v));

  // the two day tables
  const COLS = [32, 48, 20, 20, 20, 19, 19, 19, 49, 146];            // Day, Work, B, L, D, Accomd, Trans/IN, Trans/EX, O.V.T, Comment (px)
  const rowsN = Math.max(15, model.days.length - 15);
  const tbl = (x0, d0, count) => {
    const xs = COLS.reduce((a, w) => (a.push(a[a.length - 1] + w), a), [x0]), xe = xs[xs.length - 1];
    const top = 288, hdr = 68, rowH = 16, n = rowsN, bot = top + hdr + n * rowH + 2;
    box(x0, top, xe, bot);
    line(x0, top + hdr, xe, top + hdr);
    xs.slice(1, -1).forEach((x, i) => { if (i === 2 || i === 3) line(x, top + 34, x, bot); else line(x, top, x, bot); });   // B | L | D share the "Meal" header
    line(xs[2], top + 34, xs[5], top + 34);
    put('Day', xs[0], top, xs[1], top + hdr, T); put('Work', xs[1], top, xs[2], top + hdr, T);
    put('Meal', xs[2], top, xs[5], top + 34, T); ['B', 'L', 'D'].forEach((m, i) => put(m, xs[2 + i], top + 34, xs[3 + i], top + hdr, T));
    ['Accomd.', 'Trans/IN', 'Trans/EX'].forEach((m, i) => rot(m, xs[5 + i], top, xs[6 + i], top + hdr));
    put('O.V.T', xs[8], top + 18, xs[9], top + 38, { ...T, size: 7.5 }); put('Hrs', xs[8], top + 32, xs[9], top + 52, { ...T, size: 7.5 });
    put('Comment', xs[9], top, xs[10], top + hdr, T);
    for (let k = 1; k < n; k++) line(x0, top + hdr + 2 + k * rowH, xe, top + hdr + 2 + k * rowH, 0.4);   // all internal borders
    for (let k = 0; k < count; k++) {
      const d = d0 + k, c = e.cells[d - 1], y1 = top + hdr + 2 + k * rowH, y2 = y1 + rowH;
      put(String(d), xs[0], y1, xs[1], y2, { ...T, size: 7.5 }); put(c.status, xs[1], y1, xs[2], y2, { size: 7.5 });
      put('0', xs[5], y1, xs[6], y2, { size: 7.5 }); put(String(c.tin), xs[6], y1, xs[7], y2, { size: 7.5 }); put(String(c.tex), xs[7], y1, xs[8], y2, { size: 7.5 });
      put(String(c.ot), xs[8], y1, xs[9], y2, { size: 7.5 }); put(c.comment, xs[9], y1, xs[10], y2, { size: 7.5 });
    }
    return bot;
  };
  const nDays = model.days.length;
  tbl(75, 1, 15); tbl(481, 16, nDays - 15);

  // legend: three bordered blocks
  const leg = (x1, xc, x2, rows, head) => rows.forEach(([code, text], i) => {
    const y1 = 628 + i * 16; box(xc, y1, x2, y1 + 16); line(xc + (x2 - xc > 150 ? 23 : x1 === 380 ? 85 : 46), y1, xc + (x2 - xc > 150 ? 23 : x1 === 380 ? 85 : 46), y1 + 16);
    const cx = xc + (x2 - xc > 150 ? 23 : x1 === 380 ? 85 : 46);
    put(code, xc, y1, cx, y1 + 16, T); put(text, cx, y1, x2, y1 + 16, { size: 7.5 });
  });
  box(75, 628, 155, 660); put('Work Codes', 75, 628, 155, 660, { ...T, underline: true, size: 7.5 }); box(75, 660, 155, 676); put('Meal Codes', 75, 660, 155, 676, { ...T, underline: true, size: 7.5 });
  leg(75, 155, 320, [['X', 'Work Onshore'], ['C', 'Work at Cairo'], ['B', 'Breakfast']]);
  leg(380, 380, 582, [['Y', 'Day/Night Shift(1.2X)'], ['Q', 'Work At Abo Qir'], ['L', 'Lunch']]);
  leg(681, 681, 872, [['O', 'Work Offshore'], ['E', 'Vacation'], ['D', 'Dinner']]);

  // totals
  const t = e.cells.reduce((a, c) => { a[c.status] = (a[c.status] || 0) + 1; if (NORMAL.includes(c.status)) a.otN += c.ot; if (SHIFT.includes(c.status)) a.otS += c.ot; a.tin += c.tin; a.tex += c.tex; return a; }, { otN: 0, otS: 0, tin: 0, tex: 0 });
  const tot = (x1, xm, x2, y1, label, v, small) => { box(x1, y1, xm, y1 + 16); box(xm, y1, x2, y1 + 16); put(label, x1, y1, xm, y1 + 16, { h: 'right', size: small ? 6 : 7.5 }); put(String(v), xm, y1, x2, y1 + 16, { size: 7.5 }); };
  box(75, 690, 320, 706); put('Codes of Normal Daily Rates', 75, 690, 320, 706, { ...T, underline: true });
  tot(75, 210, 320, 706, 'Total (X) Days:', t.X || 0); tot(75, 210, 320, 722, 'Total (C) Days:', t.C || 0); tot(75, 210, 320, 738, 'Total (Q) Days:', t.Q || 0); tot(75, 210, 320, 754, 'Total Overtime Hours', t.otN, true);
  box(481, 690, 715, 706); put('Codes of 1.2X Daily Rates', 481, 690, 715, 706, { ...T, underline: true });
  tot(481, 600, 715, 706, 'Total (Y) Days:', t.Y || 0); tot(481, 600, 715, 722, 'Total (O) Days:', t.O || 0); tot(481, 600, 715, 738, 'Total Overtime Hours', t.otS, true);
  // meals / accommodation / transportation
  const my = 754;
  box(481, my, 668, my + 16); put('Total Meals', 481, my, 668, my + 16, { ...T, underline: true, size: 7 });
  box(668, my, 773, my + 16); put('Transportation', 668, my, 773, my + 16, { ...T, underline: true, size: 7 });
  box(481, my + 16, 600, my + 50); line(481, my + 32, 600, my + 32);
  [['B', 481, 521], ['L', 521, 561], ['D', 561, 600]].forEach(([m, a, b]) => { line(b, my + 16, b, my + 50); put(m, a, my + 16, b, my + 32, { ...T, size: 7 }); put('0', a, my + 32, b, my + 50, { size: 7 }); });
  box(600, my + 16, 668, my + 50); put('Accomd', 600, my + 16, 668, my + 32, { ...T, underline: true, size: 7 }); put('0', 600, my + 32, 668, my + 50, { size: 7 });
  box(668, my + 16, 773, my + 50); line(720, my + 16, 720, my + 50); line(668, my + 32, 773, my + 32);
  put('EX', 668, my + 16, 720, my + 32, { size: 7 }); put('IN', 720, my + 16, 773, my + 32, { size: 7 }); put(String(t.tex), 668, my + 32, 720, my + 50, { size: 7 }); put(String(t.tin), 720, my + 32, 773, my + 50, { size: 7 });

  // notes + signatures (more room to sign than on the form)
  box(75, 830, 872, 873); tx(doc, 'Notes (Penalty):-', X(78), Y(840), { size: 8, ...T });
  const dash = '------------------------------------';
  tx(doc, 'Signature Employee', X(77), Y(908), { size: 7.5, ...T }); tx(doc, dash, X(77), Y(956), { size: 7.5 });
  tx(doc, 'Approval of Supervisor', X(563), Y(908), { size: 7.5, ...T }); tx(doc, dash, X(563), Y(956), { size: 7.5 });
  tx(doc, 'Approval of Department GM', X(563), Y(1010), { size: 7.5, ...T }); tx(doc, dash, X(563), Y(1058), { size: 7.5 });
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
      const mid = M + W / 2; tx(doc, `${S.deptTitle} Monthly Attendance Sheet Review`, mid, y + 6, { size: 9, ...TIMES, align: 'center' }); tx(doc, S.manpower, mid, y + 18, { size: 9, ...TIMES, align: 'center' }); tx(doc, 'Closeout Calculation Sheet', mid, y + 30, { size: 9, ...TIMES, align: 'center' });
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
      cell(doc, xs[3], r, cw[3], RH, e.levelText, b); cell(doc, xs[4], r, cw[4], RH, e.payroll, b); cell(doc, xs[5], r, cw[5], RH, String(nx), b); cell(doc, xs[6], r, cw[6], RH, String(ny), b);
      cell(doc, xs[7], r, cw[7], RH, String(nx + ny), { ...b, fill: GREY }); cell(doc, xs[8], r, cw[8], RH, String(s.otN + s.otS), b);
      cell(doc, xs[9], r, cw[9], RH, String(s.tex), b); cell(doc, xs[10], r, cw[10], RH, String(s.tin), b); cell(doc, xs[11], r, cw[11], RH, '', b);
    }
    y += n * RH;
    if (i >= model.employees.length) {
      void tail;
      const days = (k) => sums[k].X + sums[k].C + sums[k].Q + sums[k].Y + sums[k].O;
      let eng = 0, tech = 0; model.employees.forEach((e, k) => { if (/engineer/i.test(e.position)) eng += days(k); if (/tech/i.test(e.position)) tech += days(k); });
      y += 12;
      const b9 = { ...TIMES, size: 8.5 };
      cell(doc, xs[1], y, cw[1] + cw[2], 18, 'Total Engineer Days', b9); cell(doc, xs[3], y, cw[3], 18, String(eng), { ...b9, fill: GREEN }); cell(doc, xs[4], y, xs[11] - xs[4], 18, 'Total Approved (Engineer)', b9); cell(doc, xs[11], y, cw[11], 18, model.approvedEngineer === null ? '' : String(model.approvedEngineer), b9);
      y += 26;
      cell(doc, xs[1], y, cw[1] + cw[2], 18, 'Total Technition Days', b9); cell(doc, xs[3], y, cw[3], 18, String(tech), { ...b9, fill: GREEN }); cell(doc, xs[4], y, xs[11] - xs[4], 18, 'Total Approved (Tech)', b9); cell(doc, xs[11], y, cw[11], 18, model.approvedTech === null ? '' : String(model.approvedTech), b9);
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
    [String(k + 1), e.fullName, e.payroll, String(s.otN + s.otS)].forEach((v, q) => cell(doc, xs[q], y, [50, 310, 150, 100][q], RH, v, { bold: true, size: 11, h: q === 1 ? 'left' : 'center' }));
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
