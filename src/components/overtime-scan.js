// Overtime forms -> preview -> save. The admin picks scanned forms (PDF / photos, several files or a whole folder); each page is read
// LOCALLY (src/ocr), rows are found from the payroll code "EMC-<number>", the person and the English name come from the admin's own
// department (rows whose payroll is not in it are skipped; the Arabic text on the form is never shown). Everything in the table can be
// edited; "Save overtime" writes one atomic bulk save per date (existing entries of that person / day are replaced and flagged).
import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { openDialog } from './dialog.js';
import { setOvertimeBulk } from '../api/admin.js';
import { fetchRangeData } from '../api/timesheet.js';
import { toast } from './toast.js';

const WARN = { hours_missing: 'scan_warn_hours_missing', hours_range: 'scan_warn_hours_range', hours_fraction: 'scan_warn_hours_fraction', hours_check: 'scan_warn_hours_check', note_missing: 'scan_warn_note_missing', duplicate: 'scan_warn_duplicate' };
const IMAGE = /\.(png|jpe?g|webp|bmp|tiff?)$/i, PDF = /\.pdf$/i;
export const isScan = (f) => PDF.test(f.name) || IMAGE.test(f.name) || /^image\//.test(f.type) || f.type === 'application/pdf';

// page result -> a card with a date field and an editable table; returns { el, state(), refresh() }
// existing(personId, date) -> { hours, note } | null  (what is already saved: shown as "replaces N h")
export function pageCard(res, { existing = () => null, onRemove = () => {} } = {}) {
  const date = h('input', { type: 'date', value: res.date ?? '', 'aria-label': t('scan_date') });
  const rows = res.rows.map((r) => {
    const inc = h('input', { type: 'checkbox', checked: !r.warn.includes('hours_missing'), 'aria-label': t('scan_include') });
    const hours = h('input', { type: 'number', min: 0, max: 24, step: 1, class: 'ot-hours', value: r.hours ?? '', 'aria-label': t('scan_hours') });
    const note = h('input', { type: 'text', maxlength: 200, class: 'ot-note', value: r.note, 'aria-label': t('scan_note') });
    note.title = r.note; note.addEventListener('input', () => { note.title = note.value; });      // the whole text on hover, when it is longer than the box
    const ex = h('span', { class: 'warn-chip exist' });
    const tr = h('tr', { 'data-p': r.payroll, ...(r.group ? { class: 'merged', 'data-g': r.group } : {}) },
      h('td', {}, inc), h('td', { class: 'mono' }, r.payroll), h('td', {}, r.name), h('td', {}, hours), h('td', { class: 'scan-note' }, note),
      h('td', { class: 'scan-warn' }, r.group ? h('span', { class: 'warn-chip shared', title: t('scan_shared_hint') }, t('scan_shared')) : null, r.warn.map((w) => h('span', { class: 'warn-chip' }, t(WARN[w]))), ex));
    return { r, tr, inc, hours, note, ex };
  });
  // people who share ONE work cell on the form share one note: editing it in one row changes it in the others (the hours stay per person)
  for (const x of rows) if (x.r.group) x.note.addEventListener('input', () => { for (const y of rows) if (y !== x && y.r.group === x.r.group) y.note.value = x.note.value; });
  const refresh = () => rows.forEach((x) => { const e = date.value ? existing(x.r.personId, date.value) : null; x.ex.textContent = e ? t('scan_exist').replace('{h}', e.hours) : ''; x.ex.hidden = !e; x.ex.title = e?.note ?? ''; });
  date.addEventListener('change', refresh); refresh();
  const el = h('section', { class: 'scan-page card' },
    h('div', { class: 'scan-head' },
      h('div', {}, h('strong', {}, `${res.file}${res.pages > 1 ? ` \u00b7 ${res.page}/${res.pages}` : ''}`), h('div', { class: 'muted' }, res.date ? '' : t('scan_no_date'))),
      h('div', { class: 'scan-head-tools' }, h('label', { class: 'scan-date' }, t('scan_date'), date),
        h('button', { type: 'button', class: 'btn small', onclick: () => { el.remove(); onRemove(); } }, t('scan_remove')))),
    h('div', { class: 'scan-body' },
      h('img', { class: 'scan-thumb', src: res.thumb, alt: `${res.file} ${res.page}` }),
      h('div', { class: 'scan-rows' },
        rows.length
          ? h('table', { class: 'utable scan-table' },
            h('thead', {}, h('tr', {}, ['', t('payroll_short'), t('full_name'), t('scan_hours'), t('scan_note'), ''].map((x) => h('th', { scope: 'col' }, x)))),
            h('tbody', {}, rows.map((x) => x.tr)))
          : h('p', { class: 'muted' }, res.anchors.length ? t('scan_none_here') : t('scan_none')),
        res.skipped.length ? h('p', { class: 'muted scan-skipped' }, `${t('scan_skipped')}: ${res.skipped.join(', ')}`) : null)));
  return {
    el, refresh,
    state: () => ({ file: res.file, page: res.page, date: date.value || null,
      rows: rows.map((x) => ({ personId: x.r.personId, payroll: x.r.payroll, name: x.r.name, include: x.inc.checked, hours: x.hours.value === '' ? null : Number(x.hours.value), note: x.note.value.trim() })) }),
  };
}

