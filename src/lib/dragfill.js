// Drag-to-fill: press on a day, drag across other days of the same row (grid) / month (calendar): every day entered gets the
// status the START day has, AS YOU GO (not on release). A press without moving is still a normal click.
//  - mouse / pen: drag at once.
//  - touch: `touchHold` = 0 (calendar): drag at once (cells use touch-action: none);
//           touchHold > 0 (department grid, which scrolls and swipes weeks): press and HOLD that many ms, then drag; moving earlier = scroll.
// The helper never re-renders anything; opts.fill patches cells in place (a re-render in the middle of a gesture would drop it).
export function enableDragFill(root, { cellSelector, keyOf, rowCells, statusOf, canFill, fill, press, release, touchHold = 0, enabled = () => true }) {
  let d = null, swallow = false;

  const cellAt = (x, y) => document.elementFromPoint(x, y)?.closest?.(cellSelector) ?? null;
  const stop = () => {
    if (!d) return;
    clearTimeout(d.timer);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    document.removeEventListener('touchmove', onTouchMove);
    const was = d; d = null;
    if (was.active) { swallow = true; setTimeout(() => { swallow = false; }, 80); }
    release?.(was);
  };
  const onTouchMove = (e) => { if (d && d.type === 'touch' && (d.active || d.armed)) e.preventDefault(); };   // armed / dragging: the finger must not scroll the page
  const onUp = (e) => { if (!d || e.pointerId !== d.id) return; stop(); };

  function onMove(e) {
    if (!d || e.pointerId !== d.id) return;
    if (d.type === 'touch' && !d.armed) { if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) stop(); return; }   // moved before the hold: it is a scroll / swipe
    if (e.pointerType === 'mouse' && e.buttons === 0) { stop(); return; }
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell || keyOf(cell) === d.lastKey) return;
    const row = rowCells(d.start);                         // cells are found by KEY: the elements may have been re-rendered since the press
    const to = row.findIndex((c) => keyOf(c) === keyOf(cell)), from = row.findIndex((c) => keyOf(c) === d.lastKey);
    if (to < 0 || from < 0) return;                       // another row / outside: ignored
    d.active = true;
    const step = to > from ? 1 : -1;
    for (let i = from + step; step > 0 ? i <= to : i >= to; i += step) {
      const c = row[i];
      if (keyOf(c) !== d.startKey && canFill(c, d.status)) fill(c, d.status, d);
    }
    d.last = cell; d.lastKey = keyOf(cell);
  }

  root.addEventListener('pointerdown', (e) => {
    if (!enabled() || d || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const cell = e.target.closest?.(cellSelector);
    if (!cell) return;
    d = { start: cell, last: cell, startKey: keyOf(cell), lastKey: keyOf(cell), status: statusOf(cell), id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, active: false, armed: !(e.pointerType === 'touch' && touchHold > 0), timer: null };
    if (!d.armed) d.timer = setTimeout(() => { if (d) { d.armed = true; try { navigator.vibrate?.(12); } catch { /* ignore */ } } }, touchHold);
    press?.(d);                                            // from now on nothing may re-render until the gesture ends
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
  });
  // the click that follows a drag must not also cycle the day it ends on
  root.addEventListener('click', (e) => { if (swallow) { e.stopPropagation(); e.preventDefault(); } }, true);
  root.addEventListener('contextmenu', (e) => { if (d && d.type === 'touch') e.preventDefault(); });
  return { active: () => !!d?.active };
}
