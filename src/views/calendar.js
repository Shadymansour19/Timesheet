import { h } from '../dom.js';
import { t, getLang } from '../i18n/index.js';
import { state, myDept } from '../auth/session.js';
import { fetchMonth, fetchEditWindow, setDayStatus, setDepartureMove, fetchPaddedMonthData, ymd, daysIn, cursor, shiftMonth, goToday, monthRange } from '../api/timesheet.js';
import { fetchDepartment, setStatusRows } from '../api/admin.js';
import { openDialog, confirmDialog } from '../components/dialog.js';
import { choice } from '../components/choice.js';
import { icon, INFO, DOWNLOAD, PRINT, TRASH } from '../components/icons.js';
import { WEEK_START, nextStatus } from '../lib/core.js';
import { enableDragFill } from '../lib/dragfill.js';
import { departureOf } from '../export/model.js';
import * as live from '../live.js';
import { toast } from '../components/toast.js';
import { monthHead } from '../components/month-head.js';
import { openDayEditor } from '../components/day-editor.js';
import { guideAuto, startGuide } from '../components/guide.js';

const fmt = (opts, date) => new Intl.DateTimeFormat(getLang() === 'ar' ? 'ar-u-nu-latn' : 'en', opts).format(date);
const sameMonth = (a, b) => { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every((k) => b[k] && a[k].status === b[k].status && a[k].eff === b[k].eff && a[k].ot === b[k].ot && (a[k].note ?? '') === (b[k].note ?? '') && a[k].hol === b[k].hol); };

