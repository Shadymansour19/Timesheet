// Bulk fill dialog of the department grid: people, date range, status, with a live "N cells will change" preview.
// The grid does the local update / undo entry / redraw in onApplied(cells: [{ uid, day, prev, next }]).
import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { ymd, fetchRangeData } from '../api/timesheet.js';
import { setStatusRows } from '../api/admin.js';
import { openDialog } from './dialog.js';
import { field } from './form.js';
import { choice } from './choice.js';
import { toast } from './toast.js';

const key = (uid, day) => `${uid}|${day}`;

// people, days: what the grid shows; isCtx(day): the dimmed outer days; yOk(uid): may this person have Y; track(fn): the grid's write tracker
export function openBulkFill({ people, days, isCtx, yOk, track, onApplied }) {
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
      onApplied(p.rows.map((r) => ({ uid: r.user, day: r.day, prev: r.prev, next: r.status })));
    } }],
  });
}
