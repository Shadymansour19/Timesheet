// Local OCR of scanned overtime forms (PDF pages or photos): everything runs in the browser - pdf.js draws the pages, Tesseract.js
// (WASM, English model hosted in /ocr/lang) reads them; nothing is uploaded. Pages may be scanned in any rotation: 4 quick low-resolution
// passes pick the orientation that yields readable Latin words, then the page is read at full resolution.
import { parsePage } from './parse.js';

let workerP = null;
async function getWorker() {
  workerP ??= (async () => {
    const [{ createWorker, PSM }, workerUrl, coreUrl] = await Promise.all([
      import('tesseract.js'),
      import('tesseract.js/dist/worker.min.js?url').then((m) => m.default),
      import('tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url').then((m) => m.default),
    ]);
    const w = await createWorker('eng', 1, { workerPath: workerUrl, corePath: coreUrl, langPath: '/ocr/lang', gzip: true, workerBlobURL: false });
    await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
    return w;
  })();
  return workerP;
}
export async function disposeOcr() { const w = await workerP; workerP = null; await w?.terminate(); }

// rotate (and optionally shrink) with exact integer transforms (no half-pixel blur). The OCR reads the page as it is: grey-scaling / thresholding
// made it LOSE small text on these scans. Resolution matters more: ~150 dpi worked best, ~200 dpi is the second try (see scanFile).
const rotated = (src, deg, maxSide = 0) => {
  const k = maxSide && Math.max(src.width, src.height) > maxSide ? maxSide / Math.max(src.width, src.height) : 1;
  const w = Math.round(src.width * k), h = Math.round(src.height * k), turn = deg % 180 !== 0;
  const c = document.createElement('canvas'); c.width = turn ? h : w; c.height = turn ? w : h;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  if (deg === 90) { g.translate(c.width, 0); g.rotate(Math.PI / 2); } else if (deg === 270) { g.translate(0, c.height); g.rotate(-Math.PI / 2); } else if (deg === 180) { g.translate(c.width, c.height); g.rotate(Math.PI); }
  g.drawImage(src, 0, 0, w, h);
  return c;
};
const wordsOf = (data) => data.blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words))).map((x) => ({ text: x.text, conf: x.confidence, x0: x.bbox.x0, y0: x.bbox.y0, x1: x.bbox.x1, y1: x.bbox.y1 }));

// the page canvas -> { words, rotation, canvas (upright) }
export async function readPage(canvas, scale = 1) {
  const w = await getWorker();
  let best = { rot: 0, score: -1 };
  for (const rot of [0, 270, 90, 180]) {
    const r = await w.recognize(rotated(canvas, rot, 1100), {}, { blocks: true });
    const score = wordsOf(r.data).filter((x) => x.conf >= 70 && /^[A-Za-z0-9:\-\/.]{2,}$/.test(x.text)).length;
    if (score > best.score) best = { rot, score };
    if (score >= 4) break;                                                   // clearly upright: no need to try the rest
  }
  const upright = rotated(canvas, best.rot);
  const reading = scale === 1 ? upright : rotated(canvas, best.rot, Math.round(Math.max(canvas.width, canvas.height) * scale));
  const r = await w.recognize(reading, {}, { blocks: true });
  return { words: wordsOf(r.data), rotation: best.rot, canvas: upright, k: reading.width / upright.width };
}

