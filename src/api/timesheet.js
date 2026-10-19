import { supabase } from '../supabase.js';

// Local calendar date as YYYY-MM-DD (never via toISOString: that shifts days across timezones).
export const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();

// One round-trip: status, holiday-aware status and overtime for every visible person in the month.
// Returns { [day]: { status, eff, ot, hol } } for the given user.
export async function fetchMonth(userId, year, month) {
  const { data, error } = await supabase.rpc('get_timesheet', {
    p_dept: null, p_from: ymd(year, month, 1), p_to: ymd(year, month, daysIn(year, month)),
  });
  if (error) throw error;
  const byDay = {};
  for (const r of data) if (r.user_id === userId) byDay[r.day] = { status: r.status, eff: r.effective_status, ot: r.overtime_hours, hol: r.is_holiday };
  return byDay;
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
