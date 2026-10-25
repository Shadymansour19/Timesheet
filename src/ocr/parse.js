// Overtime forms: turn the OCR words of ONE upright page into rows. Nothing depends on fixed positions: every row is found from its
// payroll code "EMC-<number>", and the date from a date-looking text anywhere on the page.
//   words: [{ text, conf, x0, y0, x1, y1 }]   people: [{ id, full_name, payroll }] (the admin's department)
// -> { date, rows: [{ payroll, personId, name, hours, note, warn: [] }], skipped: [payroll codes without a person here] }
// The Arabic name on the form is never used or shown: the person (and the English name) come from the payroll number.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y, m, d) => (y >= 2000 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);

// "23-Oct-2026", "23/10/2026", "2026-10-23" (first one found, reading order)
export function findDate(text) {
  let m = /\b(\d{1,2})\s*[-\/. ]\s*([A-Za-z]{3,9})\s*[-\/. ]\s*(\d{4})\b/.exec(text);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) { const d = iso(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]); if (d) return d; }
  m = /\b(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/.exec(text);
  if (m) { const d = iso(+m[1], +m[2], +m[3]); if (d) return d; }
  m = /\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})\b/.exec(text);
  if (m) { const d = iso(+m[3], +m[2], +m[1]); if (d) return d; }
  return null;
}

// payroll key: letters + the number without leading zeros ("EMC-062" -> "EMC62"); null when it does not look like a code
export const payrollKey = (s) => { const m = /^([A-Za-z]+)[\s\-–—_.:]*0*(\d+)$/.exec(String(s ?? '').trim()); return m ? `${m[1].toUpperCase()}${Number(m[2])}` : null; };

// OCR slips inside the digit part: O->0, I/l->1, S->5, B->8 (only used after the letters "EMC")
const fixDigits = (s) => s.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
const ANCHOR = /^E[MN]C[-–—_.:‑]*([0-9OoIl|SB]{1,6})$/;
const ANCHOR_PREFIX = /^E[MN]C[-–—_.:‑]*$/;

export function parsePage(words, people = []) {
  const ws = words.map((w) => ({ ...w, text: String(w.text).trim(), cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2, h: Math.max(1, w.y1 - w.y0) })).filter((w) => w.text);
  // 1. anchors "EMC-062" (also "EMC-" + "062" as two neighbouring words)
  const anchors = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    let m = ANCHOR.exec(w.text);
    if (m) { anchors.push({ w, code: `EMC-${fixDigits(m[1])}`, parts: [w] }); continue; }
    if (ANCHOR_PREFIX.test(w.text)) {
      const nxt = ws.filter((x) => x !== w && Math.abs(x.cy - w.cy) < w.h * 0.7 && x.x0 >= w.x1 - 2 && x.x0 - w.x1 < w.h * 2 && /^[0-9OoIl|SB]{1,6}$/.test(x.text)).sort((a, b) => a.x0 - b.x0)[0];
      if (nxt) anchors.push({ w: { ...w, x1: nxt.x1, cx: (w.x0 + nxt.x1) / 2 }, code: `EMC-${fixDigits(nxt.text)}`, parts: [w, nxt] });
    }
  }
  // 2. the date: first date-looking text in reading order (top to bottom, left to right)
  const reading = [...ws].sort((a, b) => (Math.abs(a.cy - b.cy) < Math.min(a.h, b.h) * 0.6 ? a.x0 - b.x0 : a.cy - b.cy));
  const date = findDate(reading.map((w) => w.text).join(' '));
  // 3. rows
  const byKey = new Map();
  for (const p of people) { const k = payrollKey(p.payroll); if (k && !byKey.has(k)) byKey.set(k, p); }
  const rows = [], skipped = [];
  for (const a of anchors) {
    const k = payrollKey(a.code), person = k ? byKey.get(k) : null;
    if (!person) { skipped.push(a.code); continue; }
    const row = ws.filter((w) => !a.parts.includes(w) && Math.abs(w.cy - a.w.cy) <= a.w.h * 0.8);
    // the work text = confident Latin words of the row, in reading order; the hours = a small number on the same side of the code as that text
    const latin = row.filter((w) => w.conf >= 70 && /[A-Za-z]{2,}/.test(w.text) && !/^\d+$/.test(w.text)).sort((x, y) => x.x0 - y.x0);
    const note = latin.map((w) => w.text.replace(/^[^\w(]+|[^\w).]+$/g, '')).filter(Boolean).join(' ');
    const side = latin.length ? Math.sign(latin.reduce((s, w) => s + w.cx, 0) / latin.length - a.w.cx) : 0;
    const nums = row.filter((w) => /^\d{1,2}([.,]\d)?$/.test(w.text) && w.conf >= 50);
    let hoursTok = null;
    if (nums.length === 1) hoursTok = nums[0];
    else if (nums.length > 1) hoursTok = (side ? nums.filter((n) => Math.sign(n.cx - a.w.cx) === side) : nums).sort((x, y) => Math.abs(y.cx - a.w.cx) - Math.abs(x.cx - a.w.cx))[0] ?? nums[0];   // the one beyond the work text (not the serial number on the other side)
    const warn = [];
    let hours = null;
    if (hoursTok) {
      hours = Number(hoursTok.text.replace(',', '.'));
      if (!Number.isInteger(hours)) warn.push('hours_fraction');
      if (hours < 0 || hours > 24) warn.push('hours_range');
      if (nums.length > 1) warn.push('hours_check');
    } else warn.push('hours_missing');
    if (!note) warn.push('note_missing');
    rows.push({ payroll: person.payroll, personId: person.id, name: person.full_name, hours, note, warn, geo: { y0: a.w.y0, y1: a.w.y1, side, noteX0: latin.length ? Math.min(...latin.map((w) => w.x0)) : null, noteX1: latin.length ? Math.max(...latin.map((w) => w.x1)) : null, ax0: a.w.x0, ax1: a.w.x1 }, raw: row.sort((x, y) => x.x0 - y.x0).map((w) => `${w.text}:${Math.round(w.conf)}`).join(' ') });
  }
  // the same person twice on one page: say so
  const seen = new Map();
  rows.forEach((r) => { seen.set(r.personId, (seen.get(r.personId) ?? 0) + 1); });
  rows.forEach((r) => { if (seen.get(r.personId) > 1) r.warn.push('duplicate'); });
  return { date, rows, skipped, anchors: anchors.map((a) => a.code) };
}
