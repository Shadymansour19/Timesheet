// Printing the official report WITHOUT a PDF: a stand-in for the part of the jsPDF API that src/export/pdf.js draws with, which records every page as SVG
// (the same coordinates, in pt) instead of building PDF bytes. The result is plain HTML that the browser prints at once: no PDF to build and serialize, no PDF
// viewer to load in the print frame (the slow part), and the page layout code stays exactly the same (pdf.js is not touched).
// A real jsPDF object is still used for ONE thing: measuring text widths (same Helvetica / Times metrics as the PDF, so nothing wraps or shrinks differently).
const n2 = (v) => (Math.round(v * 100) / 100).toString();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const color = (c) => (c.length === 1 ? `rgb(${c[0]},${c[0]},${c[0]})` : `rgb(${c[0]},${c[1]},${c[2]})`);
const PW = 595.28, PH = 841.89;

export function makeSvgDoc(JsPDF) {
  return class SvgDoc {
    constructor() {
      this.m = new JsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });      // measuring only
      this.pages = []; this.images = new Map();
      this.fillC = [255, 255, 255]; this.drawC = [0]; this.textC = [0]; this.lw = 0.2; this.font = 'helvetica'; this.bold = false; this.size = 16;
      this.addPage('a4', 'portrait');
    }
    addPage(_format, orientation = 'portrait') { this.pages.push({ land: orientation === 'landscape', fills: new Map(), strokes: new Map(), texts: [], imgs: [] }); this.page = this.pages[this.pages.length - 1]; return this; }
    deletePage(k) { this.pages.splice(k - 1, 1); this.page = this.pages[this.pages.length - 1]; return this; }
    getNumberOfPages() { return this.pages.length; }
    setFont(name, style) { this.font = name; this.bold = /bold/i.test(style || ''); this.m.setFont(name, style); return this; }
    setFontSize(s) { this.size = s; this.m.setFontSize(s); return this; }
    getTextWidth(s) { return this.m.getTextWidth(s); }
    setTextColor(...c) { this.textC = c; return this; }
    setDrawColor(...c) { this.drawC = c; return this; }
    setFillColor(...c) { this.fillC = c; return this; }
    setLineWidth(w) { this.lw = w; return this; }
    viewerPreferences() { return this; }
    _path(map, key, d) { map.set(key, (map.get(key) ?? '') + d); }
    rect(x, y, w, h, style = 'S') {
      const d = `M${n2(x)} ${n2(y)}h${n2(w)}v${n2(h)}h${n2(-w)}z`;
      if (/F/i.test(style)) this._path(this.page.fills, color(this.fillC), d);
      if (/S|D/i.test(style) || style === '') this._path(this.page.strokes, `${this.lw}|${color(this.drawC)}`, d);
      return this;
    }
    line(x1, y1, x2, y2) { this._path(this.page.strokes, `${this.lw}|${color(this.drawC)}`, `M${n2(x1)} ${n2(y1)}L${n2(x2)} ${n2(y2)}`); return this; }
    addImage(data, _fmt, x, y, w, h, alias) { const id = alias || `img${this.images.size}`; if (!this.images.has(id)) this.images.set(id, data); this.page.imgs.push({ id, x, y, w, h }); return this; }
    // jsPDF's baseline 'middle' puts the alphabetic baseline at y + 0.35 * size (height / 2 - descent with the default line height 1.15)
    text(s, x, y, { align = 'left', baseline = 'alphabetic', angle = 0 } = {}) {
      const by = baseline === 'middle' ? y + this.size * 0.35 : y;
      this.page.texts.push({ s: String(s), x, y: by, size: this.size, bold: this.bold, times: this.font === 'times', c: this.textC, anchor: align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start', angle });
      return this;
    }
    // one orientation for the whole job? (browsers' print preview uses ONE sheet orientation for a document, so a job that mixes portrait and landscape pages
    // must go through the PDF, which carries the orientation of every page)
    isUniform() { return this.pages.every((p) => p.land === this.pages[0].land); }
    // layers: fills, logos, lines, text (the order the report is drawn in)
    toHtml(title = 'Report') {
      const uniform = this.isUniform(), land = !!this.pages[0]?.land;
      const defs = [...this.images].map(([id, data]) => `<image id="${esc(id)}" width="1" height="1" preserveAspectRatio="none" href="${esc(data)}"/>`).join('');
      const pageSvg = (p) => {
        const w = p.land ? PH : PW, h = p.land ? PW : PH;
        let s = `<div class="pg ${p.land ? 'l' : 'p'}"><svg viewBox="0 0 ${n2(w)} ${n2(h)}" xmlns="http://www.w3.org/2000/svg">`;
        for (const [c, d] of p.fills) s += `<path d="${d}" fill="${c}"/>`;
        for (const i of p.imgs) s += `<svg x="${n2(i.x)}" y="${n2(i.y)}" width="${n2(i.w)}" height="${n2(i.h)}" viewBox="0 0 1 1" preserveAspectRatio="none"><use href="#${esc(i.id)}"/></svg>`;
        for (const [k, d] of p.strokes) { const [lw, c] = k.split('|'); s += `<path d="${d}" fill="none" stroke="${c}" stroke-width="${lw}"/>`; }
        for (const t of p.texts) {
          s += `<text x="${n2(t.x)}" y="${n2(t.y)}" font-size="${n2(t.size)}"${t.bold ? ' font-weight="bold"' : ''}${t.times ? ' class="tm"' : ''} fill="${color(t.c)}"${t.anchor !== 'start' ? ` text-anchor="${t.anchor}"` : ''}${t.angle ? ` transform="rotate(${n2(-t.angle)} ${n2(t.x)} ${n2(t.y)})"` : ''}>${esc(t.s)}</text>`;
        }
        return s + '</svg></div>';
      };
      return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
${uniform
  // ONE orientation: an ordinary @page, and every sheet fills exactly the printable area of the page (100vw x 100vh in print), so whatever margins the person's
  // print dialog adds, a sheet never overflows onto an extra blank page; the drawing scales to fit
  ? `@page { size: A4 ${land ? 'landscape' : 'portrait'}; margin: 0 }
html, body { margin: 0; padding: 0; background: #fff }
.pg { overflow: hidden; break-after: page; page-break-after: always; display: block; width: 100vw; height: 100vh }`
  : `@page portrait { size: A4 portrait; margin: 0 } @page landscape { size: A4 landscape; margin: 0 }
html, body { margin: 0; padding: 0; background: #fff }
.pg { overflow: hidden; break-after: page; page-break-after: always; display: block }
.pg.p { page: portrait; width: 210mm; height: 297mm } .pg.l { page: landscape; width: 297mm; height: 210mm }`}
.pg:last-child { break-after: auto; page-break-after: auto }
.pg svg { display: block; width: 100%; height: 100% }
text { font-family: Helvetica, Arial, "Liberation Sans", sans-serif } text.tm { font-family: "Times New Roman", Times, "Liberation Serif", serif }
</style></head><body><svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${defs}</defs></svg>${this.pages.map(pageSvg).join('')}</body></html>`;
    }
  };
}
