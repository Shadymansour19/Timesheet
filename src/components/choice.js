import { h } from '../dom.js';

// Modern single choice: radio "cards" (real radio inputs, so keyboard and screen readers work). Returns { row, get value, set value }.
let n = 0;
export function choice(label, options, value) {
  const name = 'ch' + (++n);
  const inputs = options.map((o) => h('input', { type: 'radio', name, value: o.value, checked: o.value === value }));
  const cards = options.map((o, i) => h('label', { class: 'choice-card' }, inputs[i], h('span', { class: 'choice-text' }, h('strong', {}, o.label), o.hint ? h('small', {}, o.hint) : null)));
  return {
    row: h('fieldset', { class: 'choice' }, h('legend', {}, label), h('div', { class: 'choice-list' }, cards)),
    get value() { return inputs.find((i) => i.checked)?.value; },
    set value(v) { inputs.forEach((i) => { i.checked = i.value === v; }); },
  };
}
