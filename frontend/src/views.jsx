// Single entry: every React screen is exported from ONE bundle (views.js) so React is shipped once.
export { mountAgriView } from "./agri_view.jsx";
export { mountWeatherView } from "./weather_view.jsx";
export { mountCompareView } from "./compare_view.jsx";
export { mountMonthlyView } from "./monthly_view.jsx";
export { mountHistoryView } from "./history_view.jsx";
export { clearSlot } from "./slots.js";
export { mountFeedsView } from "./feeds_view.jsx";
export { mountHospitalsView } from "./hospitals_view.jsx";
export { mountRainLogView } from "./rainlog_view.jsx";
export { mountBriefView } from "./brief_view.jsx";
export { mountEnsoView, mountHealthTipsView, mountScaleView } from "./small_views.jsx";
export { mountMoonView, mountSosView, mountEmergencyView, mountDiseaseView } from "./guides_view.jsx";
export { mountPulseView, mountRecentView, mountSuggestView } from "./home_views.jsx";
export { mountAboutView } from "./about_view.jsx";
export { mountRiskView } from "./risk_view.jsx";
