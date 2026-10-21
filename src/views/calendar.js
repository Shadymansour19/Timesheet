import { h } from '../dom.js';
import { t, getLang } from '../i18n/index.js';
import { state, myDept } from '../auth/session.js';
import { fetchMonth, fetchEditWindow, setDayStatus, fetchPaddedMonthData, ymd, daysIn, cursor, shiftMonth, goToday, monthRange } from '../api/timesheet.js';
import { fetchDepartment } from '../api/admin.js';
import { openDialog } from '../components/dialog.js';
import { choice } from '../components/choice.js';
import { icon, INFO, DOWNLOAD, PRINT } from '../components/icons.js';
import { WEEK_START } from '../lib/core.js';
import * as live from '../live.js';
import { toast } from '../components/toast.js';
import { monthHead } from '../components/month-head.js';
import { openDayEditor } from '../components/day-editor.js';

const NEXT = { E: 'X', X: 'Y', Y: 'E' };
const fmt = (opts, date) => new Intl.DateTimeFormat(getLang() === 'ar' ? 'ar-u-nu-latn' : 'en', opts).format(date);
const sameMonth = (a, b) => { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every((k) => b[k] && a[k].status === b[k].status && a[k].eff === b[k].eff && a[k].ot === b[k].ot && (a[k].note ?? '') === (b[k].note ?? '') && a[k].hol === b[k].hol); };

// Month calendar for ONE person. Default: the signed-in person recording their own days (tap cycles E -> X -> Y).
// admin + userId: a department admin editing someone's timesheet (tap cycles, or opens the day editor with overtime).
export function calendarView({ userId, admin = false, person = null } = {}) {
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

  const todayStr = (() => { const n = new Date(); return ymd(n.getFullYear(), n.getMonth(), n.getDate()); })();
  const earliest = () => {
    if (admin || editWindow === null) return null;           // admins are not limited by the user edit window
    const n = new Date(); n.setDate(n.getDate() - editWindow);
    return ymd(n.getFullYear(), n.getMonth(), n.getDate());
  };

  async function load({ quiet = false } = {}) {
    if (!quiet) root.replaceChildren(h('p', { class: 'muted center' }, t('loading')));
    let fresh, win = editWindow;
    try { [fresh, win] = await Promise.all([fetchMonth(uid, cursor.y, cursor.m), admin ? null : fetchEditWindow()]); }
    catch { if (!quiet) root.replaceChildren(h('p', { class: 'error' }, t('load_error'))); return; }
    if (quiet && (busy.size || sameMonth(fresh, data))) return;   // nothing new, or our own write is still in flight
    data = fresh; editWindow = win;
    for (const [day, v] of Object.entries(data)) if (!busy.has(day)) confirmed[day] = v.status;
    draw();
  }

  const effOf = (status, holiday) => (status === 'E' ? 'E' : status + (holiday ? 'H' : ''));

  // Serialise writes per day: tapping fast sends only the latest wanted value, one request at a time.
  async function change(day) {
    const cur = data[day] ?? { status: 'E', eff: 'E', ot: 0, hol: false };
    const next = NEXT[cur.status];
    data[day] = { ...cur, status: next, eff: effOf(next, cur.hol) };
    want[day] = next;
    draw();
    if (busy.has(day)) return;
    busy.add(day);
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
          toast(e.code === '42501' ? t('edit_denied') : t('save_failed'));
        }
      }
    } finally { busy.delete(day); draw(); }
  }

  // Help text lives behind the "i" button (keeps the calendar compact)
  const openHelp = () => openDialog({ title: t('help'), content: h('div', { class: 'form' },
    ...(admin ? [h('p', {}, t('person_hint'))] : []), h('p', {}, `${t('legend')} ${t('legend_ot')}`),
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
    busy.add(day);   // hold live refetches while the dialog is open and saving
    openDayEditor({
      person: { id: uid, full_name: person?.full_name ?? state.profile.full_name }, day,
      status: v.status, overtime: v.ot ? { hours: v.ot, note: v.note } : null, holiday: v.hol,
      onSaved: () => { busy.delete(day); load({ quiet: false }); },
    });
    // release the hold if the dialog is dismissed without saving
    const dlg = document.querySelector('dialog[open]');
    dlg?.addEventListener('close', () => { busy.delete(day); });
  }

  function cell(d) {
    const day = ymd(cursor.y, cursor.m, d);
    const v = data[day] ?? { status: 'E', eff: 'E', ot: 0, hol: false };
    const lim = earliest();
    const locked = lim !== null && day < lim;
    const cls = ['day', 's-' + v.eff.toLowerCase(), day === todayStr ? 'today' : '', v.hol ? 'holiday' : '', v.ot ? 'has-ot' : ''].join(' ');
    const label = `${fmt({ weekday: 'long', day: 'numeric', month: 'long' }, new Date(cursor.y, cursor.m, d))}: ${v.eff}${v.ot ? `, ${v.ot} ${t('overtime_h')}` : ''}`;
    return h('button', { class: cls, type: 'button', disabled: locked, 'aria-label': label, onclick: () => (admin && mode === 'details' ? openDetails(day) : change(day)) },
      h('span', { class: 'num' }, d),
      h('span', { class: 'st' }, v.eff),
      v.ot ? h('span', { class: 'ot' }, `+${v.ot}${t('hour_abbr')}`) : null);
  }

  function draw() {
    const first = new Date(cursor.y, cursor.m, 1);
    const lead = (first.getDay() - WEEK_START + 7) % 7;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'pad' }));
    for (let d = 1; d <= daysIn(cursor.y, cursor.m); d++) cells.push(cell(d));

    const weekdays = [...Array(7)].map((_, i) =>
      h('span', { class: 'wd' }, fmt({ weekday: 'short' }, new Date(2023, 0, 1 + ((i + WEEK_START) % 7)))));

    const count = (s) => Object.values(data).filter((v) => v.eff === s).length;
    const ot = Object.values(data).reduce((a, v) => a + (v.ot || 0), 0);
    const go = (delta) => { shiftMonth(delta); load(); };
    const seg = admin ? h('div', { class: 'seg cal-mode', role: 'group', 'aria-label': t('tap_mode') },
      [['cycle', t('mode_cycle')], ['details', t('mode_details')]].map(([m, label]) =>
        h('button', { type: 'button', class: 'btn small' + (mode === m ? ' on' : ''), 'aria-pressed': String(mode === m), onclick: () => { mode = m; draw(); } }, label))) : null;

    const tools = h('div', { class: 'cal-tools' },
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
        h('span', { class: 'chip ot' }, `${t('overtime')}: ${ot}${t('hour_abbr')}`)));
  }

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
  return root;
}
