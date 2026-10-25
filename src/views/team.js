import { h } from '../dom.js';
import { t, getLang } from '../i18n/index.js';
import { state, myDept } from '../auth/session.js';
import { cursor, shiftMonth, goToday, ymd, daysIn, fetchRangeData, fetchPaddedMonthData, effective, setDepartureMove } from '../api/timesheet.js';
import { WEEK_START, sameData, nextStatus } from '../lib/core.js';
import { enableDragFill } from '../lib/dragfill.js';
import { departureOf } from '../export/model.js';
import * as live from '../live.js';
import { fetchDeptPeople, fetchDepartment, setStatus, setStatusRows, setHoliday } from '../api/admin.js';
import { explain } from '../api/errors.js';
import { openDialog } from '../components/dialog.js';
import { field } from '../components/form.js';
import { openDayEditor } from '../components/day-editor.js';
import { choice } from '../components/choice.js';
import { openReportSettings } from '../components/report-settings.js';
import { toast } from '../components/toast.js';
import { monthHead } from '../components/month-head.js';
import { icon, SEARCH, INFO, UNDO, DOWNLOAD, REFRESH, PRINT } from '../components/icons.js';

const locale = () => (getLang() === 'ar' ? 'ar-u-nu-latn' : 'en');
const fmt = (opts, date) => new Intl.DateTimeFormat(locale(), opts).format(date);
const dateOf = (s) => new Date(s + 'T00:00:00');
const todayStr = () => { const n = new Date(); return ymd(n.getFullYear(), n.getMonth(), n.getDate()); };
const addDays = (s, n) => { const d = dateOf(s); d.setDate(d.getDate() + n); return ymd(d.getFullYear(), d.getMonth(), d.getDate()); };
const weekStartOf = (s) => addDays(s, -((dateOf(s).getDay() - WEEK_START + 7) % 7));
const key = (uid, day) => `${uid}|${day}`;

// Month vs week view: week fits a phone without sideways scrolling. Remembered per device.
const PREF = 'ts.teamView';
const readPref = () => { try { const v = localStorage.getItem(PREF); if (v === 'week' || v === 'month') return v; } catch { /* ignore */ } return matchMedia('(max-width: 640px)').matches ? 'week' : 'month'; };
const writePref = (v) => { try { localStorage.setItem(PREF, v); } catch { /* ignore */ } };
let viewMode = null, weekStart = null;      // module state: survives switching tabs

