// Swipe left / right on a touch screen to move to the next / previous tab. It only presses the same tab buttons a finger would,
// so scroll position, history and loading behave exactly as with a tap; the buttons stay the main way to navigate.
//
// A swipe is ignored when it could be something else:
//   - it starts in the 28 px next to a screen edge (the phone's own back gesture lives there)
//   - it starts on something that scrolls sideways (the hourly strip, a wide table), a field, a map, or a chart you can drag
//   - a dialog or the place picker is open, the page is pinch-zoomed, a second finger touches, or text is selected
//   - it is short (< 64 px), slow (> 700 ms) or more up/down than sideways
// Phones and tablets only (a touch screen); a mouse never swipes. With "reduce motion" the tab changes without the slide.

const EDGE = 28, MIN_DX = 64, MAX_MS = 700, RATIO = 1.7;

const FIELDS = "input,textarea,select,[contenteditable],[data-no-swipe],.leaflet-container,canvas,.mc-chart,.chart-wrap";

/** The tabs of whichever view is showing, in reading order: the weather tabs, or the four farming tabs. */
export function swipeTabs(doc = document) {
  const farm = doc.body.dataset.mode === "farm";
  const list = [...doc.querySelectorAll(farm ? "#farmTabbar .ftab" : "nav.tabbar[aria-label='Dashboard sections'] [data-tab]")];
  const isOn = b => b.getAttribute("aria-selected") === "true";
  return { list, index: list.findIndex(isOn), farm };
}

/** True when the finger started on something that must keep its own sideways gesture. */
export function ownsSidewaysGesture(el) {
  if (!el || !el.closest) return false;
  if (el.closest(FIELDS)) return true;
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && n.scrollWidth > n.clientWidth + 2) return true;
  }
  return false;
}

function blocked(doc, win) {
  const b = doc.body;
  if (!b.classList.contains("has-location") || b.classList.contains("show-hero")) return true;   // no place yet, or the place picker is open
  if (doc.querySelector("dialog[open], #langSheet:not([hidden])")) return true;
  if (b.querySelector("nav.tabbar.more-open")) return true;
  if ((win.visualViewport?.scale || 1) > 1.02) return true;   // pinch-zoomed: a sideways drag pans the page
  const sel = win.getSelection?.();
  return !!(sel && !sel.isCollapsed && String(sel).length > 0);
}

export function initSwipeTabs(doc = document, win = window) {
  if (!win.matchMedia?.("(pointer:coarse)").matches && !("ontouchstart" in win)) return;
  let t0 = null;
  doc.addEventListener("touchstart", e => {
    t0 = null;
    if (e.touches.length !== 1 || blocked(doc, win)) return;
    const t = e.touches[0];
    if (t.clientX < EDGE || t.clientX > win.innerWidth - EDGE) return;
    if (ownsSidewaysGesture(e.target)) return;
    t0 = { x: t.clientX, y: t.clientY, at: Date.now() };
  }, { passive: true });
  doc.addEventListener("touchmove", e => { if (t0 && e.touches.length > 1) t0 = null; }, { passive: true });
  doc.addEventListener("touchend", e => {
    const s = t0; t0 = null;
    if (!s || !e.changedTouches.length) return;
    const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) < MIN_DX || Math.abs(dx) < Math.abs(dy) * RATIO || Date.now() - s.at > MAX_MS) return;
    const { list, index } = swipeTabs(doc);
    if (index < 0) return;
    // finger moves left (dx < 0) -> the next tab, which slides in from the right; like turning a page
    const next = list[index + (dx < 0 ? 1 : -1)];
    if (!next) return;
    next.click();
    if (win.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const panel = doc.querySelector(`[data-panel="${next.dataset.tab}"], [data-fpanel="${next.dataset.ftab}"]`);
    if (!panel) return;
    const cls = dx < 0 ? "swipe-in-next" : "swipe-in-prev";
    panel.classList.remove("swipe-in-next", "swipe-in-prev");
    void panel.offsetWidth;   // restart the animation if the same panel is swiped twice quickly
    panel.classList.add(cls);
    panel.addEventListener("animationend", () => panel.classList.remove(cls), { once: true });
  }, { passive: true });
}
