// Example of 'fill' mode: write into an existing .xlsx supplied by the company (the official form).
// Copy this file, point `source` at the form and adjust the cell mapping. Columns are letters, rows are numbers.
export default {
  id: 'example-fill',
  mode: 'fill',
  source: '/templates/official.xlsx',   // served from public/templates/
  sheet: 1,                              // sheet index (1-based) or name
  cells: { department: 'C2', month: 'C3' },
  firstEmployeeRow: 8,
  columns: { no: 'A', name: 'B', opr: 'C', level: 'D' },
  firstDayColumn: 'E',                   // day 1; later days follow to the right
  dayValue: 'eff',                       // 'eff' = X/Y/XH/YH/E, 'status' = X/Y/E
  totals: { X: 'AJ', Y: 'AK', XH: 'AL', YH: 'AM', ot: 'AN' },
};
