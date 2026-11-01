const works = (status) => status !== 'E';

const departure = ({ worksToday, worksPrevious, worksNext, movedToday, movedPrevious }) =>
  (!worksToday && worksPrevious && !movedPrevious) || (worksToday && !worksNext && movedToday);

const numeric = (value) => Number(value) || 0;

// Calculate pay from calendar data. `days` may include ctx days around the month; those days help
// determine boundary trips but are excluded from the monthly paid-day and overtime totals.
export function calculateMonthlyPay({ days, rates, moves = new Set() }) {
  const monthDates = Object.keys(days).filter((date) => !days[date]?.ctx).sort();
  const statusAt = (date) => days[date]?.status ?? 'E';
  const movedAt = (date) => moves.has(date);
  let xDays = 0, yDays = 0, xhDays = 0, yhDays = 0, overtimeHours = 0, trips = 0;

  for (const date of monthDates) {
    const current = days[date] ?? {};
    const currentWorks = works(current.status ?? 'E');
    const previousWorks = works(statusAt(addDays(date, -1)));
    const nextWorks = works(statusAt(addDays(date, 1)));
    const arrival = currentWorks && !previousWorks;
    const hasDeparture = departure({
      worksToday: currentWorks,
      worksPrevious: previousWorks,
      worksNext: nextWorks,
      movedToday: movedAt(date),
      movedPrevious: movedAt(addDays(date, -1)),
    });

    if (current.status === 'X') {
      if (current.hol) xhDays++;
      else xDays++;
    }
    if (current.status === 'Y') {
      if (current.hol) yhDays++;
      else yDays++;
    }
    
    overtimeHours += numeric(current.ot);
    trips += Number(arrival) + Number(hasDeparture);
  }

  const xPay = xDays * numeric(rates.xPayRate ?? rates.x_pay_rate);
  const yPay = yDays * numeric(rates.yPayRate ?? rates.y_pay_rate);
  const xhPay = xhDays * 2 * numeric(rates.xPayRate ?? rates.x_pay_rate);
  const yhPay = yhDays * 2 * numeric(rates.yPayRate ?? rates.y_pay_rate);
  const tripPay = trips * numeric(rates.tripPayRate ?? rates.trip_pay_rate);
  const overtimePay = overtimeHours * numeric(rates.overtimeHourRate ?? rates.overtime_hour_rate);

  return {
    xDays,
    yDays,
    xhDays,
    yhDays,
    trips,
    overtimeHours,
    xRate: numeric(rates.xPayRate ?? rates.x_pay_rate),
    xhRate: numeric(rates.xPayRate ?? rates.x_pay_rate) * 2,
    yRate: numeric(rates.yPayRate ?? rates.y_pay_rate),
    yhRate: numeric(rates.yPayRate ?? rates.y_pay_rate) * 2,
    tripRate: numeric(rates.tripPayRate ?? rates.trip_pay_rate),
    overtimeRate: numeric(rates.overtimeHourRate ?? rates.overtime_hour_rate),
    xPay,
    yPay,
    xhPay,
    yhPay,
    tripPay,
    overtimePay,
    total: xPay + yPay + xhPay + yhPay + tripPay + overtimePay,
  };
}

function addDays(date, amount) {
  const dt = new Date(`${date}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + amount);
  return dt.toISOString().slice(0, 10);
}
