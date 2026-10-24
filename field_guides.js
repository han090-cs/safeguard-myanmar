// Cards that help people act on the weather: Myanmar calendar moon day and tides, drinking water in the heat, the offline emergency
// quick guide, and the weather-based crop-disease watch. The pure logic lives in nature.js (unit-tested).
import { state, digits, fmtDay } from "./core.js";
import { L } from "./i18n.js";
import { nationalEmergencyRows } from "./emergency_card.js";
import { mountMoonView, mountSosView, mountDiseaseView, clearSlot } from "./views.js";
let drawMoon=null, drawSos=null, drawDis=null;
import { addDays, TIDAL_REGION, diseaseWatch } from "./nature.js";
import { myanmarDate, moonDay, monthName, nextMoonDays } from "./mm_calendar.js";

const my = () => state.lang === "my";

// ---- Myanmar calendar day (moon day) + spring tides (Today tab) ----
// Uses the Myanmar calendar (mm_calendar.js): month name, waxing/waning day, full moon (လပြည့်) and new moon (လကွယ်) days.
const MOON_ICONS = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
export function moonDayText(md) {
  const d = moonDay(md), month = monthName(md, state.lang);
  const mo = my() ? month + "လ" : month;
  return {mo, day: L("fg_mm_" + d.kind, {n: digits(d.n)}), kind: d.kind};
}
export function renderMoon() {
  const box = document.getElementById("moonCard"); if (!box) return;
  const now = new Date(), md = myanmarDate(now);
  if (!md) { clearSlot("moonCard"); return; }
  const loc = state.location || {}, tidal = TIDAL_REGION.test([loc.admin1, loc.admin1_en].filter(Boolean).join(" "));
  const t = moonDayText(md), next = nextMoonDays(now);
  // Tides run highest around the full and new moon days (about one day either side).
  const d = md.monthDay, spring = d >= 14 && d <= 16 || d >= md.monthLength - 1 || d === 1;
  const icon = MOON_ICONS[Math.round((d - 1) / md.monthLength * 8) % 8];
  const dayText = n => fmtDay(addDays(now, n.days).toISOString().slice(0, 10));
  const row = (k, n) => { if (!n) return null; const m = moonDayText(n.md); return {label: L(k), sub: m.mo + " " + m.day, day: dayText(n)}; };
  drawMoon = drawMoon || mountMoonView();
  drawMoon({title: L("fg_moon_title"), icon, line: t.mo + " " + t.day, year: L("fg_mm_year", {y: digits(md.year)}), watat: md.yearType ? L("fg_mm_watat") : "",
    rows: [row("fg_moon_next_full", next.full), row("fg_moon_next_new", next.newMoon)].filter(Boolean),
    tide: tidal ? {tone: spring ? "dry" : "wet", text: L(spring ? "fg_moon_tide_now" : "fg_moon_tide_note")} : null, approx: L("fg_moon_approx")});
}

// ---- Drinking water in the heat (inside the heat card, Alerts tab). `feels` = highest feels-like temperature, °C ----
// Same content as hydrationHtml, as data for the React view (frontend/src/weather_view.jsx)
export function hydrationModel(feels) {
  if (!Number.isFinite(feels) || feels < 32) return null;
  return {title: L("fg_hyd_title"), feels: L("fg_hyd_feels", {t: digits(Math.round(feels))}),
    items: [L("fg_hyd_work"), L("fg_hyd_cap"), L("fg_hyd_salt"), ...(feels >= 41 ? [L("fg_hyd_rest")] : [])]};
}

// ---- Offline emergency quick guide (Alerts tab card + footer dialog). All text comes from the cached i18n files. ----
const SOS_TOPICS = [["fg_sos_light", 4], ["fg_sos_quake", 4], ["fg_sos_flood", 3], ["fg_sos_heat", 3]];
const sosModel = () => ({items: SOS_TOPICS.map(([k, n]) => ({title: L(k), steps: Array.from({length: n}, (_, i) => L(`${k}_${i + 1}`))})), numbers: L("fg_sos_numbers"),
  title: L("fg_sos_title"), sub: L("fg_sos_sub"), nat: nationalEmergencyRows()});
export function renderSos() {
  drawSos = drawSos || mountSosView();
  const m = sosModel();
  if (document.getElementById("sosCard")) drawSos.card(m);
  const link = document.getElementById("sosLink"), title = document.getElementById("sosTitle"), close = document.getElementById("sosClose");
  if (document.getElementById("sosBody")) drawSos.body(m);
  if (link) link.textContent = L("fg_sos_open");
  if (title) title.textContent = L("fg_sos_title");
  if (close) close.setAttribute("aria-label", L("fg_close"));
}
// the dialog repeats the national emergency numbers so they are one tap away even before a place is chosen
export function wireSosDialog() {
  const dlg = document.getElementById("sosDialog"); if (!dlg || dlg.dataset.wired) return; dlg.dataset.wired = "1";
  document.getElementById("sosLink")?.addEventListener("click", () => { renderSos(); dlg.showModal?.(); });
  document.getElementById("sosClose")?.addEventListener("click", () => dlg.close?.());
  dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close?.(); });
}

// ---- Crop-disease weather watch (Farming tab) ----
export function renderDisease(hourly) {
  const box = document.getElementById("diseaseCard"); if (!box) return;
  const days = diseaseWatch(hourly, 3);
  if (!days.length) { clearSlot("diseaseCard"); return; }
  // one line per disease: which days suit it, the most humid hours and the average temperature on those days
  const byId = new Map();
  for (const d of days) for (const h of d.hits) {
    const e = byId.get(h.id) || {id: h.id, crops: h.crops, days: [], hours: 0, temps: []};
    e.days.push(d.date); e.hours = Math.max(e.hours, h.wetHours); e.temps.push(d.meanTemp); byId.set(h.id, e);
  }
  const hits = [...byId.values()];
  const sep = my() ? "၊ " : ", ";
  drawDis = drawDis || mountDiseaseView();
  drawDis({title: L("fg_dis_title"), sub: L("fg_dis_sub"), act: L("fg_dis_act"), none: L("fg_dis_none"),
    hits: hits.map(h => L("fg_dis_hit", {
      crop: h.crops.map(c => L("fg_crop_" + c)).join(sep), name: L("fg_dis_" + h.id), days: h.days.map(fmtDay).join(sep),
      h: digits(h.hours), t: digits((h.temps.reduce((a, b) => a + b, 0) / h.temps.length).toFixed(0))}))});
}
