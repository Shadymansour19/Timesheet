import { h } from '../dom.js';

let box;
// opts.action = { label, onClick } adds a button (e.g. Undo) and keeps the toast longer.
export function toast(message, kind = 'error', { action, ms } = {}) {
  if (!box || !box.isConnected) { box = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const el = h('div', { class: 'toast ' + kind }, h('span', {}, message),
    action ? h('button', { type: 'button', class: 'toast-action', onclick: () => { el.remove(); action.onClick(); } }, action.label) : null);
  box.append(el);
  setTimeout(() => el.remove(), ms ?? (action ? 7000 : 3500));
}
