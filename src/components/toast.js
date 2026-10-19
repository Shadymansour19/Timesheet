import { h } from '../dom.js';

let box;
export function toast(message, kind = 'error') {
  if (!box || !box.isConnected) { box = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const el = h('div', { class: 'toast ' + kind }, message);
  box.append(el);
  setTimeout(() => el.remove(), 3500);
}
