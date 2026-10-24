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



// Click / Enter cycle of a day: E -> X -> Y -> E; a person who may not have Y goes E -> X -> E.
export const nextStatus = (cur, yAllowed = true) => (cur === 'E' ? 'X' : cur === 'X' ? (yAllowed ? 'Y' : 'E') : 'E');

// Order of people everywhere (pages and exports): by POSITION - engineers first, then techs, then every other position; inside the same
// position by PAYROLL NUMBER as a number (EMC-95 before EMC-1000; no number = last), then payroll text, then name. The job title is not used.
const group = (p) => { const s = `${p.position ?? ''}`; return /engineer/i.test(s) ? 0 : /tech/i.test(s) ? 1 : 2; };
const payrollNo = (p) => { const m = /\d+/.exec(String(p.payroll ?? '')); return m ? Number(m[0]) : Infinity; };
export function comparePeople(a, b) {
  return group(a) - group(b)
    || String(a.position ?? '').trim().localeCompare(String(b.position ?? '').trim(), 'en', { sensitivity: 'base' })
    || (payrollNo(a) === payrollNo(b) ? 0 : payrollNo(a) < payrollNo(b) ? -1 : 1)
    || String(a.payroll ?? '').localeCompare(String(b.payroll ?? ''), 'en')
    || String(a.full_name ?? '').localeCompare(String(b.full_name ?? ''));
}
