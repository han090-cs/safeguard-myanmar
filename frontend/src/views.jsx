// CORE entry (views.js): the screens shown on first load. React ships once, in the shared chunk.
// Screens for other tabs live in views_compare.jsx / views_farm.jsx / views_more.jsx and are loaded on demand (../lazy_views.js).
export { mountWeatherView } from "./weather_view.jsx";
export { clearSlot } from "./slots.js";
export { mountBriefView } from "./brief_view.jsx";
export { mountEnsoView, mountHealthTipsView, mountScaleView } from "./small_views.jsx";
export { mountMoonView, mountSosView, mountEmergencyView } from "./guides_view.jsx";
export { mountPulseView, mountRecentView, mountSuggestView } from "./home_views.jsx";
export { mountRiskView } from "./risk_view.jsx";
