// Excel-style filter of one table column: every value found in the column with a check box, a search box, Select all and Clear.
// The filter state lives in the caller's `filters` object (key -> Set of the values that stay; no entry = everything);
// `matches(row, skipKey)` must apply all the OTHER filters, so a list only offers the values that are still possible.
import { h } from '../dom.js';
import { t } from '../i18n/index.js';

export function createColumnFilter({ rows, matches, cellText, filters, labelOf, onChange }) {
  let pop = null;
  const close = () => { if (pop) { pop.remove(); pop = null; } };
  document.addEventListener('pointerdown', (e) => { if (pop && !pop.contains(e.target) && !e.target.closest('.th-filter')) close(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.addEventListener('resize', close);

  function open(k, btn) {
    const was = pop?.dataset.k === k; close(); if (was) return;
    const values = [...new Set(rows().filter((p) => matches(p, k)).map((p) => cellText(p, k)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    const sel = new Set(filters[k] ?? values);
    const shown = () => values.filter((v) => (v || t('filter_blanks')).toLowerCase().includes(search.value.trim().toLowerCase()));
    const apply = () => { if (values.every((v) => sel.has(v))) delete filters[k]; else filters[k] = new Set(sel); onChange(); };
    const search = h('input', { type: 'search', placeholder: t('search'), 'aria-label': t('search'), autocomplete: 'off' });
    const all = h('input', { type: 'checkbox', id: 'flt-all' });
    const list = h('div', { class: 'flt-list' });
    function draw() {
      const vs = shown(), n = vs.filter((v) => sel.has(v)).length;
      all.checked = vs.length > 0 && n === vs.length; all.indeterminate = n > 0 && n < vs.length;
      list.replaceChildren(...vs.map((v) => { const box = h('input', { type: 'checkbox', checked: sel.has(v), value: v }); box.addEventListener('change', () => { if (box.checked) sel.add(v); else sel.delete(v); apply(); draw(); }); return h('label', { class: 'flt-opt' }, box, v || t('filter_blanks')); }));
      if (!vs.length) list.append(h('p', { class: 'muted' }, t('users_none_match')));
    }
    all.addEventListener('change', () => {          // acts on what the search shows; checking it while searching keeps ONLY the found values (like Excel)
      const vs = shown(), searching = search.value.trim() !== '';
      if (vs.every((v) => sel.has(v))) vs.forEach((v) => sel.delete(v));
      else { if (searching) sel.clear(); vs.forEach((v) => sel.add(v)); }
      apply(); draw();
    });
    search.addEventListener('input', draw);
    pop = h('div', { class: 'flt-pop', role: 'dialog', 'aria-label': `${t('filter')}: ${labelOf(k)}`, 'data-k': k },
      search, h('label', { class: 'flt-opt flt-all' }, all, t('select_all')), list,
      h('div', { class: 'flt-foot' }, h('button', { type: 'button', class: 'btn small', onclick: () => { delete filters[k]; onChange(); close(); } }, t('clear_filter')), h('button', { type: 'button', class: 'btn small primary', onclick: close }, t('done'))));
    document.body.append(pop);
    const r = btn.getBoundingClientRect(), rtl = document.documentElement.dir === 'rtl';
    pop.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 300)}px`;
    const left = rtl ? r.right - pop.offsetWidth : r.left; pop.style.left = `${Math.max(8, Math.min(left, window.innerWidth - pop.offsetWidth - 8))}px`;
    draw(); search.focus();
  }
  return { open, close };
}
