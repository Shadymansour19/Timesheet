// A small product tour: the page behind is dimmed and blurred EXCEPT the area(s) being explained (a spotlight), a ring pulses around each,
// and a card with the explanation slides in next to them. Steps move with animation; Next / Back / Skip, Esc and the arrow keys work.
// steps: [{ target, title, text }] or [{ targets: [target, target], ... }] to spotlight SEVERAL areas at once. A target is a css selector, a list of
// selectors (the first that exists), or a function returning an element; no target = a centred card. A step whose targets are all missing is skipped.
import { h } from '../dom.js';
import { t } from '../i18n/index.js';

const resolve = (spec) => {
  if (typeof spec === 'function') return spec() ?? null;
  for (const sel of [].concat(spec)) { const el = document.querySelector(sel); if (el) return el; }
  return null;
};
const elementsOf = (s) => (s.targets ?? (s.target ? [s.target] : [])).map(resolve).filter(Boolean);
const wants = (s) => !!(s.targets?.length || s.target);
const PAD = 6;                                              // breathing room around the highlighted area
const MARGIN = 12;
const PANELS = 7, RINGS = 2;                                // one hole needs 4 panels (above, left, right, below), two holes 7

export function startTour({ steps, onEnd }) {
  if (document.querySelector('.tour:not(.leaving)')) return null;                       // never two tours on top of each other
  const present = steps.filter((s) => !wants(s) || elementsOf(s).length);
  if (!present.length) { onEnd?.(false); return null; }
  let i = 0, done = false;

  const dims = Array.from({ length: PANELS }, () => h('div', { class: 'tour-dim', 'aria-hidden': 'true' }));
  const rings = Array.from({ length: RINGS }, () => h('div', { class: 'tour-ring', 'aria-hidden': 'true' }));
  const title = h('strong', { class: 'tour-title' }), text = h('p', { class: 'tour-text' });
  const dots = h('div', { class: 'tour-dots', 'aria-hidden': 'true' });
  const back = h('button', { type: 'button', class: 'btn small', onclick: () => go(-1) }, t('tour_back'));
  const next = h('button', { type: 'button', class: 'btn small primary', id: 'tour-next', onclick: () => go(1) });
  const skip = h('button', { type: 'button', class: 'tour-skip', id: 'tour-skip', onclick: () => end(false) }, t('tour_skip'));
  const card = h('div', { class: 'tour-card', role: 'dialog', 'aria-modal': 'true', 'aria-live': 'polite', 'aria-label': t('guide_title') },
    h('div', { class: 'tour-head' }, dots, skip), title, text, h('div', { class: 'tour-actions' }, back, next));
  const root = h('div', { class: 'tour' }, ...dims, ...rings, card);

  const box = (el, o) => Object.assign(el.style, { top: o.top + 'px', left: o.left + 'px', width: Math.max(0, o.width) + 'px', height: Math.max(0, o.height) + 'px' });
  const nothing = (x, y) => ({ top: y, left: x, width: 0, height: 0 });

  function layout() {
    const s = present[i], vw = innerWidth, vh = innerHeight;
    const els = elementsOf(s);
    if (!els.length) {                                      // no target: everything dimmed, the card in the middle
      dims.forEach((d, k) => box(d, k === 0 ? { top: 0, left: 0, width: vw, height: vh } : nothing(vw / 2, vh / 2)));
      rings.forEach((r) => { box(r, nothing(vw / 2, vh / 2)); r.style.opacity = '0'; });
      card.style.left = `${Math.max(MARGIN, (vw - card.offsetWidth) / 2)}px`; card.style.top = `${Math.max(MARGIN, (vh - card.offsetHeight) / 2)}px`;
      return;
    }
    let holes = els.map((el) => { const r = el.getBoundingClientRect(); return { top: Math.max(0, r.top - PAD), left: Math.max(0, r.left - PAD), width: Math.min(vw, r.width + 2 * PAD), height: r.height + 2 * PAD }; })
      .sort((a, b) => a.top - b.top).slice(0, RINGS);
    if (holes.length > 1 && holes[0].top + holes[0].height > holes[1].top) {   // on the same rows: one hole around both
      const l = Math.min(...holes.map((x) => x.left)), tp = Math.min(...holes.map((x) => x.top));
      holes = [{ top: tp, left: l, width: Math.max(...holes.map((x) => x.left + x.width)) - l, height: Math.max(...holes.map((x) => x.top + x.height)) - tp }];
    }
    // the dimmed area = the screen minus the holes: a band above each hole, the pieces left / right of it, and a band at the bottom
    const rects = []; let y = 0;
    for (const hl of holes) {
      rects.push({ top: y, left: 0, width: vw, height: hl.top - y }, { top: hl.top, left: 0, width: hl.left, height: hl.height }, { top: hl.top, left: hl.left + hl.width, width: vw - hl.left - hl.width, height: hl.height });
      y = hl.top + hl.height;
    }
    rects.push({ top: y, left: 0, width: vw, height: vh - y });
    dims.forEach((d, k) => box(d, rects[k] ?? nothing(vw / 2, vh / 2)));
    rings.forEach((r, k) => { if (holes[k]) { box(r, holes[k]); r.style.opacity = '1'; } else { box(r, nothing(vw / 2, vh / 2)); r.style.opacity = '0'; } });
    // the card goes below the area when there is room, else above; centred on it and kept inside the screen.
    // Two areas far apart (the dashed days at the ends of the grid): between them.
    const ch = card.offsetHeight, cw = card.offsetWidth;
    const first = holes[0], last = holes[holes.length - 1], cover = { top: first.top, bottom: last.top + last.height, left: Math.min(...holes.map((x) => x.left)), right: Math.max(...holes.map((x) => x.left + x.width)) };
    let top;
    if (holes.length > 1 && last.top - (first.top + first.height) >= ch + MARGIN) top = (first.top + first.height + last.top) / 2 - ch / 2;
    else if (vh - cover.bottom >= ch + MARGIN * 2) top = cover.bottom + MARGIN;
    else top = Math.max(MARGIN, cover.top - ch - MARGIN);
    card.style.top = `${Math.max(MARGIN, Math.min(vh - ch - MARGIN, top))}px`;
    card.style.left = `${Math.max(MARGIN, Math.min(vw - cw - MARGIN, (cover.left + cover.right) / 2 - cw / 2))}px`;
  }

  function show() {
    const s = present[i], els = elementsOf(s);
    title.textContent = t(s.title); text.textContent = t(s.text);
    back.hidden = i === 0; next.textContent = i === present.length - 1 ? t('tour_done') : t('tour_next');
    dots.replaceChildren(...present.map((_, k) => h('span', { class: 'tour-dot' + (k === i ? ' on' : '') })));
    card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter');      // restart the slide-in animation
    // one area: bring it to the middle; several: bring the area that contains them (the first one's grid / container) into view
    if (els.length === 1) els[0].scrollIntoView({ block: 'center', behavior: 'instant' });
    else if (els.length > 1) (els[0].closest('.grid') ?? els[0]).scrollIntoView({ block: 'center', behavior: 'instant' });
    layout(); setTimeout(layout, 60);                                                         // once more after the scroll settles
    next.focus({ preventScroll: true });
  }

  function go(d) { const n = i + d; if (n < 0) return; if (n >= present.length) { end(true); return; } i = n; show(); }
  function end(completed) {
    if (done) return; done = true;
    removeEventListener('resize', layout); removeEventListener('keydown', key, true);
    root.classList.add('leaving'); setTimeout(() => root.remove(), 220);
    onEnd?.(completed);
  }
  function key(e) {
    if (e.key === 'Escape') { e.preventDefault(); end(false); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(document.documentElement.dir === 'rtl' ? -1 : 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(document.documentElement.dir === 'rtl' ? 1 : -1); }
  }
  addEventListener('resize', layout); addEventListener('keydown', key, true);
  document.body.append(root); show();
  return { end: () => end(false) };
}
