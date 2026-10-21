// Printable HTML of an ExcelJS workbook (used to PRINT the Excel version when the PDF could not be made; nothing is downloaded).
// Every sheet becomes an A4 page (portrait or landscape as the sheet says), shrunk to the page width. Logos are not included.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function textOf(c) {
  let v = c.value;
  if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) v = c.result;   // ExcelJS hides a cached 0 in value, keeps it in .result
  if (v && typeof v === 'object' && 'richText' in v) return v.richText.map((r) => r.text).join('');
  if (v instanceof Date) {
    const f = c.numFmt || '';
    return /mmm-yy/.test(f) && !/d/.test(f.replace(/mmm/, '')) ? `${MON[v.getUTCMonth()]}-${String(v.getUTCFullYear()).slice(2)}` : `${String(v.getUTCDate()).padStart(2, '0')}-${MON[v.getUTCMonth()]}${/yy/.test(f) ? '-' + String(v.getUTCFullYear()).slice(2) : ''}`;
  }
  if (v && typeof v === 'object') return v.text ?? '';
  return v === null || v === undefined ? '' : String(v);
}

function sheetHtml(ws) {
  const rows = ws.rowCount, cols = ws.columnCount;
  const merges = new Map(), skip = new Set();
  for (const m of ws.model.merges ?? []) {
    const [a, b] = m.split(':'), pa = ws.getCell(a), pb = ws.getCell(b);
    const r1 = Number(pa.row), c1 = Number(pa.col), r2 = Number(pb.row), c2 = Number(pb.col);
    merges.set(`${r1},${c1}`, { rs: r2 - r1 + 1, cs: c2 - c1 + 1 });
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) skip.add(`${r},${c}`);
  }
  const hidden = []; let width = 0;
  for (let c = 1; c <= cols; c++) { const col = ws.getColumn(c); hidden[c] = !!col.hidden; if (!hidden[c]) width += (col.width ?? 9) * 7 + 5; }
  const colgroup = [...Array(cols)].map((_, i) => (hidden[i + 1] ? '' : `<col style="width:${((ws.getColumn(i + 1).width ?? 9) * 7 + 5).toFixed(0)}px">`)).join('');
  const land = ws.pageSetup?.orientation === 'landscape';
  const pageW = land ? 1060 : 718, zoom = Math.min(1, pageW / Math.max(width, 1));
  let body = '';
  for (let r = 1; r <= rows; r++) {
    const row = ws.getRow(r);
    let tds = '';
    for (let c = 1; c <= cols; c++) {
      if (hidden[c] || skip.has(`${r},${c}`)) continue;
      const cell = row.getCell(c), mg = merges.get(`${r},${c}`);
      const f = cell.font ?? {}, al = cell.alignment ?? {}, bd = cell.border ?? {};
      const fill = cell.fill?.fgColor?.argb;
      const st = [
        f.bold ? 'font-weight:700' : '', f.italic ? 'font-style:italic' : '', f.size ? `font-size:${(f.size * 1.333).toFixed(1)}px` : '',
        f.color?.argb ? `color:#${f.color.argb.slice(-6)}` : '', fill ? `background:#${fill.slice(-6)}` : '',
        `text-align:${al.horizontal === 'left' ? 'left' : al.horizontal === 'right' ? 'right' : 'center'}`,
        al.vertical === 'top' ? 'vertical-align:top' : al.vertical === 'bottom' ? 'vertical-align:bottom' : 'vertical-align:middle',
        f.underline ? 'text-decoration:underline' : '', al.textRotation === 90 || al.textRotation === 'vertical' ? 'writing-mode:vertical-rl;transform:rotate(180deg)' : '',
        bd.top || bd.left || bd.bottom || bd.right ? 'border:1px solid #000' : '',
      ].filter(Boolean).join(';');
      tds += `<td${mg && mg.rs > 1 ? ` rowspan="${mg.rs}"` : ''}${mg && mg.cs > 1 ? ` colspan="${mg.cs}"` : ''} style="${st}">${esc(textOf(cell))}</td>`;
    }
    body += `<tr style="height:${row.height ? (row.height * 1.333).toFixed(0) : 17}px">${tds}</tr>`;
  }
  return `<section class="${land ? 'land' : 'port'}"><div style="zoom:${zoom.toFixed(3)}"><table><colgroup>${colgroup}</colgroup>${body}</table></div></section>`;
}

export function workbookToPrintHtml(wb) {
  const sheets = wb.worksheets.map(sheetHtml).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Print</title><style>
@page { size: A4 portrait; margin: 8mm; } @page land { size: A4 landscape; margin: 8mm; }
* { box-sizing: border-box; } body { margin: 0; font-family: "Times New Roman", serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
section { page-break-after: always; break-after: page; } section:last-child { page-break-after: auto; break-after: auto; } section.land { page: land; }
table { border-collapse: collapse; table-layout: fixed; } td { padding: 0 2px; overflow: hidden; font-size: 12px; line-height: 1.15; word-break: break-word; }
</style></head><body>${sheets}</body></html>`;
}
