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
async function hoursFromStrip(canvas, k, geo) {
  if (!geo.side || geo.noteX0 === null) return null;
  const w = await getWorker(), pad = (geo.y1 - geo.y0) * 0.6;
  const x0 = geo.side < 0 ? 0 : geo.noteX1 + 6, x1 = geo.side < 0 ? geo.noteX0 - 6 : canvas.width * k;
  const sx = Math.max(0, x0 / k), sw = Math.max(1, (x1 - x0) / k), sy = Math.max(0, (geo.y0 - pad) / k), sh = ((geo.y1 - geo.y0) + 2 * pad) / k;
  if (sw < 8) return null;
  const z = 2, c = document.createElement('canvas'); c.width = Math.round(sw * z) + 40; c.height = Math.round(sh * z) + 40;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(canvas, sx, sy, sw, sh, 20, 20, Math.round(sw * z), Math.round(sh * z));
  // black / white, and the table's vertical lines (dark over most of the strip height) are erased so "|3|" does not read as "1" / "2"
  { const im = g.getImageData(0, 0, c.width, c.height), d = im.data, W = c.width, H = c.height, dark = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) dark[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000 < 150 ? 1 : 0;
    for (let x = 0; x < W; x++) { let n = 0; for (let y = 0; y < H; y++) n += dark[y * W + x]; if (n > H * 0.55) for (let xx = Math.max(0, x - 3); xx <= Math.min(W - 1, x + 3); xx++) for (let y = 0; y < H; y++) dark[y * W + xx] = 0; }
    for (let i = 0; i < W * H; i++) { const v = dark[i] ? 0 : 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    g.putImageData(im, 0, 0); }
  const { PSM } = await import('tesseract.js');
  await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789.' });
  const r = await w.recognize(c);
  await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '' });
  const m = /\d{1,2}(\.\d)?/.exec(r.data.text.replace(/\s+/g, ''));
  return m ? Number(m[0]) : null;
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
    const parsed = parsePage(words, people);
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
