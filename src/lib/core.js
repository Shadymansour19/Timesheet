// Pure helpers shared by the UI, the export and the Node tests (no DOM, no Supabase).

// Local calendar date as YYYY-MM-DD (never via toISOString: that shifts days across timezones).
export const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
export const monthRange = (y, m) => [ymd(y, m, 1), ymd(y, m, daysIn(y, m))];

// X/Y become XH/YH on a department holiday; E stays E. Holidays are derived, never stored on the row.
export const effective = (status, isHoliday) => (status === 'E' ? 'E' : isHoliday ? status + 'H' : status);

// First day of the week in calendars: 0 = Sunday. Change here if the company week starts on another day.
export const WEEK_START = 0;

// True when two fetchRangeData() results hold exactly the same values (used to skip redraws after a live refetch).
export function sameData(a, b) {
  if (a.status.size !== b.status.size || a.overtime.size !== b.overtime.size || a.holidays.size !== b.holidays.size) return false;
  for (const [k, v] of a.status) if (b.status.get(k) !== v) return false;
  for (const [k, v] of a.overtime) { const o = b.overtime.get(k); if (!o || o.hours !== v.hours || (o.note ?? '') !== (v.note ?? '')) return false; }
  for (const d of a.holidays) if (!b.holidays.has(d)) return false;
  return true;
}

