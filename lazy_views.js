// On-demand screens. The core bundle (views.js) holds what the first screen needs; the Compare, Farming, Lab and
// Alerts/Hospitals/About screens are separate files, fetched the first time their mount function is used.
// Each mountXView() returns the same kind of draw function as before; calls made before the file has arrived
// are coalesced and the LAST one is drawn on arrival, so nothing is lost or drawn out of order.
import { L } from "./i18n.js";
// The section file could not be fetched (offline on a first visit, flaky network): say so, with a Reload button, instead of leaving an empty tab.
function failed(file, err) {
  if (typeof window !== "undefined" && window.mwReportError) window.mwReportError("section", "section " + file + ": " + ((err && err.message) || "did not load"));
  if (typeof document === "undefined" || document.getElementById("sectionFail")) return;
  const box = document.createElement("div");
  box.id = "sectionFail"; box.className = "section-fail"; box.setAttribute("role", "alert");
  const msg = document.createElement("span"); msg.textContent = L("ux_section_failed");
  // A browser remembers a failed import for as long as the page lives, so trying again needs a fresh page load.
  const b = document.createElement("button"); b.type = "button"; b.className = "ghost-btn"; b.textContent = L("ux_reload_now");
  b.onclick = () => location.reload();
  box.append(msg, b);
  document.body.append(box);
}
const FILES = {
  compare: () => import("./views_compare.js"),
  farm: () => import("./views_farm.js"),
  more: () => import("./views_more.js"),
  lab: () => import("./views_lab.js"),
};
function lazy(file, name) {
  return (...mountArgs) => {
    let draw = null, last = null, waiting = false;
    return (...args) => {
      if (draw) return draw(...args);
      last = args;
      if (waiting) return undefined;
      waiting = true;
      FILES[file]().then(m => {
        draw = m[name](...mountArgs);
        waiting = false;
        draw(...last);
      }).catch(err => { waiting = false; failed(file, err); });
      return undefined;
    };
  };
}
// Same idea for screens whose mount returns an object of methods ({draw, clear, drawExtras}). A method called before
// the file arrives is remembered (last call per method) and replayed on arrival; clear() cancels a waiting draw.
function lazyObj(file, name, methods) {
  return (...mountArgs) => {
    let obj = null, waiting = false;
    const pending = {};
    const load = () => {
      if (waiting) return;
      waiting = true;
      FILES[file]().then(m => {
        obj = m[name](...mountArgs);
        waiting = false;
        for (const k of Object.keys(pending)) { const a = pending[k]; delete pending[k]; obj[k](...a); }
      }).catch(err => { waiting = false; failed(file, err); });
    };
    const out = {};
    for (const k of methods) {
      out[k] = (...args) => {
        if (obj) return obj[k](...args);
        if (k === "clear") { delete pending.draw; delete pending.drawExtras; return undefined; }
        pending[k] = args; load(); return undefined;
      };
    }
    return out;
  };
}
export const mountCompareView = lazy("compare", "mountCompareView");
export const mountMonthlyView = lazyObj("compare", "mountMonthlyView", ["draw", "clear"]);
export const mountHistoryView = lazyObj("compare", "mountHistoryView", ["draw"]);
export const mountRainLogView = lazy("compare", "mountRainLogView");
export const mountAgriView = lazy("farm", "mountAgriView");
export const mountDiseaseView = lazy("farm", "mountDiseaseView");
export const mountPestView = lazy("farm", "mountPestView");
export const mountFeedsView = lazyObj("more", "mountFeedsView", ["draw", "drawExtras"]);
export const mountHospitalsView = lazy("more", "mountHospitalsView");
export const mountAboutView = lazy("more", "mountAboutView");
export const mountLeafView = lazy("lab", "mountLeafView");
// Called when the person opens a tab, so the file is already on its way before the first draw.
export const preload = file => { try { FILES[file](); } catch { /* ignore */ } };
