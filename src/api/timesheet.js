import { supabase } from '../supabase.js';

import { ymd, daysIn, monthRange, effective } from '../lib/core.js';
export { ymd, daysIn, monthRange, effective };

// Month shown by the calendar and the department grid (shared so switching views keeps the month).
export const cursor = (() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; })();
export function shiftMonth(delta) { const n = new Date(cursor.y, cursor.m + delta, 1); cursor.y = n.getFullYear(); cursor.m = n.getMonth(); }
export function goToday() { const n = new Date(); cursor.y = n.getFullYear(); cursor.m = n.getMonth(); }

// PostgREST returns at most 1000 rows per request, so large reads must be paged.
const PAGE = 1000;
export async function fetchAll(make) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < PAGE) return out;
  }
}

// Sparse data for a date range visible to the caller (RLS decides whose): missing key = E / no overtime.
// status: Map 'user|day' -> 'X'|'Y'   overtime: Map 'user|day' -> {hours, note}   holidays: Set of days
export async function fetchRangeData(from, to, { userId } = {}) {
  const q = (table, cols) => () => {
    let b = supabase.from(table).select(cols).gte('day', from).lte('day', to).order('user_id').order('day');
    if (userId) b = b.eq('user_id', userId);
    return b;
  };
  const [st, ot, hol, mv] = await Promise.all([
    fetchAll(q('day_status', 'user_id,day,status')),
    fetchAll(q('overtime', 'user_id,day,hours,note')),
    fetchAll(() => supabase.from('holidays').select('day').gte('day', from).lte('day', to).order('day')),
    fetchAll(() => { let b = supabase.from('departure_moves').select('user_id,work_day').gte('work_day', from).lte('work_day', to).order('user_id').order('work_day'); if (userId) b = b.eq('user_id', userId); return b; }),
  ]);
  return {
    status: new Map(st.map((r) => [`${r.user_id}|${r.day}`, r.status])),
    overtime: new Map(ot.map((r) => [`${r.user_id}|${r.day}`, { hours: r.hours, note: r.note }])),
    holidays: new Set(hol.map((r) => r.day)),
    moves: new Set(mv.map((r) => `${r.user_id}|${r.work_day}`)),          // departures moved onto their last working day (key = that working day)
  };
}
export const fetchMonthData = (y, m, opts) => { const [from, to] = monthRange(y, m); return fetchRangeData(from, to, opts); };

// One person's month for the calendar: { [day]: { status, eff, ot, note, hol } }
// -> { byDay, prev, next, moves }: prev / next = the last day of the previous month and the first day of the next month (shown dimmed so the
// working blocks look continuous and Arrival / Departure are right); moves = Set of working days that carry their departure.
export async function fetchMonth(userId, y, m) {
  const iso = (dt) => ymd(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const prevDate = iso(new Date(y, m, 0)), nextDate = iso(new Date(y, m + 1, 1));
  const prev2 = iso(new Date(y, m, -1)), next2 = iso(new Date(y, m + 1, 2));       // one more day each side: the neighbours of the two outer days (so their departure tag is right)
  const d = await fetchRangeData(prev2, next2, { userId });
  const rec = (day, ctx) => {
    const status = d.status.get(`${userId}|${day}`) ?? 'E';
    const hol = d.holidays.has(day);
    return { status, eff: effective(status, hol), ot: d.overtime.get(`${userId}|${day}`)?.hours ?? 0, note: d.overtime.get(`${userId}|${day}`)?.note ?? '', hol, ...(ctx ? { ctx: true } : {}) };
  };
  const byDay = {};
  byDay[prev2] = { ...rec(prev2, true), outer: true }; byDay[next2] = { ...rec(next2, true), outer: true };
  byDay[prevDate] = rec(prevDate, true);                       // the day before and the day after the month are editable like the month days (ctx = not part of the month's totals)
  for (let i = 1; i <= daysIn(y, m); i++) { const day = ymd(y, m, i); byDay[day] = rec(day, false); }
  byDay[nextDate] = rec(nextDate, true);
  return { byDay, moves: new Set([...d.moves].filter((k) => k.startsWith(userId + '|')).map((k) => k.slice(userId.length + 1))) };
}

export async function setDepartureMove(userId, day, on) {
  const { error } = await supabase.rpc('set_departure_move', { p_user: userId, p_day: day, p_on: on });
  if (error) throw error;
}

// null = unlimited; N = users may edit days >= today - N (enforced server-side; UI just mirrors it).
export async function fetchEditWindow() {
  const { data } = await supabase.from('settings').select('value').eq('key', 'user_edit_window_days').maybeSingle();
  return typeof data?.value === 'number' ? data.value : null;
}

export async function setDayStatus(userId, day, status) {
  const { error } = await supabase.rpc('set_day_status', { p_user: userId, p_day: day, p_status: status });
  if (error) throw error;
}

// Month plus the day before and the day after (the report marks Arrival / Departure from the neighbouring days).
export const fetchPaddedMonthData = (y, m, opts) => fetchRangeData(shiftDay(y, m, 1, -1), shiftDay(y, m, daysIn(y, m), 1), opts);
function shiftDay(y, m, d, delta) { const n = new Date(y, m, d + delta); return ymd(n.getFullYear(), n.getMonth(), n.getDate()); }
