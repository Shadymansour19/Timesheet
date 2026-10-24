import { ymd, daysIn, effective, comparePeople } from '../lib/core.js';

// ---- Arrival / Departure rules (official report) -----------------------------------------------------------------
// Work day = status X or Y. Rest day = E (also "no record").
//   Arrival   : a work day whose PREVIOUS day is a rest day          (the previous day may be in the previous month)
//   Departure : by default the first REST day after a working period; the person / admin may move it onto the LAST WORKING DAY
//               (data.moves, see departureOf). The rule 'work-day' (old) puts it on the last working day always.
// Each Arrival / Departure counts as ONE trip: TRANS/IN when the person lives inside the work-location city, TRANS/EX when outside.
// NOTE: in the company's sample sheets the Departure mark sits on the first REST day after a work period ('rest-day').
// The written requirement says "the work day that has the next day E", which is the 'work-day' rule used here. Switch with this constant.
export const DEPARTURE_RULE = 'rest-day';   // 'rest-day' (default, with moves) | 'work-day'

// Where does a departure sit? 'rest' = on the first rest day after a working period (default); 'work' = on the last working day, when
// the person / admin moved it there (moves = the working days that carry it). null = not a departure day.
export function departureOf({ works, prevWorks, nextWorks, movedHere, movedPrev }) {
  if (!works && prevWorks && !movedPrev) return 'rest';
  if (works && !nextWorks && movedHere) return 'work';
  return null;
}

const shift = (y, m, d, n) => { const dt = new Date(Date.UTC(y, m, d + n)); return ymd(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()); };

// Normalised, template-independent view of one department-month.
// people: [{ id, full_name, username, payroll, level, job_title, contract_no, work_location, residence }]
// dept:   { name, code, sector, field, report }
// data:   { status: Map('user|day' -> 'X'|'Y'), overtime: Map('user|day' -> {hours, note}), holidays: Set(day) }
//         (status should also contain the day before the first and the day after the last day of the month, for Arrival / Departure)
export function buildModel({ dept, people, data, year, month, departureRule = DEPARTURE_RULE, sort = true }) {   // sort = false keeps the given order (layout tests)
  const days = [];
  for (let d = 1; d <= daysIn(year, month); d++) {
    const date = ymd(year, month, d);
    days.push({ day: d, date, weekday: new Date(year, month, d).getDay(), holiday: data.holidays.has(date) });
  }
  const employees = (sort ? [...people].sort(comparePeople) : people).map((p) => {
    const statusAt = (date) => data.status.get(`${p.id}|${date}`) ?? 'E';
    const outside = p.residence === 'outside';
    const cells = days.map((dy) => {
      const status = statusAt(dy.date);
      const works = status !== 'E';
      const prevWorks = statusAt(shift(year, month, dy.day, -1)) !== 'E';   // (the previous / next day may belong to the neighbouring month)
      const nextWorks = statusAt(shift(year, month, dy.day, 1)) !== 'E';
      const arrival = works && !prevWorks;
      const prevDate = shift(year, month, dy.day, -1);
      const dep = departureOf({ works, prevWorks, nextWorks, movedHere: data.moves?.has(`${p.id}|${dy.date}`), movedPrev: data.moves?.has(`${p.id}|${prevDate}`) });
      const departure = departureRule === 'rest-day' ? dep !== null : works && !nextWorks;
      const marks = [arrival && 'Arrival', departure && 'Departure'].filter(Boolean);
      const ov = data.overtime.get(`${p.id}|${dy.date}`);
      return {
        status, eff: effective(status, dy.holiday), ot: ov?.hours ?? 0, note: ov?.note ?? '',
        arrival, departure, trips: marks.length, tin: outside ? 0 : marks.length, tex: outside ? marks.length : 0,
        comment: [marks.join(' / '), ov?.note ?? ''].filter(Boolean).join(' - '),   // "Arrival", "Departure" or the overtime note (both: "Arrival - note")
      };
    });
    const totals = { X: 0, Y: 0, XH: 0, YH: 0, E: 0, ot: 0, tin: 0, tex: 0 };
    for (const c of cells) { totals[c.eff]++; totals.ot += c.ot; totals.tin += c.tin; totals.tex += c.tex; }
    return {
      id: p.id, fullName: p.full_name, username: p.username, payroll: p.payroll ?? '', level: p.level ?? '', cells, totals,
      jobTitle: p.job_title ?? '', contractNo: p.contract_no ?? '', workLocation: p.work_location ?? '', residence: p.residence ?? '', position: p.position ?? '',
      levelText: p.level === null || p.level === undefined || String(p.level).trim() === '' ? '' : /^\d+$/.test(String(p.level).trim()) ? `Level ${String(p.level).trim()}` : String(p.level).trim(),   // digits -> "Level 3"; any other text as typed
    };
  });
  return {
    department: dept?.name ?? '', report: dept?.report ?? {}, deptCode: dept?.code ?? '', sector: dept?.sector ?? '', field: dept?.field ?? '',
    approvedEngineer: dept?.approved_engineer ?? null, approvedTech: dept?.approved_tech ?? null,
    year, month, days, employees,
  };
}
