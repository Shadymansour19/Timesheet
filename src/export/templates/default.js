// Default layout. A template is plain data + small functions; the engine (../engine.js) does the writing.
// To support the official form later, add another file here (mode 'fill' maps cells of a supplied .xlsx,
// see ./example-fill.js) and select it in src/export/index.js. Nothing else changes.

export default {
  id: 'default',
  mode: 'generate',
  labels: {
    en: { title: 'Monthly timesheet', department: 'Department', month: 'Month', no: '#', name: 'Employee', opr: 'Payroll', level: 'Level',
      ot: 'Overtime (h)', legend: 'X = normal work   Y = operation   E = no work   XH / YH = X / Y on a holiday' },
    ar: { title: 'سجل الدوام الشهري', department: 'القسم', month: 'الشهر', no: 'م', name: 'الموظف', opr: 'الرقم الوظيفي', level: 'المستوى',
      ot: 'ساعات إضافية', legend: 'X = عمل عادي   Y = وردية   E = بدون عمل   XH / YH = X / Y في يوم عطلة' },
  },
  sheetName: (m) => `${m.year}-${String(m.month + 1).padStart(2, '0')}`,
  // Fixed columns before the day columns.
  columns: [
    { key: 'no', header: (l) => l.no, width: 5, value: (_e, i) => i + 1 },
    { key: 'name', header: (l) => l.name, width: 28, value: (e) => e.fullName },
    { key: 'payroll', header: (l) => l.opr, width: 12, value: (e) => e.payroll },
    { key: 'level', header: (l) => l.level, width: 8, value: (e) => e.level },
  ],
  dayWidth: 4.5,
  // Totals after the day columns. COUNTIF formulas keep the sheet live; the engine also stores the result.
  totals: [
    { key: 'X', header: () => 'X', width: 5, count: 'X' },
    { key: 'Y', header: () => 'Y', width: 5, count: 'Y' },
    { key: 'XH', header: () => 'XH', width: 5, count: 'XH' },
    { key: 'YH', header: () => 'YH', width: 5, count: 'YH' },
    { key: 'ot', header: (l) => l.ot, width: 12, sum: 'ot' },
  ],
  colors: { X: 'FFD1FAE5', Y: 'FFDBEAFE', XH: 'FF6EE7B7', YH: 'FF93C5FD', E: 'FFF3F4F6', header: 'FF0F766E', holidayHeader: 'FFF59E0B' },
};
