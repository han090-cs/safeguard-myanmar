// One React root per page element, shared by every screen. Anything that needs to empty such an element (a new place was chosen,
// a request was cancelled) must go through clearSlot(): emptying it with replaceChildren() behind React's back would break the next render.
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

const roots = new Map();
export function put(id, node) {
  const el = document.getElementById(id); if (!el) return;
  let r = roots.get(id);
  if (!r || r.el !== el) { r = { el, root: createRoot(el) }; roots.set(id, r); }   // element replaced in the page: start a new root
  flushSync(() => r.root.render(node));
}
export function clearSlot(id) {
  if (roots.has(id)) put(id, null);
  else document.getElementById(id)?.replaceChildren();
}
