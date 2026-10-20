// The company's official monthly report: day sheets (1, 2, 3 ...), one sheet per employee, a review sheet and an overtime summary.
// Captions, titles, manpower line and sign-offs are fixed by the form; only the department name, code, sector, field,
// printed name and site location vary (see "Report settings"). The values below are the form's constants / defaults.
export default {
  id: 'official',
  mode: 'official',
  label: 'Official monthly report',
  logoBase: '/templates/logo',          // public/templates/logo-left.png (EMC) and logo-right.png (Burullus)
  constants: {
    manpower: 'EMC MANPOWER',
    banner1: 'Rashid Petroleum & BURULLUS Gas Company',
    defaultField: 'Operations [Fields]',
    defaultSector: 'Maintenance Sector',
    captionLeft: 'Egyptian Maintenance Company',
    captionRight: 'Burullus Gas Company',
    overtimeSignoffMiddle: 'Maintenance GM',
    overtimeSignoffRight: 'DFGM',
  },
};
