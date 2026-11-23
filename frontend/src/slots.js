// One Preact tree per page element, shared by every screen. Anything that needs to empty such an element (a new place was chosen,
// a request was cancelled) must go through clearSlot(): emptying it with replaceChildren() behind Preact's back would break the next render.
// Preact's render() is synchronous, so callers can read the DOM straight after put().
import { render } from "preact";

const roots = new Map();
export function put(id, node) {
  const el = document.getElementById(id); if (!el) return;
  let r = roots.get(id);
  // Element replaced in the page, or its children were changed from outside: start from an empty element.
  if (r && (r.el !== el || el.firstChild !== r.first)) { try { render(null, r.el); } catch { /* old tree is gone already */ } r = null; }
  if (!r) { el.replaceChildren(); r = { el, first: null }; roots.set(id, r); }
  render(node, el);
  r.first = el.firstChild;
}
export function clearSlot(id) {
  if (roots.has(id)) put(id, null);
  else document.getElementById(id)?.replaceChildren();
}