// every ticked row -> { byDate: Map(date -> [{ user, hours, note }]), problems: [text] }   (pure: tested)
export function collect(states) {
  const byDate = new Map(), problems = [], seen = new Set();
  for (const s of states) for (const r of s.rows) {
    if (!r.include) continue;
    const who = `${r.name} (${r.payroll})`;
    if (!s.date) { problems.push(`${who}: ${t('scan_err_date')} - ${s.file} ${s.page}`); continue; }
    if (!Number.isInteger(r.hours) || r.hours < 1 || r.hours > 24) { problems.push(`${who}, ${s.date}: ${t('scan_err_hours')}`); continue; }
    const k = `${r.personId}|${s.date}`;
    if (seen.has(k)) { problems.push(`${who}, ${s.date}: ${t('scan_err_dup')}`); continue; }
    seen.add(k);
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push({ user: r.personId, hours: r.hours, note: r.note });
  }
  return { byDate, problems };
}

export function openOvertimeScan({ people, onSaved }) {
  const files = h('input', { type: 'file', accept: '.pdf,application/pdf,image/*', multiple: true, id: 'scan-files' });
  const folder = h('input', { type: 'file', multiple: true, id: 'scan-folder', webkitdirectory: '' });       // a whole folder: every PDF / image inside
  const status = h('p', { class: 'muted', 'aria-live': 'polite' });
  const out = h('div', { class: 'scan-results' });
  const cards = [];
  let busy = false, existingMap = new Map();
  const existing = (pid, d) => existingMap.get(`${pid}|${d}`) ?? null;
  const total = () => cards.reduce((a, c) => a + c.state().rows.length, 0);

  async function run(list) {
    const picked = [...list].filter(isScan).sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));
    if (busy) return;
    if (!picked.length) { status.textContent = t('scan_nothing'); return; }
    busy = true; out.replaceChildren(); cards.length = 0; save.disabled = true;
    try {
      const { scanFile } = await import('../ocr/engine.js');
      const results = [];
      for (let i = 0; i < picked.length; i++) {
        try {
          const pages = await scanFile(picked[i], people, (s) => { status.textContent = t('scan_working').replace('{file}', s.file).replace('{p}', s.page).replace('{n}', s.pages).replace('{i}', i + 1).replace('{f}', picked.length); });
          results.push(...pages);
        } catch (e) { console.error(e); results.push({ file: picked[i].name, page: 1, pages: 1, rotation: 0, thumb: '', date: null, rows: [], skipped: [], anchors: [], failed: true }); }
      }
      // what is already saved on those dates (so a replacement is visible before saving)
      const dates = results.map((r) => r.date).filter(Boolean).sort();
      if (dates.length) { try { const d = await fetchRangeData(dates[0], dates[dates.length - 1]); existingMap = new Map([...d.overtime].map(([k, v]) => [k, v])); } catch { /* shown without the hint */ } }
      for (const res of results) {
        const c = pageCard(res, { existing, onRemove: () => { cards.splice(cards.indexOf(c), 1); save.disabled = !cards.length; } });
        cards.push(c); out.append(c.el);
      }
      status.textContent = `${total()} ${t('scan_rows_found')} \u00b7 ${picked.length} ${t('scan_files')}`;
      save.disabled = !cards.length;
    } catch (e) { console.error(e); status.textContent = t('scan_failed'); }
    busy = false;
  }
  // drag and drop: files and whole folders (entries are read recursively; no browser warning)
  const readAll = (dir) => new Promise((res) => { const rd = dir.createReader(), all = []; const next = () => rd.readEntries((b) => (b.length ? (all.push(...b), next()) : res(all)), () => res(all)); next(); });
  const fileOf = (en) => new Promise((res) => en.file(res, () => res(null)));
  async function walk(en, acc) {
    if (en.isFile) { const f = await fileOf(en); if (f) acc.push(f); }
    else if (en.isDirectory) for (const c of await readAll(en)) await walk(c, acc);
  }
  const drop = h('div', { class: 'scan-drop', tabindex: '-1' }, t('scan_drop'));
  const over = (on) => (e) => { e.preventDefault(); drop.classList.toggle('over', on); };
  drop.addEventListener('dragover', over(true)); drop.addEventListener('dragleave', over(false));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const entries = [...(e.dataTransfer.items ?? [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);   // must be taken before any await
    if (!entries.length) { run(e.dataTransfer.files); return; }
    const acc = []; for (const en of entries) await walk(en, acc);
    run(acc);
  });
  files.addEventListener('change', () => run(files.files));
  folder.addEventListener('change', () => run(folder.files));

  const content = h('div', { class: 'form' }, h('p', { class: 'muted' }, t('scan_hint')),
    h('div', { class: 'scan-pickers' },
      h('div', { class: 'field' }, h('label', { for: 'scan-files' }, t('scan_pick')), files),
      h('div', { class: 'field' }, h('label', { for: 'scan-folder' }, t('scan_pick_folder')), folder)), drop, status, out);
  const dlg = openDialog({ title: t('scan_title'), wide: 'xxl', autofocus: false, content,
    buttons: [{ label: t('close') }, { label: t('scan_confirm'), kind: 'primary', onClick: async () => {
      const { byDate, problems } = collect(cards.map((c) => c.state()));
      if (problems.length) throw Object.assign(new Error(problems.slice(0, 6).join(' \u00b7 ') + (problems.length > 6 ? ` \u00b7 +${problems.length - 6}` : '')), { code: '22023' });
      if (!byDate.size) throw Object.assign(new Error(t('scan_nothing_to_save')), { code: '22023' });
      let n = 0;
      for (const [day, rows] of [...byDate].sort()) { await setOvertimeBulk(day, rows); n += rows.length; }     // one atomic save per date
      toast(t('scan_saved').replace('{n}', n), 'success');
      onSaved?.();
    } }] });
  const save = dlg.querySelector('.dlg-actions button.primary'); save.disabled = true;
  return { cards, dlg };
}
