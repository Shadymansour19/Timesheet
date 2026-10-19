import { h } from '../dom.js';
import { t, getLang } from '../i18n/index.js';
import { state } from '../auth/session.js';
import { cursor, shiftMonth, goToday, ymd, daysIn, fetchMonthData, effective } from '../api/timesheet.js';
import { fetchDeptPeople, fetchDepartment, setStatus, setStatusBulk, setOvertime, setHoliday } from '../api/admin.js';
import { explain } from '../api/errors.js';
import { openDialog } from '../components/dialog.js';
import { field } from '../components/form.js';
import { toast } from '../components/toast.js';

const fmt = (opts, date) => new Intl.DateTimeFormat(getLang() === 'ar' ? 'ar-u-nu-latn' : 'en', opts).format(date);

export function teamView() {
  const deptId = state.profile.department_id;
  const root = h('section', { class: 'team' });
  let people = [], data = null, dept = null;
  let mode = 'edit';                       // 'edit' | 'X' | 'Y' | 'E' | 'holiday'
  const rows = new Map();                  // user id -> <tr>
  let table;

  const key = (uid, day) => `${uid}|${day}`;
  const dayOf = (d) => ymd(cursor.y, cursor.m, d);
  const nDays = () => daysIn(cursor.y, cursor.m);
  const statusOf = (uid, day) => data.status.get(key(uid, day)) ?? 'E';
  const otOf = (uid, day) => data.overtime.get(key(uid, day))?.hours ?? 0;

  async function load() {
    root.replaceChildren(h('p', { class: 'muted center' }, t('loading')));
    try {
      [people, data, dept] = await Promise.all([fetchDeptPeople(deptId), fetchMonthData(cursor.y, cursor.m), fetchDepartment(deptId)]);
    } catch (e) { root.replaceChildren(h('p', { class: 'error' }, explain(e))); return; }
    draw();
  }

  function totals(uid) {
    const c = { X: 0, Y: 0, XH: 0, YH: 0, ot: 0 };
    for (let d = 1; d <= nDays(); d++) {
      const day = dayOf(d);
      const s = statusOf(uid, day);
      if (s !== 'E') c[effective(s, data.holidays.has(day))]++;
      c.ot += otOf(uid, day);
    }
    return c;
  }

  function buildRow(p) {
    const tr = h('tr', { 'data-u': p.id });
    tr.append(h('th', { class: 'nm', scope: 'row' }, h('span', {}, p.full_name), h('small', { class: 'muted' }, p.opr ?? '')));
    for (let d = 1; d <= nDays(); d++) {
      const day = dayOf(d);
      const eff = effective(statusOf(p.id, day), data.holidays.has(day));
      const ot = otOf(p.id, day);
      tr.append(h('td', { class: `c s-${eff.toLowerCase()}${data.holidays.has(day) ? ' holiday' : ''}`, 'data-u': p.id, 'data-d': day },
        eff, ot ? h('sup', {}, ot) : null));
    }
    const c = totals(p.id);
    for (const k of ['X', 'Y', 'XH', 'YH', 'ot']) tr.append(h('td', { class: 'tot' }, c[k] || ''));
    return tr;
  }

  const updateRow = (uid) => {
    const p = people.find((x) => x.id === uid);
    if (!p) return;
    const fresh = buildRow(p);
    rows.get(uid)?.replaceWith(fresh);
    rows.set(uid, fresh);
  };
  const updateAllRows = () => people.forEach((p) => updateRow(p.id));

  function setLocal(uid, day, status) {
    if (status === 'E') data.status.delete(key(uid, day)); else data.status.set(key(uid, day), status);
  }

  async function brush(uid, day, status) {
    if (statusOf(uid, day) === status) return;
    setLocal(uid, day, status); updateRow(uid);
    try { await setStatus(uid, day, status); }
    catch (e) { toast(explain(e)); await load(); }
  }

  async function toggleHoliday(day) {
    const on = !data.holidays.has(day);
    if (on) data.holidays.add(day); else data.holidays.delete(day);
    drawBody();
    try { await setHoliday(day, on); }
    catch (e) { toast(explain(e)); await load(); }
  }

  function openEditor(uid, day) {
    const p = people.find((x) => x.id === uid);
    const cur = statusOf(uid, day);
    const ot0 = data.overtime.get(key(uid, day));
    const radios = ['E', 'X', 'Y'].map((s) => h('label', { class: 'radio' },
      h('input', { type: 'radio', name: 'st', value: s, checked: s === cur }), h('span', { class: 'chip s-' + s.toLowerCase() }, s)));
    const hours = field(t('overtime_hours'), { type: 'number', min: 0, max: 24, step: 1, inputmode: 'numeric', value: ot0?.hours ?? 0 });
    const note = field(t('note'), { type: 'text', maxlength: 200, value: ot0?.note ?? '' });
    const content = h('div', { class: 'form' },
      h('p', { class: 'muted' }, `${p.full_name} · ${fmt({ weekday: 'long', day: 'numeric', month: 'long' }, new Date(day + 'T00:00:00'))}${data.holidays.has(day) ? ' · ' + t('holiday') : ''}`),
      h('div', { class: 'radios' }, radios), hours.row, note.row);
    openDialog({
      title: t('edit_day'), content,
      buttons: [{ label: t('cancel') }, { label: t('save'), kind: 'primary', onClick: async () => {
        const next = content.querySelector('input[name=st]:checked').value;
        const h2 = Number(hours.input.value);
        if (!Number.isInteger(h2) || h2 < 0 || h2 > 24) throw Object.assign(new Error(t('overtime_invalid')), { code: '22023' });
        const n2 = note.input.value.trim();
        const jobs = [];
        if (next !== cur) jobs.push(setStatus(uid, day, next));
        if (h2 !== (ot0?.hours ?? 0) || (h2 > 0 && n2 !== (ot0?.note ?? ''))) jobs.push(setOvertime(uid, day, h2, n2));
        await Promise.all(jobs);
        setLocal(uid, day, next);
        if (h2 === 0) data.overtime.delete(key(uid, day)); else data.overtime.set(key(uid, day), { hours: h2, note: n2 });
        updateRow(uid);
      } }],
    });
  }

  function openBulk() {
    const [first, last] = [dayOf(1), dayOf(nDays())];
    const all = h('input', { type: 'checkbox', checked: true, id: 'bulk-all' });
    const boxes = people.map((p) => h('input', { type: 'checkbox', checked: true, value: p.id }));
    all.addEventListener('change', () => boxes.forEach((b) => { b.checked = all.checked; }));
    const from = field(t('from'), { type: 'date', value: first, required: true });
    const to = field(t('to'), { type: 'date', value: last, required: true });
    const st = h('select', { id: 'bulk-status' }, ['X', 'Y', 'E'].map((s) => h('option', { value: s }, s)));
    const content = h('div', { class: 'form' },
      from.row, to.row, h('div', { class: 'field' }, h('label', { for: 'bulk-status' }, t('status')), st),
      h('label', { class: 'check strong' }, all, t('select_all')),
      h('div', { class: 'checklist' }, people.map((p, i) => h('label', { class: 'check' }, boxes[i], p.full_name))));
    openDialog({
      title: t('bulk_fill'), content,
      buttons: [{ label: t('cancel') }, { label: t('apply'), kind: 'primary', onClick: async () => {
        const users = boxes.filter((b) => b.checked).map((b) => b.value);
        const days = [];
        for (let d = new Date(from.input.value + 'T00:00:00'); d <= new Date(to.input.value + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
          days.push(ymd(d.getFullYear(), d.getMonth(), d.getDate()));
        }
        if (!users.length || !days.length) throw Object.assign(new Error(t('bulk_empty')), { code: '22023' });
        if (days.length > 366) throw Object.assign(new Error(t('bulk_too_big')), { code: '22023' });
        await setStatusBulk(users, days, st.value);
        await load();
        toast(t('bulk_done'), 'success');
      } }],
    });
  }

  function onClick(e) {
    const td = e.target.closest('td.c');
    if (td) {
      if (mode === 'edit') openEditor(td.dataset.u, td.dataset.d);
      else if (mode !== 'holiday') brush(td.dataset.u, td.dataset.d, mode);
      return;
    }
    const th = e.target.closest('th.dh');
    if (th && mode === 'holiday') toggleHoliday(th.dataset.d);
  }

  function drawBody() {
    rows.clear();
    const head = h('tr', {}, h('th', { class: 'nm' }, t('employee')));
    for (let d = 1; d <= nDays(); d++) {
      const day = dayOf(d);
      head.append(h('th', { class: 'dh' + (data.holidays.has(day) ? ' holiday' : '') + (mode === 'holiday' ? ' pick' : ''), 'data-d': day, scope: 'col' },
        h('span', {}, d), h('small', {}, fmt({ weekday: 'narrow' }, new Date(cursor.y, cursor.m, d)))));
    }
    for (const k of ['X', 'Y', 'XH', 'YH']) head.append(h('th', { class: 'tot' }, k));
    head.append(h('th', { class: 'tot' }, t('overtime_short')));
    const body = h('tbody', {});
    for (const p of people) { const tr = buildRow(p); rows.set(p.id, tr); body.append(tr); }
    table.replaceChildren(h('thead', {}, head), body);
  }

  async function doExport() {
    try {
      const { exportMonth } = await import('../export/engine.js');
      await exportMonth({ dept, people, data, year: cursor.y, month: cursor.m, lang: getLang() });
    } catch (e) { console.error(e); toast(t('export_failed')); }
  }

  function draw() {
    table = h('table', { class: 'tgrid' });
    table.addEventListener('click', onClick);
    drawBody();
    const go = (delta) => { shiftMonth(delta); load(); };
    const modes = [['edit', t('mode_edit')], ['X', 'X'], ['Y', 'Y'], ['E', 'E'], ['holiday', t('holiday')]];
    root.replaceChildren(
      h('div', { class: 'cal-head' },
        h('button', { class: 'btn small', onclick: () => go(-1), 'aria-label': t('prev_month') }, getLang() === 'ar' ? '›' : '‹'),
        h('h2', {}, `${dept?.name ?? ''} · ${fmt({ month: 'long', year: 'numeric' }, new Date(cursor.y, cursor.m, 1))}`),
        h('button', { class: 'btn small', onclick: () => go(1), 'aria-label': t('next_month') }, getLang() === 'ar' ? '‹' : '›'),
        h('button', { class: 'btn small', onclick: () => { goToday(); load(); } }, t('today'))),
      h('div', { class: 'toolbar' },
        h('div', { class: 'seg', role: 'group', 'aria-label': t('tap_mode') },
          modes.map(([m, label]) => h('button', { class: 'btn small' + (mode === m ? ' on' : ''), type: 'button', 'aria-pressed': String(mode === m),
            onclick: (ev) => { mode = m; ev.currentTarget.parentElement.querySelectorAll('button').forEach((b) => { const on = b === ev.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); drawBody(); } }, label))),
        h('button', { class: 'btn small', onclick: openBulk }, t('bulk_fill')),
        h('button', { class: 'btn small primary', onclick: doExport }, t('export_excel'))),
      h('p', { class: 'muted' }, t('team_hint')),
      h('div', { class: 'gridwrap' }, table),
      ...(people.length ? [] : [h('p', { class: 'muted' }, t('no_people'))]));
  }

  load();
  return root;
}
