// Shared state, DOM references and small formatting helpers used by every part of the weather page.
import { L, WEATHER_CODES, t } from "./i18n.js";

export const $ = s => document.querySelector(s);

export const els = {
  input: $("#locationInput"), suggestions: $("#locationSuggestions"), region: $("#regionSelect"), town: $("#townSelect"), status: $("#status"), loading: $("#loading"),
  dashboard: $("#dashboard"), name: $("#locationName"), meta: $("#locationMeta"), updated: $("#updatedAt"),
  sourceMini: $("#sourceMini"), temp: $("#temperature"), feels: $("#feelsLike"), condition: $("#condition"), icon: $("#weatherIcon"),
  severity: $("#severityBadge"), risk: $("#riskNarrative"), riskScore: $("#riskScore"),
  rainfall: $("#rainfall"), rainfallSource: $("#rainfallSource"), rainChance: $("#rainChance"), aqi: $("#aqi"), aqiDetail: $("#aqiDetail"),
  uv: $("#uvIndex"), uvDetail: $("#uvDetail"), humidity: $("#humidity"), wind: $("#wind"),
  windDir: $("#windDirection"), pressure: $("#pressure"), visibility: $("#visibility"),
  sunrise: $("#sunrise"), sunset: $("#sunset"), hourly: $("#hourlyForecast"), forecast: $("#forecast"),
  hazards: $("#hazards"), tempChart: $("#tempChart"), rainChart: $("#rainChart"),
  climateSummary: $("#climateSummary"), climateChart: $("#climateChart"), outlook: $("#outlook"),
  recent: $("#recentLocations"), wmtList: $("#wmtList"), conditions: $("#conditions"),
  hospitalList: $("#hospitalList"), hospitalSource: $("#hospitalSource"),
  safetyFloodBadge: $("#safetyFloodBadge"), safetyFloodTitle: $("#safetyFloodTitle"), safetyFloodText: $("#safetyFloodText"), safetyFloodLink: $("#safetyFloodLink"),
  safetyAlertBadge: $("#safetyAlertBadge"), safetyAlertTitle: $("#safetyAlertTitle"), safetyAlertText: $("#safetyAlertText"),
  safetyHospitalBadge: $("#safetyHospitalBadge"), safetyHospitalTitle: $("#safetyHospitalTitle"), safetyHospitalText: $("#safetyHospitalText"),
  healthTips: $("#healthTipsList"), healthIntro: $("#healthTipsIntro"), dmhStatus: $("#dmhSourceStatus"), dmhGrid: $("#dmhSourceGrid"), floodLink: $("#floodHubLink"), floodStatusTitle: $("#floodStatusTitle"), floodStatusText: $("#floodStatusText")
};

// Storage can throw (private mode, blocked cookies, Facebook/Viber in-app browsers): never let that stop the app from starting.
function safeGet(k){ try{ return localStorage.getItem(k); }catch{ return null; } }

export const state = {
  unit: safeGet("unit") || "C",
  lang: safeGet("lang") || "my",
  location: null, data: null, climate: null,
  searchTimer: null, refreshTimer: null,
  loadSeq: 0, loadCtl: null, searchCtl: null, watchdog: null,
  official: null, riskOfficial: [], levelValues: {}
};
window.MWR_STATE = state;

const W = WEATHER_CODES;

export function tLocal(k){ return t(state.lang, k); }

export function temp(v){
  if(v == null || Number.isNaN(Number(v))) return "—";
  return state.unit==="F" ? `${Math.round(v*9/5+32)}°F` : `${Math.round(v)}°C`;
}

export function speed(v){ return v==null ? "—" : `${Math.round(v)} km/h`; }

export function fmtTime(s){
  if(!s) return "—";
  const m=/[T ](\d{2}):(\d{2})/.exec(String(s)); // wall-clock time at the place, 24h, the same on every device
  return m ? m[1]+":"+m[2] : "—";
}

