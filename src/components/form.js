import { h } from '../dom.js';
import { t } from '../i18n/index.js';
import { icon, EYE, EYE_OFF } from './icons.js';

// Password input with a show/hide eye button. Returns { wrap, input }.
export function passwordInput(props = {}) {
  const input = h('input', { type: 'password', ...props });
  const btn = h('button', { type: 'button', class: 'pw-toggle', 'aria-pressed': 'false' });
  const paint = (shown) => {
    input.type = shown ? 'text' : 'password';
    btn.replaceChildren(icon(shown ? EYE_OFF : EYE));
    btn.setAttribute('aria-pressed', String(shown));
    const label = t(shown ? 'hide_password' : 'show_password');
    btn.setAttribute('aria-label', label); btn.title = label;
  };
  btn.addEventListener('click', () => { paint(input.type === 'password'); input.focus(); });
  paint(false);
  return { wrap: h('div', { class: 'pw' }, input, btn), input };
}

let n = 0;
// Labelled input; returns { row, input }. type: 'password' gets the show/hide button.
export function field(label, props = {}) {
  const id = 'f' + (++n);
  if (props.type === 'password') {
    const { wrap, input } = passwordInput({ id, ...props });
    return { row: h('div', { class: 'field' }, h('label', { for: id }, label), wrap), input };
  }
  const input = h('input', { id, ...props });
  return { row: h('div', { class: 'field' }, h('label', { for: id }, label), input), input };
}

// Password the admin can read out / send to the user (no ambiguous characters).
export function randomPassword(len = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = crypto.getRandomValues(new Uint32Array(len));
  return Array.from(buf, (x) => chars[x % chars.length]).join('');
}
