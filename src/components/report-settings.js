import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { openDialog } from './dialog.js';
import { field } from './form.js';
import { setDepartmentReport } from '../api/admin.js';
import { toast } from './toast.js';

// Department print settings for the official monthly report. Empty fields fall back to defaults when exporting.
const FIELDS = [
  ['dept_title', 'rs_dept_title', (d) => `${d.name} Dept.`],
  ['dept_code', 'rs_dept_code', () => '19'],
  ['dept_print_name', 'rs_dept_print_name', (d) => d.name.toUpperCase()],
  ['location', 'rs_location', () => 'IDKU Site'],
  ['manpower', 'rs_manpower', () => 'EMC MANPOWER'],
  ['banner_1', 'rs_banner_1', () => 'Rashid Petroleum & BURULLUS Gas Company'],
  ['banner_2', 'rs_banner_2', () => 'Operations [Fields]'],
  ['banner_3', 'rs_banner_3', () => 'Maintenance Sector'],
  ['company_left', 'rs_company_left', () => 'Egyptian Maintenance Company'],
  ['company_right', 'rs_company_right', () => 'Burullus Gas Company'],
  ['signoff_left', 'rs_signoff_left', (d) => `${d.name} SH/DH`],
  ['signoff_right', 'rs_signoff_right', (d) => `${d.name} AGM`],
];

// dept: { id, name, report }. onSaved(report) is called after a successful save (dept.report is updated too).
export function openReportSettings({ dept, onSaved }) {
  const cur = dept.report ?? {};
  const inputs = FIELDS.map(([key, label, placeholder]) => ({ key, f: field(t(label), { maxlength: 200, value: cur[key] ?? '', placeholder: placeholder(dept) }) }));
  openDialog({
    title: t('report_settings'), wide: true, autofocus: false,
    content: h('div', { class: 'form' }, h('p', { class: 'muted' }, t('report_settings_hint')), inputs.map((x) => x.f.row)),
    buttons: [{ label: t('cancel') }, { label: t('save'), kind: 'primary', onClick: async () => {
      const report = {};
      for (const { key, f } of inputs) { const v = f.input.value.trim(); if (v) report[key] = v; }
      await setDepartmentReport(dept.id, report);
      dept.report = report;
      onSaved?.(report);
      toast(t('saved'), 'success');
    } }],
  });
}