export function teamView() {
  const deptId = myDept();
  viewMode ??= readPref();
  weekStart ??= weekStartOf(todayStr());

  const root = h('section', { class: 'team' });
  let people = [], dept = null, data = null, days = [];
  let query = '';
  let built = false, seq = 0, scrollToToday = true;
  const undoStack = [];
  let focusPos = null;                        // keyboard: the active cell { uid, day|null } (null day = the name cell)
  let dayLabels = new Map();                  // day -> 'Monday 19 October' (for screen readers)
  const chains = new Map();                   // 'uid|day' -> promise: writes to one cell are sent in order
  const el = {};                              // persistent elements (search keeps focus while the grid redraws)

  const statusOf = (uid, day) => data.status.get(key(uid, day)) ?? 'E';
  const otOf = (uid, day) => data.overtime.get(key(uid, day))?.hours ?? 0;
  const rangeDays = () => (viewMode === 'week'
    ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    : [addDays(ymd(cursor.y, cursor.m, 1), -1), ...Array.from({ length: daysIn(cursor.y, cursor.m) }, (_, i) => ymd(cursor.y, cursor.m, i + 1)), addDays(ymd(cursor.y, cursor.m, daysIn(cursor.y, cursor.m)), 1)]);   // month view: + the last day of the previous month and the first of the next one, editable like the others

  // ---------- loading ----------
  // quiet = a live/background refetch: no loading overlay, and no redraw when nothing actually changed.
  async function load({ first = false, quiet = false, withPeople = false } = {}) {
    const my = ++seq;
    const epoch = writeEpoch;
    const rd = rangeDays();
    if (!quiet) { days = rd; el.wrap?.classList.add('loading'); if (!built) root.replaceChildren(h('p', { class: 'muted center' }, t('loading'))); }
    let d, p, dep;
    try {
      const jobs = [fetchRangeData(addDays(rd[0], -1), addDays(rd[rd.length - 1], 1))];       // one more day each side: the neighbours of the outer days (departure tags)
      if (first || withPeople || !people.length) jobs.push(fetchDeptPeople(deptId), fetchDepartment(deptId));
      [d, p, dep] = await Promise.all(jobs);
      if (my !== seq) return;                 // a newer navigation superseded this one
    } catch (e) { if (quiet && built) return; if (my === seq) root.replaceChildren(h('p', { class: 'error' }, explain(e))); built = false; return; }
    // a background refetch that was already in flight when one of OUR writes started carries stale data: drop it (our own
    // write's announcement triggers a fresh refetch afterwards)
    if (quiet && (writes > 0 || writeEpoch !== epoch)) { scheduleLive(false); return; }
    if (quiet && built) {
      const samePeople = !p || JSON.stringify(p.map((x) => [x.id, x.full_name, x.payroll, x.level, x.role])) === JSON.stringify(people.map((x) => [x.id, x.full_name, x.payroll, x.level, x.role]));
      const sameRange = drawnRange && drawnRange[0] === rd[0] && drawnRange[1] === rd.length;   // a view / month change must always redraw (compared with what is DRAWN, `days` is already the new range while a navigation is loading)
      if (sameRange && samePeople && sameData(data, d)) return;
    }
    days = rd; data = d; if (p) { people = p; dept = dep; }
    if (!built) build();
    renderTop(); drawGrid();
    el.wrap.classList.remove('loading');
    fit();
    if (first) ensureActive(true);              // page (re)load: keyboard focus starts on today's cell of the first employee
  }

  // ---------- live updates ----------
  let dragging = false, dragEndedAt = 0;      // a drag-fill gesture is running: no live redraw, no week swipe
  let writes = 0, writeEpoch = 0, liveTimer = null, livePeople = false;   // writeEpoch counts every write ever started
  const track = async (fn) => { writes++; writeEpoch++; try { return await fn(); } finally { writes--; } };   // refetches wait while our own writes are in flight
  function scheduleLive(people = false) {
    livePeople ||= people;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function run() {
      if (writes > 0 || dragging) { liveTimer = setTimeout(run, 500); return; }
      const wp = livePeople; livePeople = false;
      load({ quiet: true, withPeople: wp });
    }, 350);
  }
  live.watch([`dept:${deptId}`, `deptpub:${deptId}`], (p) => {
    if (p.t === 'profiles' || p.t === 'resync') { scheduleLive(true); return; }
    if (p.t === 'profile') return;
    if (days.length && (p.to < days[0] || p.from > days[days.length - 1])) return;   // outside the days on screen
    scheduleLive(false);
  });

  // ---------- undo ----------
  function pushUndo(entry) {
    const last = undoStack[undoStack.length - 1];
    if (entry.type === 'cells' && entry.stroke && last?.type === 'cells' && last.stroke && Date.now() - last.t < 1500) last.cells.push(...entry.cells);  // one paint stroke = one undo step
    else undoStack.push({ ...entry, t: Date.now() });
    if (undoStack.length > 30) undoStack.shift();
    renderTop();
    return undoStack[undoStack.length - 1];
  }
  // a save failed: drop exactly that cell's history step (not whatever happens to be last)
  function dropUndo(entry, uid, day, status) {
    if (!entry || entry.type !== 'cells') return;
    entry.cells = entry.cells.filter((c) => !(c.uid === uid && c.day === day && c.next === status));
    if (!entry.cells.length) { const i = undoStack.indexOf(entry); if (i >= 0) undoStack.splice(i, 1); }
    renderTop();
  }
  async function undo() {
    const e = undoStack.pop();
    renderTop();
    if (!e) return;
    try {
      if (e.type === 'cells') {
        // the undo write queues behind any write still in flight for the same cells (otherwise it could land first and be overwritten)
        const ks = e.cells.map((c) => key(c.uid, c.day));
        const run = Promise.all(ks.map((k) => (chains.get(k) ?? Promise.resolve()).catch(() => {}))).then(() => setStatusRows(e.cells.map((c) => ({ user: c.uid, day: c.day, status: c.prev }))));
        ks.forEach((k) => chains.set(k, run));
        try { await track(() => run); } finally { ks.forEach((k) => { if (chains.get(k) === run) chains.delete(k); }); }
        for (const c of e.cells) setLocal(c.uid, c.day, c.prev);
        drawGrid();
      } else if (e.type === 'holiday') {
        await track(() => setHoliday(e.day, e.wasOn));
        if (e.wasOn) data.holidays.add(e.day); else data.holidays.delete(e.day);
        drawGrid();
      }
      toast(t('undone'), 'success');
    } catch (err) { toast(explain(err)); await load(); }
  }

  function setLocal(uid, day, status) {
    if (status === 'E') data.status.delete(key(uid, day)); else data.status.set(key(uid, day), status);
  }

  // ---------- painting / holiday / edit ----------
  async function brush(uid, day, status, stroke = true, drag = null) {
    const prev = statusOf(uid, day);
    if (prev === status) return;
    if (status === 'Y' && !yOk(uid)) { toast(t('y_not_allowed')); return; }
    setLocal(uid, day, status);
    if (drag) { const td = el.table.querySelector(`td.c[data-u="${uid}"][data-d="${day}"]`); if (td) td.replaceWith(tdFor(people.find((x) => x.id === uid), day)); }   // drag-fill: patch only this cell, the row is rebuilt at the end
    else updateRow(uid);
    let entry;
    if (drag?.entry) { entry = drag.entry; entry.cells.push({ uid, day, prev, next: status }); }          // one drag = ONE undo step
    else { entry = pushUndo({ type: 'cells', stroke: stroke && !drag, cells: [{ uid, day, prev, next: status }] }); if (drag) drag.entry = entry; }
    announce(`${people.find((x) => x.id === uid)?.full_name}, ${dayLabels.get(day) ?? day}: ${status}`);
    // writes to the same cell go out one after another, so two quick key presses (X then Y) cannot overtake each other
    const k = key(uid, day);
    const run = (chains.get(k) ?? Promise.resolve()).catch(() => {}).then(() => setStatus(uid, day, status));
    chains.set(k, run);
    writes++; writeEpoch++;                     // live refetches wait from the moment a write is QUEUED (not only while it runs),
    try { await run; }                          // otherwise one could slip between two queued writes and redraw stale data
    catch (e) { toast(explain(e)); dropUndo(entry, uid, day, status); await load(); }
    finally { writes--; if (chains.get(k) === run) chains.delete(k); }
  }

  const yOk = (uid) => people.find((x) => x.id === uid)?.y_allowed !== false;       // may this person have Y?
  const cycle = (uid, day) => brush(uid, day, nextStatus(statusOf(uid, day), yOk(uid)), false);

  async function toggleHoliday(day) {
    const on = !data.holidays.has(day);
    if (on) data.holidays.add(day); else data.holidays.delete(day);
    pushUndo({ type: 'holiday', day, wasOn: !on });
    drawGrid();
    try { await track(() => setHoliday(day, on)); }
    catch (e) { toast(explain(e)); undoStack.pop(); await load(); }
  }

  function openEditor(uid, day) {
    const p = people.find((x) => x.id === uid);
    openDayEditor({
      person: p, day, status: statusOf(uid, day), overtime: data.overtime.get(key(uid, day)) ?? null, holiday: data.holidays.has(day), run: track,
      onClose: () => ensureActive(true),
      onSaved: ({ status: next, prevStatus, hours, note }) => {
        if (next !== prevStatus) pushUndo({ type: 'cells', cells: [{ uid, day, prev: prevStatus, next }] });
        setLocal(uid, day, next);
        if (hours === 0) data.overtime.delete(key(uid, day)); else data.overtime.set(key(uid, day), { hours, note });
        updateRow(uid); updateFoot();
      },
    });
  }

  // ---------- bulk fill (with a live "N cells will change" preview) ----------
  function openBulk() {
    const cache = new Map();                                   // 'from|to' -> Promise<status map>
    const statusMap = (from, to) => { const k = `${from}|${to}`; if (!cache.has(k)) cache.set(k, fetchRangeData(from, to).then((d) => d.status)); return cache.get(k); };
    const all = h('input', { type: 'checkbox', checked: true, id: 'bulk-all' });
    const boxes = people.map((p) => h('input', { type: 'checkbox', checked: true, value: p.id }));
    const inner = days.filter((d) => !isCtx(d));                // bulk fill defaults to the month itself, not the two outer days
    const from = field(t('from'), { type: 'date', value: inner[0], required: true });
    const to = field(t('to'), { type: 'date', value: inner[inner.length - 1], required: true });
    const st = choice(t('status'), ['X', 'Y', 'E'].map((s) => ({ value: s, label: s, cls: 's-' + s.toLowerCase() })), 'X', { compact: true });
    const preview = h('p', { class: 'bulk-preview', 'aria-live': 'polite' });

    const dayList = () => {
      const out = [];
      for (let d = new Date(from.input.value + 'T00:00:00'); d <= new Date(to.input.value + 'T00:00:00'); d.setDate(d.getDate() + 1)) out.push(ymd(d.getFullYear(), d.getMonth(), d.getDate()));
      return out;
    };
    // cells whose status would actually change
    async function plan() {
      const chosen = boxes.filter((b) => b.checked).map((b) => b.value), ds = dayList();
      const users = st.value === 'Y' ? chosen.filter(yOk) : chosen, skipped = chosen.length - users.length;   // people without Y are left out of a Y fill
      if (!users.length || !ds.length || ds.length > 366) return { users, ds, rows: [], total: 0, invalid: true, skipped };
      const map = await statusMap(ds[0], ds[ds.length - 1]);
      const target = st.value, rows = [];
      for (const u of users) for (const d of ds) { const prev = map.get(key(u, d)) ?? 'E'; if (prev !== target) rows.push({ user: u, day: d, status: target, prev }); }
      return { users, ds, rows, total: users.length * ds.length, skipped };
    }
    let timer;
    const refresh = () => {
      preview.textContent = '…'; clearTimeout(timer);
      timer = setTimeout(async () => {
        const p = await plan();
        preview.textContent = p.invalid ? t('bulk_empty') : `${p.rows.length} ${t('cells_will_change')} (${p.total} ${t('cells_selected')})${p.skipped ? ` · ${p.skipped} ${t('y_skipped')}` : ''}`;
        preview.classList.toggle('warn', p.rows.length > 500);
      }, 200);
    };
    all.addEventListener('change', () => { boxes.forEach((b) => { b.checked = all.checked; }); refresh(); });
    for (const x of [...boxes, from.input, to.input, st]) x.addEventListener('change', refresh);
    refresh();

    const content = h('div', { class: 'form' },
      from.row, to.row, st.row,
      h('label', { class: 'check strong' }, all, t('select_all')),
      h('div', { class: 'checklist' }, people.map((p, i) => h('label', { class: 'check' }, boxes[i], p.full_name))),
      preview);
    openDialog({
      title: t('bulk_fill'), content, wide: true,
      buttons: [{ label: t('cancel') }, { label: t('apply'), kind: 'primary', onClick: async () => {
        const p = await plan();
        if (p.invalid) throw Object.assign(new Error(p.ds.length > 366 ? t('bulk_too_big') : t('bulk_empty')), { code: '22023' });
        if (!p.rows.length) { toast(t('nothing_to_change'), 'success'); return; }
        await track(() => setStatusRows(p.rows.map(({ user, day, status }) => ({ user, day, status }))));
        const cells = p.rows.map((r) => ({ uid: r.user, day: r.day, prev: r.prev, next: r.status }));
        for (const c of cells) setLocal(c.uid, c.day, c.next);
        pushUndo({ type: 'cells', cells });
        drawGrid();
        toast(`${cells.length} ${t('cells_updated')}`, 'success', { action: { label: t('undo'), onClick: undo } });
      } }],
    });
  }

  // ---------- export (explicit month, independent of the week/month view) ----------
  function openExport() {
    const def = viewMode === 'week' ? addDays(weekStart, 3) : ymd(cursor.y, cursor.m, 1);
    const month = field(t('export_month'), { type: 'month', value: def.slice(0, 7), required: true });
    const format = choice(t('export_format'), [
      { value: 'official', label: t('export_fmt_xlsx'), hint: t('export_fmt_xlsx_hint') },
      { value: 'pdf', label: t('export_fmt_pdf'), hint: t('export_fmt_pdf_hint') },
      { value: 'simple', label: t('export_fmt_simple'), hint: t('export_fmt_simple_hint') }], 'official');
    // The report prints department data; anything missing there falls back to a default - say so
    const missing = [[dept?.code, 'rs_code'], [dept?.sector, 'rs_sector'], [dept?.field, 'rs_field'], [dept?.report?.dept_print_name, 'rs_dept_print_name'], [dept?.approved_engineer, 'rs_approved_engineer'], [dept?.approved_tech, 'rs_approved_tech']].filter(([v]) => v === null || v === undefined || v === '').map(([, k]) => t(k));
    const content = h('div', { class: 'form' }, month.row, format.row,
      missing.length ? h('p', { class: 'notice', role: 'status' }, `${t('export_missing_dept')} ${missing.join(', ')}`) : null,
      );
    openDialog({
      title: t('export_title'), content,
      buttons: [{ label: t('cancel') }, { label: t('export'), kind: 'primary', onClick: async () => {
        const [y, m] = month.input.value.split('-').map(Number);
        if (!y || !m) throw Object.assign(new Error(t('bulk_empty')), { code: '22023' });
        const [{ exportMonth, templates }, monthData] = await Promise.all([import('../export/engine.js'), fetchPaddedMonthData(y, m - 1)]);
        await exportMonth({ dept, people, data: monthData, year: y, month: m - 1, lang: getLang(), template: templates[format.value === 'pdf' ? 'official' : format.value], format: format.value === 'pdf' ? 'pdf' : 'xlsx' });
      } }],
    });
  }

  // Print the official monthly report (PDF) of the month shown straight away; the official Excel file if printing fails
  async function printGrid() {
    const y = viewMode === 'week' ? dateOf(addDays(weekStart, 3)).getFullYear() : cursor.y, m = viewMode === 'week' ? dateOf(addDays(weekStart, 3)).getMonth() : cursor.m;
    try {
      const [{ printMonth }, monthData] = await Promise.all([import('../export/engine.js'), fetchPaddedMonthData(y, m)]);
      const how = await printMonth({ dept, people, data: monthData, year: y, month: m, lang: getLang() });
      if (how === 'excel') toast(t('print_fallback'));
    } catch (e) { console.error('print failed', e); toast(t('print_failed')); }
  }

  const openInfo = () => openDialog({ title: t('info_title'), content: h('div', { class: 'form' },
    h('p', {}, t('team_hint')), h('p', {}, t('hint_drag_grid')), h('p', {}, t('hint_dep_grid')), h('p', { class: 'muted' }, t('team_hint_views')),
    h('h4', { class: 'kbd-title' }, t('kbd_title')), h('p', { class: 'muted' }, t('team_hint_keys'))), buttons: [{ label: t('close') }] });

  // Size the grid to the space left on screen so the pinned headcount row is always visible (never below the fold).
  function fit() {
    if (!el.wrap?.isConnected) return;
    const top = el.wrap.getBoundingClientRect().top + window.scrollY;
    const nav = document.querySelector('.shell > .nav'), cs = nav && getComputedStyle(nav);
    const bar = cs && cs.position === 'fixed' && cs.display !== 'none' ? nav.offsetHeight : 0;    // phone tab bar
    const below = (el.legend ? el.legend.offsetHeight + 24 : 40) + bar;
    el.wrap.style.maxHeight = `${Math.max(260, Math.floor(window.innerHeight - top - below))}px`;
  }
  window.addEventListener('resize', fit);

  // ---------- keyboard ----------
  // ARIA grid pattern with a roving tabindex: Tab enters the grid on ONE cell; arrows move; X / Y / E set the status.
  const rowIds = () => [...rowEls.keys()];
  const nodeAt = (uid, c) => { const tr = rowEls.get(uid); if (!tr) return null; return c < 0 ? tr.querySelector('th.nm') : tr.querySelector(`td.c[data-d="${days[c]}"]`); };
  function markActive(node) {
    el.table.querySelectorAll('tbody [tabindex="0"]').forEach((n) => { n.tabIndex = -1; });
    node.tabIndex = 0;
    focusPos = { uid: node.closest('tr').dataset.u, day: node.matches('th.nm') ? null : node.dataset.d };
  }
  // after any (re)draw: keep the same logical cell if it still exists, otherwise today's cell of the first row
  function ensureActive(refocus) {
    let node = null;
    if (focusPos && rowEls.has(focusPos.uid)) { const c = focusPos.day === null ? -1 : days.indexOf(focusPos.day); if (focusPos.day === null || c >= 0) node = nodeAt(focusPos.uid, c); }
    if (!node) { const first = rowIds()[0]; if (!first) { focusPos = null; return; } const ti = days.indexOf(todayStr()); node = nodeAt(first, ti >= 0 ? ti : 0); }
    if (node) { markActive(node); if (refocus) node.focus({ preventScroll: true }); }
  }
  function announce(text) { if (!el.announce) return; el.announce.textContent = ''; setTimeout(() => { el.announce.textContent = text; }, 30); }

  // Click / Enter / Space on a cell cycles E -> X -> Y -> E; Shift + it opens the day details (overtime, note)
  function activate(uid, day, details = false) { if (details) openEditor(uid, day); else cycle(uid, day); }

  function onKey(e) {
    if (e.altKey || e.defaultPrevented) return;
    const node = e.target.closest('td.c, tbody th.nm');
    if (!node || !el.table.contains(node)) return;
    const uid = node.closest('tr').dataset.u, isName = node.matches('th.nm'), day = isName ? null : node.dataset.d;
    const ids = rowIds(), r = ids.indexOf(uid), c = isName ? -1 : days.indexOf(day);
    const rtl = document.documentElement.dir === 'rtl', mod = e.ctrlKey || e.metaKey;
    let nr = r, nc = c, move = true;
    switch (e.key) {
      case 'ArrowRight': nc += rtl ? -1 : 1; break;           // arrows follow what you SEE: in Arabic the days run right-to-left
      case 'ArrowLeft': nc += rtl ? 1 : -1; break;
      case 'ArrowDown': nr += 1; break;
      case 'ArrowUp': nr -= 1; break;
      case 'PageDown': nr += 10; break;
      case 'PageUp': nr -= 10; break;
      case 'Home': nc = -1; if (mod) nr = 0; break;
      case 'End': nc = days.length - 1; if (mod) nr = ids.length - 1; break;
      default: move = false;
    }
    if (move) {
      e.preventDefault();
      nr = Math.max(0, Math.min(ids.length - 1, nr)); nc = Math.max(-1, Math.min(days.length - 1, nc));
      const target = nodeAt(ids[nr], nc);
      if (target) { markActive(target); target.focus(); }
      return;
    }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (mod) { if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); } return; }
    if (isName) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); location.hash = '#/person/' + uid; } return; }
    if (k === 'x' || k === 'y' || k === 'e') { e.preventDefault(); brush(uid, day, k.toUpperCase(), false); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); brush(uid, day, 'E', false); }
    else if (k === 'h') { e.preventDefault(); toggleHoliday(day); }
    else if (k === 'd') { e.preventDefault(); const kind = depKind(uid, day); if (kind) moveDeparture(uid, kind === 'rest' ? addDays(day, -1) : day, kind === 'rest'); }   // D: move this day's departure tag onto the last working day / back
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(uid, day, e.shiftKey); }
  }

  // ---------- rendering ----------
  function totalsOf(uid) {
    const c = { X: 0, Y: 0, XH: 0, YH: 0, ot: 0 };
    for (const day of days) {
      if (isCtx(day)) continue;                                // the outer days are not part of the month's totals
      const s = statusOf(uid, day);
      if (s !== 'E') c[effective(s, data.holidays.has(day))]++;
      c.ot += otOf(uid, day);
    }
    return c;
  }
  const totalsLine = (uid) => {
    const c = totalsOf(uid);
    const bits = [['X', c.X, 'tx'], ['Y', c.Y, 'ty'], ['XH', c.XH, 'tx tH'], ['YH', c.YH, 'ty tH']].filter(([, n]) => n).map(([k, n, cls]) => h('span', { class: 'tp ' + cls }, `${n}${k}`));
    if (c.ot) bits.push(h('span', { class: 'tp to' }, `${c.ot}${t('hour_abbr')}`));
    return bits.length ? bits : [h('span', { class: 'muted' }, '–')];
  };

  function buildRow(p) {
    const tr = h('tr', { 'data-u': p.id });
    const mine = focusPos && focusPos.uid === p.id;
    tr.append(h('th', { class: 'nm', scope: 'row', tabindex: mine && focusPos.day === null ? 0 : -1 },
      h('span', { class: 'nm-name' }, p.full_name),
      h('span', { class: 'nm-sub' }, h('small', { class: 'opr' }, (p.payroll ?? '')), h('span', { class: 'tots' }, totalsLine(p.id)))));
    for (const day of days) tr.append(tdFor(p, day, mine && focusPos.day === day));
    return tr;
  }
  const isCtx = (day) => viewMode === 'month' && days.length > 2 && (day === days[0] || day === days[days.length - 1]);   // the outer days of the month view (dimmed, not in the totals)
  // departure: where does this person's departure sit (on this day)?  'rest' = first rest day after a working period, 'work' = moved onto the last working day
  const depKind = (uid, date) => departureOf({
    works: statusOf(uid, date) !== 'E', prevWorks: statusOf(uid, addDays(date, -1)) !== 'E', nextWorks: statusOf(uid, addDays(date, 1)) !== 'E',
    movedHere: data.moves?.has(`${uid}|${date}`), movedPrev: data.moves?.has(`${uid}|${addDays(date, -1)}`) });
  async function moveDeparture(uid, workDate, on) {
    if (on) data.moves.add(`${uid}|${workDate}`); else data.moves.delete(`${uid}|${workDate}`);
    updateRow(uid);
    try { await track(() => setDepartureMove(uid, workDate, on)); }
    catch (e) { if (on) data.moves.delete(`${uid}|${workDate}`); else data.moves.add(`${uid}|${workDate}`); toast(explain(e)); updateRow(uid); }
  }
  function depBadge(p, day) {
    const kind = depKind(p.id, day);
    if (!kind) return null;
    const toWork = kind === 'rest', workDate = toWork ? addDays(day, -1) : day, label = toWork ? t('dep_to_work') : t('dep_to_rest');
    const go = (e) => { e.stopPropagation(); e.preventDefault(); moveDeparture(p.id, workDate, toWork); };
    return h('span', { class: 'dpb dpb-' + kind, role: 'button', title: label, 'aria-label': `${t('departure')}: ${label}`, onpointerdown: (e) => e.stopPropagation(), onclick: go, 'data-t': t('dep_short') });      // the letter comes from CSS (data-t), so the cell text stays just the status
  }
  function tdFor(p, day, focusable = false) {
    const t0 = todayStr();
    const hol = data.holidays.has(day), ot = otOf(p.id, day);
    const eff = effective(statusOf(p.id, day), hol);
    return h('td', { class: `c s-${eff.toLowerCase()}${hol ? ' holiday' : ''}${ot ? ' has-ot' : ''}${day === t0 ? ' today' : ''}${isCtx(day) ? ' ctx' : ''}`, 'data-u': p.id, 'data-d': day,
      tabindex: focusable ? 0 : -1, 'aria-label': `${p.full_name}, ${dayLabels.get(day) ?? day}: ${eff}${ot ? `, ${ot} ${t('overtime_h')}` : ''}` },
      depBadge(p, day), eff, ot ? h('sup', {}, ot) : null);
  }
  const rowEls = new Map();
  function updateRow(uid) {
    const p = people.find((x) => x.id === uid);
    if (!p || !rowEls.has(uid)) return;
    const had = rowEls.get(uid).contains(document.activeElement);
    const fresh = buildRow(p);
    rowEls.get(uid).replaceWith(fresh); rowEls.set(uid, fresh);
    updateFoot();
    if (had) ensureActive(true);
  }

  // Daily headcount: how many people are X (incl. XH) / Y (incl. YH) each day, across the whole department.
  function footRow() {
    const tr = h('tr', { class: 'foot' }, h('th', { class: 'nm', scope: 'row' }, h('span', { class: 'nm-name' }, t('headcount')), h('small', { class: 'muted' }, 'X / Y')));
    for (const day of days) {
      let x = 0, y = 0;
      for (const p of people) { const s = statusOf(p.id, day); if (s === 'X') x++; else if (s === 'Y') y++; }
      tr.append(h('td', { class: 'hc' + (data.holidays.has(day) ? ' holiday' : '') + (day === todayStr() ? ' today' : ''), 'aria-label': `X ${x}, Y ${y}` },
        h('b', { class: 'hx' }, x || '·'), h('i', { class: 'hy' }, y || '·')));
    }
    return tr;
  }
  function updateFoot() { const old = el.table.querySelector('tfoot'); if (old) old.replaceChildren(footRow()); }

  function matches(p) { return !query || `${p.full_name} ${p.payroll ?? ''} ${p.opr ?? ''} ${p.username}`.toLowerCase().includes(query); }

  let drawnRange = null;                       // [first day, number of days] of the grid on screen
  function drawGrid() {
    drawnRange = [days[0], days.length];
    const t0 = todayStr();
    const hadFocus = el.table.contains(document.activeElement);
    dayLabels = new Map(days.map((d) => [d, fmt({ weekday: 'long', day: 'numeric', month: 'long' }, dateOf(d))]));
    const head = h('tr', {}, h('th', { class: 'nm' }, t('employee')));
    for (const day of days) {
      const d = dateOf(day);
      head.append(h('th', { class: 'dh' + (data.holidays.has(day) ? ' holiday' : '') + (day === t0 ? ' today' : '') + (isCtx(day) ? ' ctx' : ''), 'data-d': day, scope: 'col', title: t('hint_day_number') },
        h('span', {}, d.getDate()), h('small', {}, isCtx(day) ? fmt({ month: 'short' }, d) : fmt({ weekday: viewMode === 'week' ? 'short' : 'narrow' }, d))));
    }
    const visible = people.filter(matches);
    rowEls.clear();
    const body = h('tbody', {});
    for (const p of visible) { const tr = buildRow(p); rowEls.set(p.id, tr); body.append(tr); }
    el.table.className = 'tgrid ' + viewMode;
    el.table.replaceChildren(h('thead', {}, head), body, h('tfoot', {}, footRow()));
    ensureActive(hadFocus);
    el.count.textContent = query ? `${visible.length}/${people.length}` : '';
    el.empty.hidden = visible.length > 0;
    el.empty.textContent = people.length ? t('no_match') : t('no_people');
    if (scrollToToday && viewMode === 'month') {
      const th = el.table.querySelector('th.dh.today');
      if (th) el.wrap.scrollLeft = Math.max(0, th.offsetLeft - el.wrap.clientWidth / 2 + th.offsetWidth / 2);
      scrollToToday = false;
    }
  }

  const title = () => {
    if (viewMode === 'month') return fmt({ month: 'long', year: 'numeric' }, new Date(cursor.y, cursor.m, 1));
    return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' }).formatRange(dateOf(days[0]), dateOf(days[6]));
  };

  function renderTop() {
    const go = (delta) => { if (viewMode === 'week') weekStart = addDays(weekStart, 7 * delta); else shiftMonth(delta); scrollToToday = true; load(); };
    const now = () => { goToday(); weekStart = weekStartOf(todayStr()); scrollToToday = true; load(); };
    const switchView = (v) => {
      if (v === viewMode) return;
      if (v === 'week') { const first = ymd(cursor.y, cursor.m, 1), t0 = todayStr(); weekStart = weekStartOf(t0.slice(0, 7) === first.slice(0, 7) ? t0 : first); }
      else { const d = dateOf(addDays(weekStart, 3)); cursor.y = d.getFullYear(); cursor.m = d.getMonth(); }
      viewMode = v; writePref(v); scrollToToday = true; load();
    };
    el.subText.textContent = `${dept?.name ?? ''} · ${people.length} ${t('employees')}`;
    el.head.replaceChildren(monthHead(title(), { onPrev: () => go(-1), onNext: () => go(1), onToday: now }));
    el.views.replaceChildren(...[['month', t('view_month')], ['week', t('view_week')]].map(([v, label]) =>
      h('button', { type: 'button', class: 'btn small' + (viewMode === v ? ' on' : ''), 'aria-pressed': String(viewMode === v), onclick: () => switchView(v) }, label)));
    el.undo.disabled = undoStack.length === 0;
    el.undo.replaceChildren(icon(UNDO, 16), `${t('undo')}${undoStack.length ? ` (${undoStack.length})` : ''}`);
  }

  function build() {
    el.subText = h('span', {});
    el.live = h('span', { class: 'live-dot', role: 'status' });
    el.sub = h('p', { class: 'dept-sub muted' }, el.subText, el.live);
    live.onStatus((st) => { el.live.className = 'live-dot ' + st; el.live.textContent = st === 'live' ? t('live') : st === 'connecting' ? t('connecting') : ''; el.live.title = st === 'live' ? t('live') : ''; });
    el.head = h('div', { class: 'head-slot' });
    el.search = h('input', { type: 'search', class: 'team-search', placeholder: t('search_employees'), 'aria-label': t('search_employees'), autocomplete: 'off' });
    let timer;
    el.search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { query = el.search.value.trim().toLowerCase(); drawGrid(); }, 120); });
    el.count = h('span', { class: 'muted team-count' });
    el.views = h('div', { class: 'seg', role: 'group', 'aria-label': t('view_month') + ' / ' + t('view_week') });
    el.undo = h('button', { type: 'button', class: 'btn small', onclick: undo });
    el.table = h('table', { class: 'tgrid', role: 'grid', 'aria-label': t('nav_team'), 'aria-keyshortcuts': 'ArrowUp ArrowDown ArrowLeft ArrowRight X Y E Delete H D Control+Z' });
    el.announce = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    el.table.addEventListener('keydown', onKey);
    el.table.addEventListener('focusin', (e) => { const n = e.target.closest?.('td.c, tbody th.nm'); if (n && el.table.contains(n)) markActive(n); });   // mouse/touch focus moves the active cell too
    el.table.addEventListener('click', (e) => {
      const td = e.target.closest('td.c');
      if (td) { activate(td.dataset.u, td.dataset.d, e.shiftKey); return; }
      const th = e.target.closest('th.dh');
      if (th) { toggleHoliday(th.dataset.d); return; }              // tap a day number = toggle the holiday
      const nm = e.target.closest('tbody th.nm');                  // tap a name = open that person's timesheet
      if (nm) location.hash = '#/person/' + nm.closest('tr').dataset.u;
    });
    // drag-to-fill: press a day, drag along the SAME person's days: each gets the start day's status as you go. Touch: press and hold first
    // (a plain swipe still scrolls / changes the week).
    enableDragFill(el.table, {
      cellSelector: 'td.c',
      keyOf: (td) => `${td.dataset.u}|${td.dataset.d}`,
      rowCells: (c) => [...(el.table.querySelector(`tr[data-u="${c.dataset.u}"]`)?.querySelectorAll('td.c') ?? [])],
      statusOf: (td) => statusOf(td.dataset.u, td.dataset.d),
      canFill: (td, status) => !(status === 'Y' && !yOk(td.dataset.u)),
      fill: (td, status, drag) => brush(td.dataset.u, td.dataset.d, status, false, drag),
      press: () => { dragging = true; },
      release: (drag) => { dragging = false; if (drag.active) { dragEndedAt = Date.now(); updateRow(drag.start.dataset.u); } },
      touchHold: 350,
    });
    el.wrap = h('div', { class: 'gridwrap' }, el.table);
    // swipe left/right = next/previous week (the week grid fits the screen, so a swipe is never a scroll)
    let sx = 0, sy = 0;
    el.wrap.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    el.wrap.addEventListener('touchend', (e) => {
      if (viewMode !== 'week' || dragging || Date.now() - dragEndedAt < 500) return;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) { weekStart = addDays(weekStart, dx < 0 ? 7 : -7); load(); }
    }, { passive: true });
    el.empty = h('p', { class: 'muted', hidden: true });
    const legend = el.legend = h('div', { class: 'legend-row', 'aria-label': t('legend_label') },
      h('span', { class: 'chip s-x' }, t('legend_x')), h('span', { class: 'chip s-y' }, t('legend_y')), h('span', { class: 'chip' }, t('legend_e')),
      h('span', { class: 'chip holiday-chip' }, t('holiday')), h('span', { class: 'chip ot' }, t('overtime')));

    root.replaceChildren(
      h('div', { class: 'team-top' },
        el.sub, el.head,
        h('div', { class: 'team-row' }, h('div', { class: 'search-wrap' }, icon(SEARCH, 16), el.search, el.count), el.views),
        h('div', { class: 'team-row tools' },
          h('button', { type: 'button', class: 'btn small', onclick: openBulk }, t('bulk_fill')), el.undo,
          h('button', { type: 'button', class: 'btn small icon-only', onclick: () => load({ quiet: false, withPeople: true }), 'aria-label': t('refresh'), title: t('refresh') }, icon(REFRESH, 18)),
          h('button', { type: 'button', class: 'btn small', onclick: printGrid }, icon(PRINT, 16), t('print')),
          h('button', { type: 'button', class: 'btn small primary', onclick: openExport }, icon(DOWNLOAD, 16), t('export')),
          h('button', { type: 'button', class: 'btn small', onclick: () => openReportSettings({ dept, onSaved: () => renderTop() }) }, t('report_settings')),
          h('button', { type: 'button', class: 'btn small icon-only', onclick: openInfo, 'aria-label': t('info_title'), title: t('info_title') }, icon(INFO, 18)))),
      el.wrap, el.empty, legend, el.announce);
    built = true;
    if (window.ResizeObserver) new ResizeObserver(fit).observe(root.querySelector('.team-top'));
  }

  load({ first: true });
  return root;
}