// The hours cell is a lone digit between table lines and is easily missed by the page-wide read. For a row without hours, read ONLY the strip of
// the row beyond the work text (away from the payroll code) as a single line of digits, enlarged.
export async function hoursFromStrip(canvas, k, geo, debug = null) {
  if (!geo.side || geo.noteX0 === null) return null;
  const w = await getWorker(), pad = (geo.y1 - geo.y0) * 0.6;
  const x0 = geo.side < 0 ? 0 : geo.noteX1 + 6, x1 = geo.side < 0 ? geo.noteX0 - 6 : canvas.width * k;
  const sx = Math.max(0, x0 / k), sw = Math.max(1, (x1 - x0) / k), sy = Math.max(0, (geo.y0 - pad) / k), sh = ((geo.y1 - geo.y0) + 2 * pad) / k;
  if (sw < 8) return null;
  const z = 2; let c = document.createElement('canvas'); c.width = Math.round(sw * z) + 40; c.height = Math.round(sh * z) + 40;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(canvas, sx, sy, sw, sh, 20, 20, Math.round(sw * z), Math.round(sh * z));
  // black / white, and the table's vertical lines (dark over most of the strip height) are erased so "|3|" does not read as "1" / "2"
  { const im = g.getImageData(0, 0, c.width, c.height), d = im.data, W = c.width, H = c.height, dark = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) dark[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000 < 150 ? 1 : 0;
    for (let x = 0; x < W; x++) { let n = 0; for (let y = 0; y < H; y++) n += dark[y * W + x]; if (n > H * 0.55) for (let xx = Math.max(0, x - 3); xx <= Math.min(W - 1, x + 3); xx++) for (let y = 0; y < H; y++) dark[y * W + xx] = 0; }
    // long horizontal lines (the table's borders above / below the digit) are erased too: they made the single-line reader miss digits such as 2 and 5
    for (let y = 0; y < H; y++) { let x = 0; while (x < W) { if (!dark[y * W + x]) { x++; continue; } let e = x; while (e < W && dark[y * W + e]) e++; if (e - x > 100) for (let yy = Math.max(0, y - 3); yy <= Math.min(H - 1, y + 3); yy++) for (let xx = x; xx < e; xx++) dark[yy * W + xx] = 0; x = e; } }
    for (let i = 0; i < W * H; i++) { const v = dark[i] ? 0 : 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    g.putImageData(im, 0, 0);
    // only the ink matters: crop to it (a lone digit in a wide empty strip was often not read at all)
    let x0 = W, x1 = -1, y0 = H, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dark[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 >= 0) { const pad = 30, w2 = x1 - x0 + 1, h2 = y1 - y0 + 1, c2 = document.createElement('canvas'); c2.width = w2 + 2 * pad; c2.height = h2 + 2 * pad;
      const g2 = c2.getContext('2d'); g2.fillStyle = '#fff'; g2.fillRect(0, 0, c2.width, c2.height); g2.drawImage(c, x0, y0, w2, h2, pad, pad, w2, h2); c = c2; } }
  if (debug) debug.url = c.toDataURL();
  const { PSM } = await import('tesseract.js');
  await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789.' });
  const r = await w.recognize(c);
  let m = /\d{1,2}(\.\d)?/.exec(r.data.text.replace(/\s+/g, ''));
  if (!m) {                                                    // the digit-only model sometimes returns nothing (a clean 5 read as S): once more as a single word (this build reads a lone 5 only that way), letters that look like digits mapped
    await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_WORD, tessedit_char_whitelist: '' });
    const r2 = await w.recognize(c);
    m = /\d{1,2}/.exec(r2.data.text.replace(/\s+/g, '').replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2'));
  }
  await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '' });
  return m ? Number(m[0]) : null;
}

