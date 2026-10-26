// Drag and drop for a file input: dropping a file on the zone fills the input and fires its change event, so the dialog
// handles a dropped file exactly like a picked one. Returns the zone element.
import { h } from '../dom.js';
import { t } from '../i18n/index.js';

export function dropZone(input, { accept = '.xlsx' } = {}) {
  const zone = h('div', { class: 'scan-drop', tabindex: '-1' }, t('drop_file'));
  const over = (on) => (e) => { e.preventDefault(); zone.classList.toggle('over', on); };
  zone.addEventListener('dragover', over(true)); zone.addEventListener('dragleave', over(false));
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); zone.classList.remove('over');
    const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.name.toLowerCase().endsWith(accept));
    if (!f) { zone.textContent = t('drop_wrong_file'); return; }
    const dt = new DataTransfer(); dt.items.add(f);
    input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    zone.textContent = `${t('drop_file')} (${f.name})`;
  });
  return zone;
}
