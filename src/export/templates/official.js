// The company's official monthly report: day sheets (1, 2, 3 ...), one sheet per employee, and a review sheet.
// Everything department-specific (department code, printed name, location, banner lines, sign-offs) comes from the
// department's "Report settings"; the values below are only the defaults used when a setting is empty.
export default {
  id: 'official',
  mode: 'official',
  label: 'Official monthly report (days, employees, review)',
  logoBase: '/templates/logo',          // optional: public/templates/logo-left.png and logo-right.png are placed in the banners if present
  defaults: {
    manpower: 'EMC MANPOWER',
    banner: ['Rashid Petroleum & BURULLUS Gas Company', 'Operations [Fields]', 'Maintenance Sector'],
    companyLeft: 'Egyptian Maintenance Company',
    companyRight: 'Burullus Gas Company',
  },
};
