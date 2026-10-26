// A small product tour: the page behind is dimmed and blurred EXCEPT the area being explained (a spotlight), a ring pulses around it,
// and a card with the explanation slides in next to it. Steps move with animation; Next / Back / Skip, Esc and the arrow keys work.
// steps: [{ target: 'css selector' | ['selector', 'fallback selector'] | null (centred card), title, text }]. A step whose target is missing is skipped.
import { h } from '../dom.js';
import { t } from '../i18n/index.js';

const find = (target) => { for (const s of [].concat(target)) { const el = document.querySelector(s); if (el) return el; } return null; };      // a list: the first selector that exists
const PAD = 6;                                              // breathing room around the highlighted area
const MARGIN = 12;

export function startTour({ steps, onEnd }) {
  const present = steps.filter((s) => !s.target || find(s.target));
  if (!present.length) { onEnd?.(false); return null; }
  let i = 0, done = false;

  const panel = () => h('div', { class: 'tour-dim', 'aria-hidden': 'true' });
  const dims = { top: panel(), bottom: panel(), left: panel(), right: panel() };
  const ring = h('div', { class: 'tour-ring', 'aria-hidden': 'true' });
  const title = h('strong', { class: 'tour-title' }), text = h('p', { class: 'tour-text' });
  const dots = h('div', { class: 'tour-dots', 'aria-hidden': 'true' });
  const back = h('button', { type: 'button', class: 'btn small', onclick: () => go(-1) }, t('tour_back'));
  const next = h('button', { type: 'button', class: 'btn small primary', id: 'tour-next', onclick: () => go(1) });
  const skip = h('button', { type: 'button', class: 'tour-skip', id: 'tour-skip', onclick: () => end(false) }, t('tour_skip'));
  const card = h('div', { class: 'tour-card', role: 'dialog', 'aria-modal': 'true', 'aria-live': 'polite', 'aria-label': t('guide_title') },
    h('div', { class: 'tour-head' }, dots, skip), title, text, h('div', { class: 'tour-actions' }, back, next));
  const root = h('div', { class: 'tour' }, ...Object.values(dims), ring, card);

  const box = (el, o) => Object.assign(el.style, { top: o.top + 'px', left: o.left + 'px', width: Math.max(0, o.width) + 'px', height: Math.max(0, o.height) + 'px' });

  function layout() {
    const s = present[i], vw = innerWidth, vh = innerHeight, el = s.target ? find(s.target) : null;
    if (!el) {                                              // no target: everything dimmed, the card in the middle
      box(dims.top, { top: 0, left: 0, width: vw, height: vh });
      for (const k of ['bottom', 'left', 'right']) box(dims[k], { top: vh / 2, left: vw / 2, width: 0, height: 0 });
      box(ring, { top: vh / 2, left: vw / 2, width: 0, height: 0 }); ring.style.opacity = '0';
      card.style.left = `${Math.max(MARGIN, (vw - card.offsetWidth) / 2)}px`; card.style.top = `${Math.max(MARGIN, (vh - card.offsetHeight) / 2)}px`;
      return;
    }
    const r = el.getBoundingClientRect();
    const tg = { top: Math.max(0, r.top - PAD), left: Math.max(0, r.left - PAD), width: Math.min(vw, r.width + 2 * PAD), height: r.height + 2 * PAD };
    box(dims.top, { top: 0, left: 0, width: vw, height: tg.top });
    box(dims.bottom, { top: tg.top + tg.height, left: 0, width: vw, height: vh - tg.top - tg.height });
    box(dims.left, { top: tg.top, left: 0, width: tg.left, height: tg.height });
    box(dims.right, { top: tg.top, left: tg.left + tg.width, width: vw - tg.left - tg.width, height: tg.height });
    box(ring, tg); ring.style.opacity = '1';
    // the card goes below the area when there is room, else above; centred on it and kept inside the screen
    const ch = card.offsetHeight, cw = card.offsetWidth;
    const below = vh - (tg.top + tg.height) >= ch + MARGIN * 2;
    card.style.top = `${below ? tg.top + tg.height + MARGIN : Math.max(MARGIN, tg.top - ch - MARGIN)}px`;
    card.style.left = `${Math.max(MARGIN, Math.min(vw - cw - MARGIN, tg.left + tg.width / 2 - cw / 2))}px`;
  }

  function show() {
    const s = present[i], el = s.target ? find(s.target) : null;
    title.textContent = t(s.title); text.textContent = t(s.text);
    back.hidden = i === 0; next.textContent = i === present.length - 1 ? t('tour_done') : t('tour_next');
    dots.replaceChildren(...present.map((_, k) => h('span', { class: 'tour-dot' + (k === i ? ' on' : '') })));
    card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter');      // restart the slide-in animation
    if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
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
