import { h } from '../dom.js';
import { t, getLang } from '../i18n/index.js';
import { state } from '../auth/session.js';
import { fetchMonth, fetchEditWindow, setDayStatus, ymd, daysIn, cursor, shiftMonth, goToday } from '../api/timesheet.js';
import { toast } from '../components/toast.js';

const NEXT = { E: 'X', X: 'Y', Y: 'E' };
const WEEK_START = 0; // 0 = Sunday. Change here if the company week starts on another day.

const fmt = (opts, date) => new Intl.DateTimeFormat(getLang() === 'ar' ? 'ar-u-nu-latn' : 'en', opts).format(date);

export function calendarView() {
  const me = state.profile.id;
  const root = h('section', { class: 'cal' });
  let data = {};                 // shown values by day (optimistic)
  let editWindow = null;
  const confirmed = {};          // day -> status last confirmed by the server
  const want = {};               // day -> latest status the user asked for
  const busy = new Set();        // days with a request in flight

  const todayStr = (() => { const n = new Date(); return ymd(n.getFullYear(), n.getMonth(), n.getDate()); })();
  const earliest = () => {
    if (editWindow === null) return null;
    const n = new Date(); n.setDate(n.getDate() - editWindow);
    return ymd(n.getFullYear(), n.getMonth(), n.getDate());
  };

  async function load() {
    root.replaceChildren(h('p', { class: 'muted center' }, t('loading')));
    try {
      [data, editWindow] = await Promise.all([fetchMonth(me, cursor.y, cursor.m), fetchEditWindow()]);
    } catch { root.replaceChildren(h('p', { class: 'error' }, t('load_error'))); return; }
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
          await setDayStatus(me, day, sending);
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

  function cell(d) {
    const day = ymd(cursor.y, cursor.m, d);
    const v = data[day] ?? { status: 'E', eff: 'E', ot: 0, hol: false };
    const lim = earliest();
    const locked = lim !== null && day < lim;
    const cls = ['day', 's-' + v.eff.toLowerCase(), day === todayStr ? 'today' : '', v.hol ? 'holiday' : ''].join(' ');
    const label = `${fmt({ weekday: 'long', day: 'numeric', month: 'long' }, new Date(cursor.y, cursor.m, d))}: ${v.eff}${v.ot ? `, ${v.ot} ${t('overtime_h')}` : ''}`;
    return h('button', { class: cls, type: 'button', disabled: locked, 'aria-label': label, onclick: () => change(day) },
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

    root.replaceChildren(
      h('div', { class: 'cal-head' },
        h('button', { class: 'btn small', onclick: () => go(-1), 'aria-label': t('prev_month') }, getLang() === 'ar' ? '›' : '‹'),
        h('h2', {}, fmt({ month: 'long', year: 'numeric' }, first)),
        h('button', { class: 'btn small', onclick: () => go(1), 'aria-label': t('next_month') }, getLang() === 'ar' ? '‹' : '›'),
        h('button', { class: 'btn small', onclick: () => { goToday(); load(); } }, t('today'))),
      h('div', { class: 'grid' }, weekdays, cells),
      h('div', { class: 'totals' },
        ['X', 'Y', 'XH', 'YH'].map((s) => h('span', { class: 'chip s-' + s.toLowerCase() }, `${s}: ${count(s)}`)),
        h('span', { class: 'chip' }, `${t('overtime')}: ${ot}${t('hour_abbr')}`)),
      h('p', { class: 'muted legend' }, t('legend')),
      ...(editWindow !== null ? [h('p', { class: 'muted' }, t('edit_window_note').replace('{n}', editWindow))] : []));
  }

  load();
  return root;
}
