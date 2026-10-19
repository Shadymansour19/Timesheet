import { ymd, daysIn, effective } from '../lib/core.js';

// Normalised, template-independent view of one department-month.
// people: [{ id, full_name, username, opr, level, role }]
// data:   { status: Map('user|day' -> 'X'|'Y'), overtime: Map('user|day' -> {hours}), holidays: Set(day) }
export function buildModel({ dept, people, data, year, month }) {
  const days = [];
  for (let d = 1; d <= daysIn(year, month); d++) {
    const date = ymd(year, month, d);
    days.push({ day: d, date, weekday: new Date(year, month, d).getDay(), holiday: data.holidays.has(date) });
  }
  const employees = people.map((p) => {
    const cells = days.map((dy) => {
      const status = data.status.get(`${p.id}|${dy.date}`) ?? 'E';
      return { status, eff: effective(status, dy.holiday), ot: data.overtime.get(`${p.id}|${dy.date}`)?.hours ?? 0 };
    });
    const totals = { X: 0, Y: 0, XH: 0, YH: 0, E: 0, ot: 0 };
    for (const c of cells) { totals[c.eff]++; totals.ot += c.ot; }
    return { id: p.id, fullName: p.full_name, username: p.username, opr: p.opr ?? '', level: p.level ?? '', cells, totals };
  });
  return { department: dept?.name ?? '', year, month, days, employees };
}