// ---- Dates and times: always the PLACE's own clock, same text on every phone ----
// Browsers without Burmese locale data silently print English ("October 16 at 15:05"), so months, weekdays and digits are written here.
const MY_MONTHS=["ဇန်နဝါရီ","ဖေဖော်ဝါရီ","မတ်","ဧပြီ","မေ","ဇွန်","ဇူလိုင်","ဩဂုတ်","စက်တင်ဘာ","အောက်တိုဘာ","နိုဝင်ဘာ","ဒီဇင်ဘာ"];
const EN_MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MY_DAYS=["တနင်္ဂနွေ","တနင်္လာ","အင်္ဂါ","ဗုဒ္ဓဟူး","ကြာသပတေး","သောကြာ","စနေ"];
const EN_DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export function digits(v){ const s=String(v); return state.lang==="my" ? s.replace(/\d/g,x=>"၀၁၂၃၄၅၆၇၈၉"[x]) : s; }
export function placeTz(){ return state.data?.weather?.timezone || "Asia/Yangon"; }
function mdText(m,d){ return state.lang==="my" ? `${MY_MONTHS[m-1]} ${digits(d)} ရက်` : `${EN_MONTHS[m-1]} ${d}`; }
// An instant (Date / epoch) shown on the clock of the place it belongs to, not of the viewer's phone.
export function fmtPlaceDateTime(when,tz=placeTz()){
  const dt=when instanceof Date ? when : new Date(when);
  if(isNaN(dt)) return "—";
  const o={};
  try{ for(const p of new Intl.DateTimeFormat("en-GB",{timeZone:tz,month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(dt)) o[p.type]=p.value; }
  catch{ return tz!=="Asia/Yangon" ? fmtPlaceDateTime(dt,"Asia/Yangon") : "—"; }
  return `${mdText(+o.month,+o.day)} ${digits(o.hour+":"+o.minute)}`;
}
// 12-hour clock with AM/PM on the clock of the place ("3:05 PM"); same text on every phone.
export function fmtClock12(when,tz=placeTz()){
  const dt=when instanceof Date ? when : new Date(when);
  if(isNaN(dt)) return "—";
  const o={};
  try{ for(const p of new Intl.DateTimeFormat("en-GB",{timeZone:tz,hour:"numeric",minute:"2-digit",hourCycle:"h23"}).formatToParts(dt)) o[p.type]=p.value; }
  catch{ return tz!=="Asia/Yangon" ? fmtClock12(dt,"Asia/Yangon") : "—"; }
  const h=+o.hour;
  return `${digits((h%12)||12)}:${digits(o.minute)} ${h<12?"AM":"PM"}`;
}
export function tzLabel(tz=placeTz()){
  const city=String(tz||"Asia/Yangon").split("/").pop().replace(/_/g," ");
  return city==="Rangoon"?"Yangon Time Zone":`${city} Time Zone`;
}
// Open-Meteo gives "2026-10-16T14:05" = wall-clock time AT the place; read it as text so the viewer's time zone cannot shift it.
export function fmtWallDateTime(str){
  const m=/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(str||""));
  if(!m) return "";
  const h=+m[4];
  return `${mdText(+m[2],+m[3])} ${digits((h%12)||12)}:${digits(m[5])} ${h<12?"AM":"PM"}`;
}
export function fmtDay(str){
  const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(str||"")); if(!m) return "";
  const wd=new Date(Date.UTC(+m[1],+m[2]-1,+m[3])).getUTCDay();
  return state.lang==="my" ? `${MY_DAYS[wd]} · ${mdText(+m[2],+m[3])}` : `${EN_DAYS[wd]}, ${mdText(+m[2],+m[3])}`; // English keeps the familiar "Sat, Oct 17"
}

export function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}

export function weatherInfo(code){return W[code] || [L("weather_unknown"),L("weather_unknown"),"🌤️"];}

export function setStatus(msg,show=true){
  els.status.classList.remove("status-action");
  els.status.textContent=msg; els.status.hidden=!show||!msg;
  els.input?.setAttribute("aria-invalid", String(!!msg && !state.location));
}
