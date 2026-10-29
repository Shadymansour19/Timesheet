import { h } from '../dom.js';
import { t, getLang } from '../i18n/index.js';
import { state, myDept } from '../auth/session.js';
import { cursor, shiftMonth, goToday, ymd, daysIn, fetchMonthData } from '../api/timesheet.js';
import { WEEK_START } from '../lib/core.js';
import { fetchTimesheetPeople, setOvertimeBulk, fetchDepartment } from '../api/admin.js';
import { explain } from '../api/errors.js';
import { openDialog } from '../components/dialog.js';
import { icon, PRINT, DOWNLOAD, SCAN } from '../components/icons.js';
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
  const RO = state.profile.role === 'super_manager';       // read-only (the database refuses the writes as well)
  const deptId = myDept();
  const root = h('section', { class: 'cal ot-view' });
  let people = [], data = null;
  const todayStr = (() => { const n = new Date(); return ymd(n.getFullYear(), n.getMonth(), n.getDate()); })();

  async function load({ quiet = false } = {}) {
    if (!quiet) root.replaceChildren(h('p', { class: 'muted center' }, t('loading')));
    let p, d;
    try { [p, d] = await Promise.all([fetchTimesheetPeople(deptId), fetchMonthData(cursor.y, cursor.m)]); }
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

  // The overtime form of some days (see export/overtime-form.js): print, or download as Excel / PDF. `overtime`: what goes on the form (Map `uid|day` -> { hours, note }),
  // `stem` the end of the file name. Open to everyone who sees this tab (also the read-only super manager).
  async function makeForm(kind, { overtime, days, stem }) {
    try {
      const [engine, dept] = await Promise.all([import('../export/engine.js'), fetchDepartment(deptId)]);
      const args = { dept: dept ?? { name: '' }, people, overtime, days };
      if (kind === 'print') await engine.printOvertimeForm({ ...args, title: `${dept?.name ?? ''} ${stem}`.trim() });
      else await engine.exportOvertimeForm({ ...args, format: kind, name: `overtime_${(dept?.name ?? 'department').replace(/[^\p{L}\p{N}_-]+/gu, '_')}_${stem}` });
    } catch (e) {
      console.error('overtime form failed', e);
      toast(e?.code === 'NO_OVERTIME' ? t('ot_form_none') : kind === 'print' ? t('print_failed') : explain(e));
    }
  }
  // Print / Excel / PDF buttons; `get()` -> { overtime, days, stem } or null (nothing to do, it has told the user why)
  // compact (the tab): a print icon and ONE download icon whose menu holds Excel and PDF (with the note that the PDF is a picture); otherwise (the day window): labelled buttons
  const formTools = (prefix, get, { compact = false } = {}) => {
    const run = async (b, kind) => { const a = get(); if (!a) return; b.disabled = true; try { await makeForm(kind, a); } finally { b.disabled = false; } };
    if (!compact) {
      return h('div', { class: 'ot-form-tools', role: 'group', 'aria-label': t('ot_form') },
        h('span', { class: 'muted' }, t('ot_form')),
        [['print', t('print'), t('ot_print_hint')], ['xlsx', t('export_fmt_xlsx_one')], ['pdf', t('export_fmt_pdf_one'), t('ot_pdf_hint')]].map(([kind, label, hint]) => h('button', { type: 'button', class: 'btn small', id: `${prefix}-${kind}`, ...(hint ? { title: hint } : {}),
          onclick: (e) => run(e.currentTarget, kind) }, label)),
        h('small', { class: 'muted ot-form-hint' }, t('ot_pdf_hint')));          // visible, not only a tooltip: tooltips are slow, and missing on touch screens
    }
    const toggle = h('button', { type: 'button', class: 'btn small icon-only', id: `${prefix}-export`, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': t('export'), title: t('export') }, icon(DOWNLOAD, 18));
    const menu = h('div', { class: 'ot-export-menu', role: 'menu', hidden: true },
      [['xlsx', t('export_fmt_xlsx_one')], ['pdf', t('export_fmt_pdf_one')]].map(([kind, label]) => h('button', { type: 'button', class: 'menu-item', role: 'menuitem', id: `${prefix}-${kind}`, onclick: (e) => { close(); run(e.currentTarget, kind); } }, label)),
      h('small', { class: 'muted ot-form-hint' }, t('ot_pdf_hint')));
    const outside = (e) => { if (!wrap.contains(e.target)) close(); }, esc = (e) => { if (e.key === 'Escape') { close(); toggle.focus(); } };
    function close() { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc); }
    toggle.addEventListener('click', () => {
      if (!menu.hidden) return close();
      menu.hidden = false; toggle.setAttribute('aria-expanded', 'true'); document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', esc);
    });
    const wrap = h('div', { class: 'ot-export' }, toggle, menu);
    return h('div', { class: 'ot-form-tools', role: 'group', 'aria-label': t('ot_form') },
      h('button', { type: 'button', class: 'btn small icon-only', id: `${prefix}-print`, 'aria-label': t('print'), title: `${t('print')}: ${t('ot_print_hint')}`, onclick: (e) => run(e.currentTarget, 'print') }, icon(PRINT, 18)),
      wrap);
  };

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
    if (RO) for (const r of rows) { r.hours.disabled = true; r.note.disabled = true; }
    refresh();

    const date = new Date(day + 'T00:00:00');
    const content = h('div', { class: 'form' },
      data.holidays.has(day) ? h('p', { class: 'muted' }, t('holiday')) : null,
      h('div', { class: 'ot-tools' }, search, h('label', { class: 'check' }, only, t('only_with_overtime'))),
      h('div', { class: 'otlist' }, rows.map((r) => r.el)),
      totalEl,
      formTools('otd', () => {                                          // the form shows what is in the window now (saved or not)
        if (rows.some((r) => parse(r) === null)) { toast(t('overtime_invalid')); return null; }
        const overtime = new Map(rows.filter((r) => parse(r) > 0).map((r) => [key(r.p.id, day), { hours: parse(r), note: r.note.value.trim() }]));
        return { overtime, days: [day], stem: day };
      }));

    openDialog({
      wide: true,
      autofocus: false,                       // keep the phone keyboard closed until the admin taps a field
      title: `${t('nav_overtime')} · ${fmt({ weekday: 'long', day: 'numeric', month: 'long' }, date)}`,
      content,
      buttons: RO ? [{ label: t('close') }] : [{ label: t('cancel') }, { label: t('save'), kind: 'primary', onClick: async () => {
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
      h('div', { class: 'cal-tools' },
        formTools('ot', () => ({ overtime: data.overtime, days: Array.from({ length: daysIn(cursor.y, cursor.m) }, (_, i) => ymd(cursor.y, cursor.m, i + 1)), stem: ymd(cursor.y, cursor.m, 1).slice(0, 7) }), { compact: true }),
        RO ? null : h('button', { type: 'button', class: 'btn small', id: 'scan-open', 'aria-label': t('scan_open'), title: t('scan_open'), onclick: () => import('../components/overtime-scan.js').then((m) => m.openOvertimeScan({ people, onSaved: () => load() })) }, icon(SCAN, 16), t('scan_short'))),
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