// Month calendar for ONE person. Default: the signed-in person recording their own days (tap cycles E -> X -> Y).
// admin + userId: a department admin editing someone's timesheet (tap cycles, or opens the day editor with overtime).
export function calendarView({ userId, admin = false, person = null, readOnly = false } = {}) {   // readOnly: a super manager looking at someone's month
  const me = state.profile.id;
  const uid = userId ?? me;
  const dept = myDept();
  const root = h('section', { class: 'cal' });
  let data = {};                 // shown values by day (optimistic)
  let editWindow = null;
  let mode = 'cycle';            // admin only: 'cycle' | 'details'
  const confirmed = {};          // day -> status last confirmed by the server
  const want = {};               // day -> latest status the user asked for
  const busy = new Set();        // days with a request in flight
  let moves = new Set(), lastSig = '';   // the departures moved onto their last working day
  let dragging = false, pendingDraw = false;      // while a drag-fill gesture runs nothing is re-rendered (the gesture would be lost)
  const redraw = () => { if (dragging) pendingDraw = true; else draw(); };
  let wver = 0;                  // bumped whenever a save starts or ends: a background read that overlapped one is stale and is dropped

  const todayStr = (() => { const n = new Date(); return ymd(n.getFullYear(), n.getMonth(), n.getDate()); })();
  const earliest = () => {
    if (admin || editWindow === null) return null;           // admins are not limited by the user edit window
    const n = new Date(); n.setDate(n.getDate() - editWindow);
    return ymd(n.getFullYear(), n.getMonth(), n.getDate());
  };

  async function load({ quiet = false } = {}) {
    if (!quiet) root.replaceChildren(h('p', { class: 'muted center' }, t('loading')));
    if (quiet && busy.size) { refetch(); return; }          // a save is in flight: read after it
    const v0 = wver;
    let fresh, win = editWindow, mv = new Set();
    try { let r; [r, win] = await Promise.all([fetchMonth(uid, cursor.y, cursor.m), admin ? null : fetchEditWindow()]); fresh = r.byDay; mv = r.moves; }
    catch { if (!quiet) root.replaceChildren(h('p', { class: 'error' }, t('load_error'))); return; }
    if (quiet && (busy.size || v0 !== wver)) { refetch(); return; }   // a save started / finished while we were reading: this read may predate it
    const sig = JSON.stringify([...mv].sort());
    if (quiet && sameMonth(fresh, data) && sig === lastSig) return;   // nothing new
    data = fresh; editWindow = win; moves = mv; lastSig = sig;
    for (const [day, v] of Object.entries(data)) if (!busy.has(day)) confirmed[day] = v.status;
    redraw();
  }

  const effOf = (status, holiday) => (status === 'E' ? 'E' : status + (holiday ? 'H' : ''));

  // Serialise writes per day: tapping fast sends only the latest wanted value, one request at a time.
  async function change(day) {
    const cur = data[day] ?? { status: 'E', eff: 'E', ot: 0, hol: false };
    return setTo(day, nextStatus(cur.status, (admin ? person?.y_allowed : state.profile.y_allowed) !== false));
  }

  // set a day to a given status (optimistic, then saved in order); `patch` = update only that button in place (drag-fill)
  async function setTo(day, next, patch = null) {
    if (readOnly) return;
    const cur = data[day] ?? { status: 'E', eff: 'E', ot: 0, hol: false };
    if (cur.status === next && !patch) return;
    data[day] = { ...cur, status: next, eff: effOf(next, cur.hol) };
    want[day] = next;
    if (patch) patch(); else redraw();
    if (busy.has(day)) return;
    busy.add(day); wver++;
    try {
      while ((confirmed[day] ?? 'E') !== want[day]) {
        const sending = want[day];
        try {
          await setDayStatus(uid, day, sending);
          confirmed[day] = sending;
        } catch (e) {
          const back = confirmed[day] ?? 'E';           // roll back to the last server-confirmed value
          const v = data[day] ?? { ot: 0, hol: false };
          data[day] = { ...v, status: back, eff: effOf(back, v.hol) };
          want[day] = back;
          toast(e.code === '42501' ? t('edit_denied') : e.code === '22023' ? t('y_not_allowed') : t('save_failed'));
        }
      }
    } finally { busy.delete(day); wver++; redraw(); }
  }

  // Help text lives behind the "i" button (keeps the calendar compact)
  const openHelp = () => openDialog({ title: t('help'), content: h('div', { class: 'form' },
    ...(admin ? [h('p', {}, t('person_hint'))] : []), h('p', {}, `${t('legend')} ${t('legend_ot')}`), h('p', {}, t('hint_drag_cal')), h('p', {}, t('hint_departure')),
    ...(editWindow !== null && !admin ? [h('p', { class: 'muted' }, t('edit_window_note').replace('{n}', editWindow))] : [])), buttons: [{ label: t('close') }] });

  // Download THIS person's Monthly Time Report for the shown month (Excel or PDF)
  function openExport() {
    const format = choice(t('export_format'), [
      { value: 'xlsx', label: t('export_fmt_xlsx_one'), hint: t('export_fmt_xlsx_one_hint') },
      { value: 'pdf', label: t('export_fmt_pdf_one'), hint: t('export_fmt_pdf_one_hint') }], 'xlsx');
    openDialog({ title: t('cal_export'), content: h('div', { class: 'form' }, format.row),
      buttons: [{ label: t('cancel') }, { label: t('export'), kind: 'primary', onClick: async () => {
        const [{ exportMonth }, d, deptRow] = await Promise.all([import('../export/engine.js'), fetchPaddedMonthData(cursor.y, cursor.m, { userId: uid }), fetchDepartment(dept)]);
        const ppl = personRow();
        await exportMonth({ dept: deptRow ?? { name: '' }, people: [ppl], data: d, year: cursor.y, month: cursor.m, lang: getLang(), format: format.value, employeeId: uid });
      } }] });
  }
  // Clear every day of the shown month that is not E (and that this person may still edit), after a confirmation.
  // Overtime entries are not touched (they are entered by the admin).
  async function clearMonth() {
    const lim = earliest();
    const days = Object.entries(data).filter(([d, v]) => !v.ctx && v.status !== 'E' && !(lim !== null && d < lim)).map(([d]) => d);
    const monthName = fmt({ month: 'long', year: 'numeric' }, new Date(cursor.y, cursor.m, 1));
    if (!days.length) { toast(t('clear_nothing')); return; }
    const yes = await confirmDialog(t('clear_confirm').replace('{n}', days.length).replace('{month}', monthName),
      { danger: true, confirmLabel: t('clear'), detail: t('clear_detail') });
    if (!yes) return;
    days.forEach((d) => { busy.add(d); want[d] = 'E'; data[d] = { ...data[d], status: 'E', eff: 'E' }; });     // hold live refreshes, show it at once
    wver++; redraw();
    try {
      if (admin) await setStatusRows(days.map((d) => ({ user: uid, day: d, status: 'E' })));                   // one transaction
      else { let i = 0; await Promise.all([0, 1, 2, 3].map(async () => { while (i < days.length) { const d = days[i++]; await setDayStatus(uid, d, 'E'); confirmed[d] = 'E'; } })); }
      toast(t('cleared'), 'success');
    } catch (e) { toast(e.code === '42501' ? t('edit_denied') : t('save_failed')); }
    finally { days.forEach((d) => busy.delete(d)); wver++; await load({ quiet: false }); }
  }

  async function printMine() {
    try {
      const [{ printMonth }, d, deptRow] = await Promise.all([import('../export/engine.js'), fetchPaddedMonthData(cursor.y, cursor.m, { userId: uid }), fetchDepartment(dept)]);
      const how = await printMonth({ dept: deptRow ?? { name: '' }, people: [personRow()], data: d, year: cursor.y, month: cursor.m, lang: getLang(), employeeId: uid });
      if (how === 'excel') toast(t('print_fallback'));
    } catch (e) { console.error('print failed', e); toast(t('print_failed')); }
  }
  function personRow() {
    if (uid === me) return state.profile;
    return person;                     // the person view loaded the full row
  }

  function openDetails(day) {
    const v = data[day] ?? { status: 'E', ot: 0, note: '', hol: false };
    busy.add(day); wver++;   // hold live refetches while the dialog is open and saving
    openDayEditor({
      person: { id: uid, full_name: person?.full_name ?? state.profile.full_name }, day,
      status: v.status, overtime: v.ot ? { hours: v.ot, note: v.note } : null, holiday: v.hol,
      onSaved: () => { busy.delete(day); wver++; load({ quiet: false }); },
    });
    // release the hold if the dialog is dismissed without saving
    const dlg = document.querySelector('dialog[open]');
    dlg?.addEventListener('close', () => { busy.delete(day); wver++; });
  }

  // ---- departures: by default on the first REST day after a working period; the marker can be tapped to move it onto the last working day
  const addDay = (date, n) => { const dt = new Date(date + 'T00:00:00'); dt.setDate(dt.getDate() + n); return ymd(dt.getFullYear(), dt.getMonth(), dt.getDate()); };
  const statusOn = (date) => data[date]?.status ?? 'E';
  const edgeDates = () => [addDay(ymd(cursor.y, cursor.m, 1), -1), addDay(ymd(cursor.y, cursor.m, daysIn(cursor.y, cursor.m)), 1)];
  const depOn = (date) => departureOf({
    works: statusOn(date) !== 'E', prevWorks: statusOn(addDay(date, -1)) !== 'E', nextWorks: statusOn(addDay(date, 1)) !== 'E',
    movedHere: moves.has(date), movedPrev: moves.has(addDay(date, -1)) });
  async function moveDeparture(workDate, on) {
    const lim = earliest();
    if (lim !== null && workDate < lim) { toast(t('edit_denied')); return; }
    if (on) moves.add(workDate); else moves.delete(workDate);
    redraw();
    busy.add('mv' + workDate); wver++;
    try { await setDepartureMove(uid, workDate, on); }
    catch (e) { if (on) moves.delete(workDate); else moves.add(workDate); toast(e.code === '42501' ? t('edit_denied') : t('save_failed')); }
    finally { busy.delete('mv' + workDate); wver++; redraw(); }
  }
  function depMark(date, kind) {
    if (!kind) return null;
    const toWork = kind === 'rest';                          // tap on the rest-day marker -> move it onto the last working day; tap on the work-day marker -> back
    const workDate = toWork ? addDay(date, -1) : date;
    const label = toWork ? t('dep_to_work') : t('dep_to_rest');
    const go = (e) => { e.stopPropagation(); e.preventDefault(); if (!readOnly) moveDeparture(workDate, toWork); };
    return h('span', { class: 'dep dep-' + kind, role: 'button', tabindex: 0, title: label, 'aria-label': `${t('departure')}: ${label}`,
      onpointerdown: (e) => e.stopPropagation(), onclick: go, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') go(e); }, 'data-t': t('dep_short') });
  }

  function cell(day) {
    const d = Number(day.slice(8)), v = data[day] ?? { status: 'E', eff: 'E', ot: 0, hol: false }, ctx = !!v.ctx;
    const lim = earliest();
    const locked = readOnly || (lim !== null && day < lim);
    const cls = ['day', ctx ? 'ctx' : '', 's-' + v.eff.toLowerCase(), day === todayStr ? 'today' : '', v.hol ? 'holiday' : '', v.ot ? 'has-ot' : ''].filter(Boolean).join(' ');
    const dt = new Date(day + 'T00:00:00');
    const label = `${fmt({ weekday: 'long', day: 'numeric', month: 'long' }, dt)}: ${v.eff}${v.ot ? `, ${v.ot} ${t('overtime_h')}` : ''}`;
    return h('button', { class: cls, type: 'button', disabled: locked, 'data-d': day, 'aria-label': label, onclick: () => (admin && mode === 'details' ? openDetails(day) : change(day)) },
      h('span', { class: 'num' }, ctx ? `${d} ${fmt({ month: 'short' }, dt)}` : d),
      h('span', { class: 'st' }, v.eff),
      v.ot ? h('span', { class: 'ot' }, `+${v.ot}${t('hour_abbr')}`) : null,
      depMark(day, depOn(day)));
  }

  function draw() {
    const first = new Date(cursor.y, cursor.m, 1);
    const lead = (first.getDay() - WEEK_START + 7) % 7;
    const cells = [];
    const n = daysIn(cursor.y, cursor.m), [pd, nd] = edgeDates();
    for (let i = 0; i < (lead === 0 ? 6 : lead - 1); i++) cells.push(h('span', { class: 'pad' }));        // the day before day 1 sits right in front of it (a row of its own when the month starts the week)
    cells.push(cell(pd));
    for (let d = 1; d <= n; d++) cells.push(cell(ymd(cursor.y, cursor.m, d)));
    cells.push(cell(nd));
    for (let i = 0; i < ((7 - ((lead + n + 1) % 7)) % 7); i++) cells.push(h('span', { class: 'pad' }));

    const weekdays = [...Array(7)].map((_, i) =>
      h('span', { class: 'wd' }, fmt({ weekday: 'short' }, new Date(2023, 0, 1 + ((i + WEEK_START) % 7)))));

    const monthDates = Object.keys(data).filter((d) => !data[d].ctx);          // the two outer days are not part of the month's totals
    const count = (s) => monthDates.filter((d) => data[d].eff === s).length;
    const ot = monthDates.reduce((a, d) => a + (data[d].ot || 0), 0);
    // trips of the month = arrivals (a work day after a rest day) + departures (the tag, wherever it sits)
    const trips = monthDates.reduce((a, d) => a + (data[d].status !== 'E' && statusOn(addDay(d, -1)) === 'E' ? 1 : 0) + (depOn(d) ? 1 : 0), 0);
    const go = (delta) => { shiftMonth(delta); load(); };
    const seg = admin && !readOnly ? h('div', { class: 'seg cal-mode', role: 'group', 'aria-label': t('tap_mode') },
      [['cycle', t('mode_cycle')], ['details', t('mode_details')]].map(([m, label]) =>
        h('button', { type: 'button', class: 'btn small' + (mode === m ? ' on' : ''), 'aria-pressed': String(mode === m), onclick: () => { mode = m; redraw(); } }, label))) : null;

    const tools = h('div', { class: 'cal-tools' },
      readOnly ? null : h('button', { type: 'button', class: 'btn small danger-outline', onclick: clearMonth }, icon(TRASH, 16), t('clear')),
      h('button', { type: 'button', class: 'btn small', onclick: printMine }, icon(PRINT, 16), t('print')),
      h('button', { type: 'button', class: 'btn small', onclick: openExport }, icon(DOWNLOAD, 16), t('export')),
      h('button', { type: 'button', class: 'btn small icon-only', onclick: openHelp, 'aria-label': t('help'), title: t('help') }, icon(INFO, 18)));
    root.replaceChildren(
      monthHead(fmt({ month: 'long', year: 'numeric' }, first), { onPrev: () => go(-1), onNext: () => go(1), onToday: () => { goToday(); load(); } }),
      tools,
      ...(seg ? [seg] : []),
      h('div', { class: 'grid' }, weekdays, cells),
      h('div', { class: 'totals' },
        ['X', 'Y', 'XH', 'YH'].map((s) => h('span', { class: 'chip s-' + s.toLowerCase() }, `${s}: ${count(s)}`)),
        h('span', { class: 'chip ot' }, `${t('overtime')}: ${ot}${t('hour_abbr')}`),
        h('span', { class: 'chip trips', title: t('trips_hint') }, `${t('trips')}: ${trips}`)));
  }

  // drag-to-fill: press a day and drag over others -> they get the start day's status as you go (not in the admin's details mode)
  enableDragFill(root, {
    cellSelector: '.grid .day',
    keyOf: (btn) => btn.dataset.d,
    rowCells: () => [...root.querySelectorAll('.grid .day')],
    statusOf: (btn) => data[btn.dataset.d]?.status ?? 'E',
    canFill: (btn, status) => !btn.disabled && !(status === 'Y' && (admin ? person?.y_allowed : state.profile.y_allowed) === false),
    fill: (btn, status) => {
      const day = btn.dataset.d;
      setTo(day, status, () => { const fresh = cell(day); btn.className = fresh.className; btn.replaceChildren(...fresh.childNodes); btn.setAttribute('aria-label', fresh.getAttribute('aria-label')); });
    },
    press: () => { dragging = true; },
    release: () => { dragging = false; setTimeout(() => { if (pendingDraw && !dragging) { pendingDraw = false; draw(); } }, 0); },     // after the click event, which needs the pressed button to still be there
    touchHold: 0,
    enabled: () => !readOnly && !(admin && mode === 'details'),
  });

  // live: refetch quietly when this person's days (or the department holidays) change somewhere else
  let timer;
  const refetch = () => { clearTimeout(timer); timer = setTimeout(() => load({ quiet: true }), 350); };
  const topics = admin && uid !== me ? [`dept:${dept}`, `deptpub:${dept}`] : [`user:${uid}`, `deptpub:${dept}`];
  live.watch(topics, (p) => {
    if (p.t === 'profiles' || p.t === 'profile') return;
    if (p.t !== 'resync') {
      if (p.u && !p.u.includes(uid) && p.t !== 'holidays') return;
      const [a, b] = monthRange(cursor.y, cursor.m);
      if (p.to < a || p.from > b) return;
    }
    refetch();
  });

  load();
  if (!admin && !readOnly && guideAuto()) startGuide();        // a new user on a phone: the guided tour starts once the calendar is drawn
  return root;
}
