import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { explain } from '../api/errors.js';

// buttons: [{ label, kind?: 'primary'|'danger', onClick?: async () => (false to keep open) }]
// Errors thrown by onClick are shown inside the dialog. Enter submits the first primary/danger button.
export function openDialog({ title, content, buttons, onClose, wide = false, autofocus = true }) {
  const err = h('p', { class: 'error', role: 'alert' });
  let busy = false;
  const dlg = h('dialog', { class: 'dlg' + (wide ? ' wide' + (wide === 'xl' ? ' xl' : '') : '') });
  const els = buttons.map((b) => h('button', { type: 'button', class: 'btn ' + (b.kind || ''), onclick: async () => {
    if (!b.onClick) return dlg.close();
    els.forEach((x) => { x.disabled = true; }); err.textContent = ''; busy = true;
    try { if ((await b.onClick()) !== false) dlg.close(); }
    catch (ex) { err.textContent = explain(ex); }
    finally { els.forEach((x) => { x.disabled = false; }); busy = false; }
  } }, b.label));
  const primary = els[buttons.findIndex((b) => b.kind)];
  dlg.append(h('form', { onsubmit: (e) => { e.preventDefault(); primary?.click(); } },
    h('h3', {}, title), content ?? null, err, h('div', { class: 'dlg-actions' }, els)));
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  // a click OUTSIDE the dialog (on the dimmed backdrop) cancels it - but only when the press started outside too (so selecting text
  // and releasing outside does not close it), and never while a save is running
  const outside = (e) => { const r = dlg.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
  let downOutside = false;
  dlg.addEventListener('pointerdown', (e) => { downOutside = e.target === dlg && outside(e); });
  dlg.addEventListener('click', (e) => { if (downOutside && e.target === dlg && outside(e) && !busy) dlg.close(); downOutside = false; });
  document.body.append(dlg);
  dlg.showModal();
  if (autofocus) dlg.querySelector('input, select')?.focus();
  else { dlg.tabIndex = -1; dlg.focus(); }    // showModal() itself focuses the first field; keep it unfocused (e.g. phone keyboard)
  return dlg;
}

export const confirmDialog = (message, { danger = false, confirmLabel, detail } = {}) => new Promise((resolve) => {
  let answer = false;
  openDialog({
    title: message,
    content: detail ? h('p', { class: 'muted' }, detail) : null,
    buttons: [
      { label: t('cancel') },
      { label: confirmLabel ?? t('confirm'), kind: danger ? 'danger' : 'primary', onClick: () => { answer = true; } },
    ],
    onClose: () => resolve(answer),
  });
});
