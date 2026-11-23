// Compare tab card: this year's month-by-month mean temperature and rain total against the 1991-2020 normal (ERA5 for both).
// A month still in progress is hatched and is compared with the normal for the same days. Informational only.
import { fetchJSON, preserveView } from "./interaction.js";
import { L } from "./i18n.js";
import { state, digits, fmtDay } from "./core.js";
import { mountMonthlyView } from "./lazy_views.js";

const my = () => state.lang === "my";
// Drawn by Preact (frontend/src/monthly_view.jsx -> views.js); this file keeps the data, the events and the language hook.
let VIEW = null;
let LOC = null, DATA = null, FAIL = false, MODE = "temp", REGION = "", REGIONS = [], controller = null;
try { const s = localStorage.getItem("mw_mc_mode"); if (s === "rain") MODE = "rain"; } catch { /* storage may be blocked */ }

function render() {
  if (!document.getElementById("monthlyCompareBody")) return;
  VIEW = VIEW || mountMonthlyView();
  preserveView(() => { VIEW.draw({ LOC, DATA, FAIL, MODE, REGION, REGIONS, my: my(), L, digits, fmtDay }); });
}

function load() {
  if (!LOC || controller) return;
  const loc = LOC, ctl = new AbortController(); controller = ctl;
  fetchJSON(`/api/v1/monthly-compare?lat=${encodeURIComponent(loc.lat)}&lon=${encodeURIComponent(loc.lon)}${REGION ? "&region=" + encodeURIComponent(REGION) : ""}`, { signal: ctl.signal, timeout: 45000 })
    .then(j => { if (LOC !== loc || ctl.signal.aborted) return; DATA = j; if (j.regions?.length) REGIONS = j.regions; FAIL = false; render(); refocus(); })
    .catch(() => { if (LOC !== loc || ctl.signal.aborted) return; FAIL = true; render(); })
    .finally(() => { if (controller === ctl) controller = null; });
}
window.loadMonthlyCompare = function (loc) {
  if (!loc || !isFinite(loc.lat) || !isFinite(loc.lon)) return;
  if (LOC && LOC.lat === loc.lat && LOC.lon === loc.lon && (DATA || controller)) return;
  LOC = loc; DATA = null; FAIL = false; render(); load();
};
let wantFocus = false;
const refocus = () => { if (wantFocus) { wantFocus = false; document.getElementById("mcRegion")?.focus({ preventScroll: true }); } };
document.addEventListener("change", e => {
  if (e.target.id !== "mcRegion") return;
  REGION = e.target.value; controller?.abort(); controller = null; FAIL = false; wantFocus = true; load();   // old chart stays until the new one arrives
});
document.addEventListener("click", e => {
  const b = e.target.closest?.("[data-mc-mode]");
  if (b) { MODE = b.dataset.mcMode === "rain" ? "rain" : "temp"; try { localStorage.setItem("mw_mc_mode", MODE); } catch { /* ignore */ } render(); return; }
  if (e.target.closest?.("[data-mc-retry]")) { FAIL = false; render(); load(); }
});
window.addEventListener("mw-place", e => { controller?.abort(); controller = null; LOC = e.detail; DATA = null; FAIL = false; REGION = ""; VIEW ? VIEW.clear() : document.getElementById("monthlyCompareBody")?.replaceChildren(); });
window.addEventListener("mw-cancel", () => { controller?.abort(); controller = null; });
window.addEventListener("mw-lang", render);
