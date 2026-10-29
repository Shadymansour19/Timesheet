import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { openDialog } from './dialog.js';
import { field } from './form.js';
import { setDepartmentReport } from '../api/admin.js';
import { toast } from './toast.js';

// Department data printed on the official monthly report. The captions, the manpower line, the title wording and the
// sign-offs are fixed by the form (only the department name changes), so only these fields are editable.
// dept: { id, name, report, code, sector, field }. Empty fields fall back to defaults when exporting.
export function openReportSettings({ dept, onSaved }) {
  const cur = dept.report ?? {};
  const code = field(t('rs_code'), { maxlength: 20, value: dept.code ?? '', placeholder: '19' });
  const sector = field(t('rs_sector'), { maxlength: 100, value: dept.sector ?? '', placeholder: 'Maintenance Sector' });
  const fieldIn = field(t('rs_field'), { maxlength: 100, value: dept.field ?? '', placeholder: 'Operations [Fields]' });
  const apprEng = field(t('rs_approved_engineer'), { type: 'number', min: 0, step: 1, inputmode: 'numeric', value: dept.approved_engineer ?? '' });
  const apprTech = field(t('rs_approved_tech'), { type: 'number', min: 0, step: 1, inputmode: 'numeric', value: dept.approved_tech ?? '' });
  const printName = field(t('rs_dept_print_name'), { maxlength: 200, value: cur.dept_print_name ?? '', placeholder: dept.name.toUpperCase() });
  // the overtime form (Arabic): the department as written there and the two sign-off titles (empty = the defaults of overtime-form.js)
  const deptAr = field(t('rs_dept_ar'), { maxlength: 100, value: cur.dept_ar ?? '', placeholder: 'التوربينات', dir: 'rtl' });
  const signRight = field(t('rs_ot_sign_right'), { maxlength: 100, value: cur.ot_sign_right ?? '', placeholder: 'مدير عام مساعد التوربينات', dir: 'rtl' });
  const signLeft = field(t('rs_ot_sign_left'), { maxlength: 100, value: cur.ot_sign_left ?? '', placeholder: 'مدير عام الصيانة', dir: 'rtl' });
  openDialog({
    title: t('report_settings'), autofocus: false,
    content: h('div', { class: 'form' }, h('p', { class: 'muted' }, t('report_settings_hint')), code.row, sector.row, fieldIn.row, printName.row, apprEng.row, apprTech.row,
      h('h4', {}, t('rs_ot_form')), deptAr.row, signRight.row, signLeft.row),
    buttons: [{ label: t('cancel') }, { label: t('save'), kind: 'primary', onClick: async () => {
      const report = {};
      if (printName.input.value.trim()) report.dept_print_name = printName.input.value.trim();
      for (const [k, f] of [['dept_ar', deptAr], ['ot_sign_right', signRight], ['ot_sign_left', signLeft]]) if (f.input.value.trim()) report[k] = f.input.value.trim();
      const cols = { code: code.input.value.trim(), sector: sector.input.value.trim(), field: fieldIn.input.value.trim(), approvedEngineer: apprEng.input.value.trim(), approvedTech: apprTech.input.value.trim() };
      await setDepartmentReport(dept.id, report, cols);
      Object.assign(dept, { report, code: cols.code || null, sector: cols.sector || null, field: cols.field || null, approved_engineer: cols.approvedEngineer === '' ? null : Number(cols.approvedEngineer), approved_tech: cols.approvedTech === '' ? null : Number(cols.approvedTech) });
      onSaved?.(report);
      toast(t('saved'), 'success');
    } }],
  });
}