// The company form (see src/export/overtime-form.js): hours | work (one merged cell for people with the same note) | payroll | name | no.
// The payroll rows are found from the text; whether TWO neighbouring rows share one work cell is read from the table's horizontal lines in the image:
// next to the payroll code (the name column) every row has a line under it, in the work column (left of the code) a merged cell has none.
// geo: the payroll codes top to bottom (reading-scale pixels, k = reading scale / upright canvas scale) -> { links, bounds } (see parsePage)
export function tableSeparators(canvas, k, geo) {
  const links = [], bounds = [], g = canvas.getContext('2d', { willReadFrequently: true });
  // y of a horizontal line (dark over >= 80% of the band, 3 px thick at most) between ya and yb, else null
  const lineIn = (x0, x1, ya, yb) => {
    x0 = Math.round(Math.max(0, x0)); x1 = Math.round(Math.min(canvas.width, x1)); ya = Math.round(Math.max(0, ya)); yb = Math.round(Math.min(canvas.height, yb));
    const W = x1 - x0, H = yb - ya; if (W < 20 || H < 4) return null;
    const d = g.getImageData(x0, ya, W, H).data;
    const dark = (x, y) => (d[(y * W + x) * 4] * 299 + d[(y * W + x) * 4 + 1] * 587 + d[(y * W + x) * 4 + 2] * 114) / 1000 < 150;
    let best = null;
    for (let y = 0; y + 3 <= H; y++) { let n = 0; for (let x = 0; x < W; x++) if (dark(x, y) || dark(x, y + 1) || dark(x, y + 2)) n++; if (n >= W * 0.8 && (!best || n > best.n)) best = { n, y: y + 1 }; }
    return best ? ya + best.y : null;
  };
  for (let i = 0; i < geo.length - 1; i++) {
    const a = geo[i], b = geo[i + 1], wa = ((a.x1 - a.x0) + (b.x1 - b.x0)) / 2 / k, cx = (a.cx + b.cx) / 2 / k;
    const ya = a.cy / k + (a.h / k) * 0.55, yb = b.cy / k - (b.h / k) * 0.55;
    const yc = lineIn(cx + 1.2 * wa, cx + 3.8 * wa, ya, yb);                     // the name column: a line under every row
    if (yc === null) { links.push(false); bounds.push(null); continue; }          // not found: nothing is assumed
    bounds.push(yc * k);
    links.push(lineIn(cx - 3.8 * wa, cx - 1.2 * wa, yc - 4, yc + 5) === null);   // none in the work column: one merged cell
  }
  return { links, bounds };
}

// file (pdf or image) -> page canvases (~200 dpi for A4)
export async function pagesOf(file, onPage) {
  if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i), vp = page.getViewport({ scale: 200 / 72 });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      out.push({ canvas: c, page: i, pages: pdf.numPages });
      onPage?.(i, pdf.numPages);
    }
    return out;
  }
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 3000 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return [{ canvas: c, page: 1, pages: 1 }];
}

// one file -> [{ file, page, pages, date, rows, skipped, rotation, thumb }]
export async function scanFile(file, people, onStatus) {
  const pages = await pagesOf(file);
  const res = [];
  for (const pg of pages) {
    onStatus?.({ file: file.name, page: pg.page, pages: pg.pages });
    // first at ~150 dpi (best for these forms); when no payroll code shows up, once more at the full ~200 dpi
    let { words, rotation, canvas, k } = await readPage(pg.canvas, 0.75);
    if (!parsePage(words, people).anchors.length) ({ words, rotation, canvas, k } = await readPage(pg.canvas, 1));
    let parsed = parsePage(words, people, { noteSide: -1 });
    try { const sep = tableSeparators(canvas, k, parsed.anchorsGeo); if (sep.links.some(Boolean) || sep.bounds.some((x) => x !== null)) parsed = parsePage(words, people, { noteSide: -1, ...sep }); } catch (e) { console.warn('table lines not read', e); }
    for (const r of parsed.rows) if (r.hours === null && r.geo) {                      // hours not read by the page-wide pass: read that cell on its own
      const hrs = await hoursFromStrip(canvas, k, r.geo);
      if (hrs !== null) { r.hours = hrs; r.warn = r.warn.filter((x) => x !== 'hours_missing'); if (!Number.isInteger(hrs)) r.warn.push('hours_fraction'); if (hrs > 24) r.warn.push('hours_range'); }
    }
    const tk = 520 / canvas.width, t = document.createElement('canvas'); t.width = 520; t.height = Math.round(canvas.height * tk);
    t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
    res.push({ file: file.name, page: pg.page, pages: pg.pages, rotation, thumb: t.toDataURL('image/jpeg', 0.7), ...parsed });
  }
  return res;
}
