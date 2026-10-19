// Pure helpers shared by the UI, the export and the Node tests (no DOM, no Supabase).

// Local calendar date as YYYY-MM-DD (never via toISOString: that shifts days across timezones).
export const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
export const monthRange = (y, m) => [ymd(y, m, 1), ymd(y, m, daysIn(y, m))];

// X/Y become XH/YH on a department holiday; E stays E. Holidays are derived, never stored on the row.
export const effective = (status, isHoliday) => (status === 'E' ? 'E' : isHoliday ? status + 'H' : status);
