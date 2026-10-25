import { h } from '../dom.js';
import { t, getLang } from '../i18n/index.js';
import { state, myDept } from '../auth/session.js';
import { cursor, shiftMonth, goToday, ymd, daysIn, fetchMonthData } from '../api/timesheet.js';
import { WEEK_START } from '../lib/core.js';
import { fetchDeptPeople, setOvertimeBulk } from '../api/admin.js';
import { explain } from '../api/errors.js';
import { openDialog } from '../components/dialog.js';
import { toast } from '../components/toast.js';
import * as live from '../live.js';
import { sameData } from '../lib/core.js';
import { monthRange } from '../api/timesheet.js';
import { monthHead } from '../components/month-head.js';

const fmt = (opts, date) => new Intl.DateTimeFormat(getLang() === 'ar' ? 'ar-u-nu-latn' : 'en', opts).format(date);
const key = (uid, day) => `${uid}|${day}`;

// Department overtime: a month grid like the user calendar, but each day shows the TOTAL for all employees;
// tapping a day opens a dialog to add / edit overtime (hours + note) for every employee on that day.
export function overtimeView() {
  const deptId = myDept();
  const root = h('section', { class: 'cal ot-view' });
  let people = [], data = null;
  const todayStr = (() => { const n = new Date(); return ymd(n.getFullYear(), n.getMonth(), n.getDate()); })();

  async function load({ quiet = false } = {}) {
    if (!quiet) root.replaceChildren(h('p', { class: 'muted center' }, t('loading')));
    let p, d;
    try { [p, d] = await Promise.all([fetchDeptPeople(deptId), fetchMonthData(cursor.y, cursor.m)]); }
    catch (e) { if (!quiet) root.replaceChildren(h('p', { class: 'error' }, explain(e))); return; }
    if (quiet && data && sameData(data, d) && JSON.stringify(p.map((x) => x.id)) === JSON.stringify(people.map((x) => x.id))) return;   // nothing new
    people = p; data = d;
    draw();
  }

  // live: another admin changed overtime / holidays / people -> refetch quietly
  let liveTimer;
  live.watch([`dept:${deptId}`, `deptpub:${deptId}`], (p) => {
    if (p.t === 'profile') return;
    if (p.t !== 'resync' && p.t !== 'profiles') { const [a, b] = monthRange(cursor.y, cursor.m); if (p.to < a || p.from > b) return; }
    clearTimeout(liveTimer); liveTimer = setTimeout(() => load({ quiet: true }), 350);
  });

  // day -> { hours, n } over the department's current employees
  function dayTotals() {
    const ids = new Set(people.map((p) => p.id));
    const m = new Map();
    for (const [k, v] of data.overtime) {
      const [uid, day] = k.split('|');
      if (!ids.has(uid) || !v.hours) continue;
      const e = m.get(day) ?? { hours: 0, n: 0 };
      e.hours += v.hours; e.n++;
      m.set(day, e);
    }
    return m;
  }

  function openDay(day) {
    const parse = (r) => { const raw = r.hours.value.trim(); if (raw === '') return 0; const n = Number(raw); return Number.isInteger(n) && n >= 0 && n <= 24 ? n : null; };
    const rows = people.map((p) => {
      const cur = data.overtime.get(key(p.id, day));
      const hours = h('input', { type: 'number', min: 0, max: 24, step: 1, inputmode: 'numeric', class: 'ot-hours', value: cur?.hours ?? '', placeholder: '0', 'aria-label': `${t('overtime_hours_short')}: ${p.full_name}` });
      const note = h('input', { type: 'text', maxlength: 200, class: 'ot-note', value: cur?.note ?? '', placeholder: t('note'), 'aria-label': `${t('note')}: ${p.full_name}` });
      const el = h('div', { class: 'otrow' }, h('div', { class: 'otname' }, h('strong', {}, p.full_name), h('small', { class: 'muted' }, (p.payroll ?? ''))), hours, note);
      return { p, cur, hours, note, el, search: `${p.full_name} ${p.payroll ?? ''} ${p.opr ?? ''} ${p.username}`.toLowerCase() };
    });

    const search = h('input', { type: 'search', class: 'ot-search', placeholder: t('search_people'), 'aria-label': t('search_people') });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });   // Enter must not submit the dialog
    const only = h('input', { type: 'checkbox' });
    const totalEl = h('p', { class: 'ot-total', 'aria-live': 'polite' });

    function refresh() {
      const q = search.value.trim().toLowerCase();
      let sum = 0, n = 0;
      for (const r of rows) {
        const hrs = parse(r);
        if (hrs) { sum += hrs; n++; }
        r.note.hidden = !(hrs > 0 || r.note.value !== '');           // note field appears once there are hours
        r.el.classList.toggle('invalid', hrs === null);
        r.el.classList.toggle('has', hrs > 0);
        r.el.hidden = !(r.search.includes(q) && (!only.checked || hrs === null || hrs > 0));
      }
      totalEl.textContent = `${t('ot_total')}: ${sum}${t('hour_abbr')} · ${n} ${t('people')}`;
    }
    for (const r of rows) { r.hours.addEventListener('input', refresh); r.note.addEventListener('input', refresh); }
    search.addEventListener('input', refresh); only.addEventListener('change', refresh);
    refresh();

    const date = new Date(day + 'T00:00:00');
    const content = h('div', { class: 'form' },
      data.holidays.has(day) ? h('p', { class: 'muted' }, t('holiday')) : null,
      h('div', { class: 'ot-tools' }, search, h('label', { class: 'check' }, only, t('only_with_overtime'))),
      h('div', { class: 'otlist' }, rows.map((r) => r.el)),
      totalEl);

    openDialog({
      wide: true,
      autofocus: false,                       // keep the phone keyboard closed until the admin taps a field
      title: `${t('nav_overtime')} · ${fmt({ weekday: 'long', day: 'numeric', month: 'long' }, date)}`,
      content,
      buttons: [{ label: t('cancel') }, { label: t('save'), kind: 'primary', onClick: async () => {
        const bad = rows.find((r) => parse(r) === null);
        if (bad) {
          bad.el.hidden = false; bad.el.scrollIntoView({ block: 'center' }); bad.hours.focus();
          throw Object.assign(new Error(t('overtime_invalid')), { code: '22023' });
        }
        const changes = [];
        for (const r of rows) {
          const hrs = parse(r), note = hrs > 0 ? r.note.value.trim() : '';
          const was = r.cur?.hours ?? 0, wasNote = r.cur?.note ?? '';
          if (hrs !== was || (hrs > 0 && note !== wasNote)) changes.push({ user: r.p.id, hours: hrs, note: note || null });
        }
        if (!changes.length) return;
        await setOvertimeBulk(day, changes);                          // atomic: all rows or none
        for (const c of changes) {
          if (c.hours === 0) data.overtime.delete(key(c.user, day));
          else data.overtime.set(key(c.user, day), { hours: c.hours, note: c.note });
        }
        draw();
        toast(t('saved'), 'success');
      } }],
    });
  }

  function draw() {
    const totals = dayTotals();
    const first = new Date(cursor.y, cursor.m, 1);
    const lead = (first.getDay() - WEEK_START + 7) % 7;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'pad' }));
    for (let d = 1; d <= daysIn(cursor.y, cursor.m); d++) {
      const day = ymd(cursor.y, cursor.m, d);
      const tt = totals.get(day);
      const label = `${fmt({ weekday: 'long', day: 'numeric', month: 'long' }, new Date(cursor.y, cursor.m, d))}: ${tt ? `${tt.hours}${t('hour_abbr')}, ${tt.n} ${t('people')}` : '–'}`;
      cells.push(h('button', { type: 'button', 'aria-label': label, onclick: () => openDay(day),
        class: ['day', 'ot-day', tt ? 'has-ot' : '', data.holidays.has(day) ? 'holiday' : '', day === todayStr ? 'today' : ''].join(' ') },
        h('span', { class: 'num' }, d),
        h('span', { class: 'st' }, tt ? `${tt.hours}${t('hour_abbr')}` : '–'),
        tt ? h('span', { class: 'ot' }, `${tt.n} ${t('people')}`) : null));
    }
    const weekdays = [...Array(7)].map((_, i) => h('span', { class: 'wd' }, fmt({ weekday: 'short' }, new Date(2023, 0, 1 + ((i + WEEK_START) % 7)))));
    const sum = [...totals.values()].reduce((a, v) => a + v.hours, 0);
    const people_n = new Set([...data.overtime].filter(([k, v]) => v.hours && people.some((p) => k.startsWith(p.id + '|'))).map(([k]) => k.split('|')[0])).size;
    const go = (delta) => { shiftMonth(delta); load(); };

    root.replaceChildren(
      monthHead(fmt({ month: 'long', year: 'numeric' }, first), { onPrev: () => go(-1), onNext: () => go(1), onToday: () => { goToday(); load(); } }),
      h('div', { class: 'cal-tools' }, h('button', { type: 'button', class: 'btn small', id: 'scan-open', onclick: () => import('../components/overtime-scan.js').then((m) => m.openOvertimeScan({ people, onSaved: () => load() })) }, t('scan_open'))),
      h('div', { class: 'grid' }, weekdays, cells),
      h('div', { class: 'totals' },
        h('span', { class: 'chip ot' }, `${t('ot_total')}: ${sum}${t('hour_abbr')}`),
        h('span', { class: 'chip' }, `${totals.size} ${t('days_with_overtime')}`),
        h('span', { class: 'chip' }, `${people_n} ${t('people')}`)),
      h('p', { class: 'muted legend' }, t('ot_hint')));
  }

  load();
  return root;
}
