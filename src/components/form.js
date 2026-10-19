import { h } from '../dom.js';

let n = 0;
// Labelled input; returns { row, input }.
export function field(label, props = {}) {
  const id = 'f' + (++n);
  const input = h('input', { id, ...props });
  return { row: h('div', { class: 'field' }, h('label', { for: id }, label), input), input };
}

// Password the admin can read out / send to the user (no ambiguous characters).
export function randomPassword(len = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = crypto.getRandomValues(new Uint32Array(len));
  return Array.from(buf, (x) => chars[x % chars.length]).join('');
}
