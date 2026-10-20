import { h } from '../dom.js';
import { t, getLang } from '../i18n/index.js';
import { openDialog } from './dialog.js';
import { field } from './form.js';
import { setStatus, setOvertime } from '../api/admin.js';

// Admin dialog for ONE person on ONE day: status + overtime hours (whole 0-24) + note.
// overtime: { hours, note } | null. run(fn) lets the caller track in-flight writes. onSaved({ status, prevStatus, hours, note }).
export function openDayEditor({ person, day, status, overtime, holiday = false, run = (fn) => fn(), onSaved, onClose }) {
  const radios = ['E', 'X', 'Y'].map((s) => h('label', { class: 'radio' },
    h('input', { type: 'radio', name: 'st', value: s, checked: s === status }), h('span', { class: 'chip s-' + s.toLowerCase() }, s)));
  const hours = field(t('overtime_hours'), { type: 'number', min: 0, max: 24, step: 1, inputmode: 'numeric', value: overtime?.hours ?? 0 });
  const note = field(t('note'), { type: 'text', maxlength: 200, value: overtime?.note ?? '' });
  const date = new Date(day + 'T00:00:00').toLocaleDateString(getLang() === 'ar' ? 'ar-u-nu-latn' : 'en', { weekday: 'long', day: 'numeric', month: 'long' });
  const content = h('div', { class: 'form' },
    h('p', { class: 'muted' }, `${person.full_name} · ${date}${holiday ? ' · ' + t('holiday') : ''}`),
    h('div', { class: 'radios' }, radios), hours.row, note.row);
  openDialog({
    title: t('edit_day'), content, onClose,
    buttons: [{ label: t('cancel') }, { label: t('save'), kind: 'primary', onClick: async () => {
      const next = content.querySelector('input[name=st]:checked').value;
      const hrs = Number(hours.input.value);
      if (!Number.isInteger(hrs) || hrs < 0 || hrs > 24) throw Object.assign(new Error(t('overtime_invalid')), { code: '22023' });
      const n2 = note.input.value.trim();
      const jobs = [];
      if (next !== status) jobs.push(setStatus(person.id, day, next));
      if (hrs !== (overtime?.hours ?? 0) || (hrs > 0 && n2 !== (overtime?.note ?? ''))) jobs.push(setOvertime(person.id, day, hrs, n2));
      if (jobs.length) await run(() => Promise.all(jobs));
      onSaved?.({ status: next, prevStatus: status, hours: hrs, note: n2 });
    } }],
  });
}
