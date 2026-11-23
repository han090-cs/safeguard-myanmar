import { wxIcon } from "./wxicon.js";
import { $, els, esc, fmtClock12, fmtPlaceDateTime, fmtTime, placeTz, tzLabel, fmtWallDateTime, setStatus, speed, state, tLocal, temp, weatherInfo } from "./core.js";
import { renderEmergency } from "./emergency_card.js";
import { renderMoon, renderSos, wireSosDialog } from "./field_guides.js";
import { loadFloodStatus, updateFloodHubLink } from "./flood_status.js";
import { renderHealthTips } from "./health_tips.js";
import { renderHospitals, cancelHospitals, loadNearbyHospitals } from "./hospitals.js";
import { MW_API_BASE, apiJSON, getWeather, isAbort, isSlowNet, loading, readWeatherCacheAny } from "./net.js";
import { clearSlot, mountPulseView, mountRecentView, mountSuggestView } from "./views.js";
let drawPulse=null, drawRecent=null, drawSuggest=null;
import { applyWeatherTheme, omTs, renderCharts, renderForecast, renderHourly, renderLocal } from "./render_cards.js";
import { mergedOfficial, safetyBadge } from "./safety.js";
import { dir, levelOf, refreshScale, setMetricLevel, showScale } from "./scale_ui.js";
import { L, isJapanese, japaneseMode, setJapanese } from "./i18n.js";
import { navigation, persistPlace, placeKey, preserveView, rememberPanelPosition, revealPanel, updateNavigation, wireTabs } from "./interaction.js";

const recentKey = "weather-recent-v3";

const geocodeMemCache = new Map(); // in-session cache so retyping never re-hits the network

// MIMU locations are loaded once from the backend so the search stays in sync
// with data/mimu_locations.db. API fields are normalized to city_name/lat/lon.

let regionRows=null,townRows=new Map(),townController=null,townTurn=0;
function pickerError(retry){if(state.data&&state.location)return; /* weather already on screen (e.g. saved copy): keep its status message */setStatus(L("ux_failed"));const b=document.createElement("button");b.type="button";b.className="ghost-btn";b.textContent=L("ux_retry");b.onclick=retry;els.status.append(" ",b);}
async function loadRegionPicker(){
  if(!els.region||!els.town)return;
  const selected=els.region.value;
  try{if(!regionRows)regionRows=(await apiJSON("/api/regions",{}, {timeout:5000})).results||[];
    els.region.innerHTML=`<option value="">${L("wx_select_region_state")}</option>`+regionRows.map(r=>`<option value="${esc(r.id)}">${esc(state.lang==="my"?r.name:r.name_en)}</option>`).join("");els.region.value=selected;
  }catch{pickerError(loadRegionPicker);}
}
async function loadRegionTowns(admin1){
  const turn=++townTurn;townController?.abort();if(!els.town)return;
  els.town.disabled=true;els.town.innerHTML=`<option value="">${L(admin1?"ux_loading":"wx_select_town")}</option>`;
  if(!admin1)return;
  const ctl=new AbortController();townController=ctl;
  try{
    let rows=townRows.get(admin1);if(!rows){rows=(await apiJSON(`/api/regions/${encodeURIComponent(admin1)}/towns`,{limit:500},{timeout:5000,signal:ctl.signal})).results||[];townRows.set(admin1,rows);}
    if(turn!==townTurn||els.region.value!==admin1)return;
    els.town.innerHTML=`<option value="">${L(rows.length?"wx_select_town":"ux_empty_towns")}</option>`+rows.map(r=>`<option value="${esc(r.id)}" data-lat="${r.latitude}" data-lon="${r.longitude}" data-name="${esc(r.name)}" data-name-en="${esc(r.name_en||r.name)}">${esc(state.lang==="my"?r.name:r.name_en||r.name)}</option>`).join("");els.town.disabled=!rows.length;
  }catch(e){if(!isAbort(e)&&turn===townTurn){els.town.innerHTML=`<option value="">${L("ux_failed")}</option>`;pickerError(()=>loadRegionTowns(admin1));}}
}

function fromMimu(r){
  // Map gazetteer.py's result shape onto the same fields MM_CITIES/geocode use.
  return { id:r.id, name:r.name, name_en:r.name_en||"", admin1:r.region_my||r.region, admin1_en:r.region||"",
           township:r.township||"", township_en:r.township_en||"", township_source:r.township_source||"",
           type:r.type||"", country:r.country, country_code:r.country_code, latitude:r.latitude, longitude:r.longitude };
}
const sameName=(x,q)=>[x.name,x.name_en].some(n=>String(n||"").trim().toLocaleLowerCase()===q.trim().toLocaleLowerCase());
// Open-Meteo geocoding is fuzzy; keep only results whose own name contains what was typed (or is one typo away, 5+ letters).
const fold=t=>String(t||"").normalize("NFKD").toLocaleLowerCase().replace(/[\u0300-\u036f]/g,"").trim();
function withinOneEdit(a,b){
  if(Math.abs(a.length-b.length)>1) return false; if(a.length>b.length)[a,b]=[b,a];
  let i=0,j=0,e=0;
  while(i<a.length&&j<b.length){ if(a[i]===b[j]){i++;j++;continue;} if(++e>1) return false; if(a.length===b.length)i++; j++; }
  return e+(b.length-j)+(a.length-i)<=1;
}
function nameMatches(q,p){
  const f=fold(q); if(!f) return false;
  const ns=[p.name,p.name_en].filter(Boolean).map(fold);
  if(ns.some(n=>n.includes(f))) return true;
  return f.length>=5&&ns.some(n=>withinOneEdit(f,n)||n.split(/\s+/).some(w=>withinOneEdit(f,w)));
}
async function remoteGeocode(q, signal){
  // Our backend first (cached, one short attempt); if it is down or degraded, ask Open-Meteo directly from the browser.
  try {
    const r = await apiJSON("/api/geocode",{name:q,language:L("wx_en"),count:10},{timeout:6000,signal,retry:false});
    if((r.results||[]).length || !r.degraded) return r.results||[];
  } catch(e) { if(isAbort(e)) throw e; }
  const ctl=new AbortController(); const onAbort=()=>ctl.abort();
  if(signal) signal.addEventListener("abort",onAbort,{once:true});
  const timer=setTimeout(()=>ctl.abort(),5000);
  try{
    const u=new URL("https://geocoding-api.open-meteo.com/v1/search");
    u.search=new URLSearchParams({name:q,count:"10",language:L("wx_en"),format:"json"});
    const r=await fetch(u,{signal:ctl.signal}); if(!r.ok) throw Error("Geocoding failed");
    return ((await r.json()).results || []).filter(x=>nameMatches(q,x));
  }finally{ clearTimeout(timer); if(signal) signal.removeEventListener("abort",onAbort); }
}
async function geocode(q, signal){
  // 1) In-session cache so retyping/backspacing never re-hits the network.
  const memKey = `${state.lang}:${q.trim().toLowerCase()}`;
  if(geocodeMemCache.has(memKey)) return geocodeMemCache.get(memKey);

  // 2) Our own MIMU gazetteer (~56k Myanmar places): fast, no external API. An exact-name match there is final.
  let mimu=[];
  try { mimu = ((await apiJSON("/api/mimu-search",{q,limit:20},{timeout:4000,signal,retry:false})).results || []).map(fromMimu); }
  catch(e) { if(isAbort(e)) throw e; /* backend slow/unreachable: carry on with the world search */ }
  if (mimu.some(x=>sameName(x,q))) { geocodeMemCache.set(memKey, mimu); return mimu; }

  // 3) World search (Open-Meteo geocoding). Myanmar gazetteer hits stay first, then other countries, then any other Myanmar hits.
  let remote=[];
  try { remote = await remoteGeocode(q, signal); }
  catch(e) { if(isAbort(e)) throw e; if(!mimu.length) throw e; }
  const foreign=remote.filter(x=>x.country_code!=="MM"), mmRemote=mimu.length?[]:remote.filter(x=>x.country_code==="MM");
  const seen=new Set(), merged=[...mimu,...foreign,...mmRemote].filter(x=>{const k=String(x.id);if(seen.has(k))return false;seen.add(k);return true;});
  if(merged.length) geocodeMemCache.set(memKey, merged);
  return merged;
}
function setSearchButtonState(searching){
  const btn=document.querySelector(".search-btn");
  if(!btn) return;
  if(searching){
    btn.disabled=true;
    btn.setAttribute("aria-busy","true");
    btn.dataset.originalLabel=btn.textContent;
    btn.innerHTML='<span class="search-spinner" aria-hidden="true"></span><span>'+(L("wx_searching"))+'</span>';
  }else{
    btn.disabled=false;
    btn.removeAttribute("aria-busy");
    btn.innerHTML=L("wx_search");
  }
}

// Global mode: places outside Myanmar get the basic cards only (CSS class body.outside-mm hides the Myanmar-only ones).
function isMyanmar(loc){
  if(loc&&loc.country_code) return loc.country_code==="MM";
  const la=Number(loc&&loc.lat),lo=Number(loc&&loc.lon);
  return !Number.isFinite(la)||!Number.isFinite(lo)||(la>=9.4&&la<=28.7&&lo>=92&&lo<=101.3);
}
function applyGlobalMode(loc){
  const out=!isMyanmar(loc);
  document.body.classList.toggle("outside-mm",out);
  if(out){
    if(document.querySelector('.tab.active')?.dataset.tab==="hospitals")switchTab("today",{record:false,reveal:false});
    if(document.getElementById("modeFarm")?.getAttribute("aria-selected")==="true")document.getElementById("modeWeather")?.click();
  }
}
function normalizePlace(loc){
  return {id:String(loc.id),name:loc.name,name_en:loc.name_en||"",admin1:loc.admin1||"",admin1_en:loc.admin1_en||"",
    township:loc.township||"",township_en:loc.township_en||"",township_source:loc.township_source||"",type:loc.type||"",
    country:loc.country||"",country_code:loc.country_code||"",lat:Number(loc.latitude),lon:Number(loc.longitude)};
}
const suggestionPlaces=new Map();
function resultLabel(loc){ return [...new Set([state.lang==="en"?(loc.name_en||loc.name):loc.name,loc.township_en||loc.township,loc.admin1_en||loc.admin1,loc.country_code&&loc.country_code!=="MM"?loc.country:"",loc.type==="Village"?(state.lang==="en"?"village":"ရွာ"):""].filter(Boolean))].join(" · "); }
function showMatches(results){
  const box=$("#searchResults"); box.replaceChildren(); box.hidden=false; box.setAttribute("aria-label",L("ux_choose_match"));
  results.slice(0,20).forEach(loc=>{
    const button=document.createElement("button"); button.type="button";button.className="ghost-btn";
    button.textContent=resultLabel(loc);button.dataset.placeId=String(loc.id);
    button.onclick=()=>{box.hidden=true;loadLocation(normalizePlace(loc));};box.appendChild(button);
  });
  setStatus(L("ux_choose_match")); box.querySelector("button")?.focus({preventScroll:true});
}
async function search(q){
  q=q.trim(); if(q.length<2){setStatus(L("wx_enter_least_2_characters"));els.input.focus();return;}
  state.searchCtl?.abort(); const ctl=new AbortController();state.searchCtl=ctl;
  setStatus("");loading(true,L("ux_resolving"));setSearchButtonState(true);$("#searchResults").hidden=true;
  try{
    const selected=suggestionPlaces.get(q);
    const rs=selected?[selected]:await geocode(q,ctl.signal);
    if(ctl.signal.aborted)return;
    if(!rs.length)throw Error(L("wx_location_not_found_check_spelling"));
    const choices=rs;
    const exact=choices.filter(x=>[x.name,x.name_en].some(n=>String(n||"").trim().toLocaleLowerCase()===q.toLocaleLowerCase()));
    if(!selected&&exact.length!==1&&choices.length!==1){showMatches(choices);return;}
    state.searchCtl=null;setSearchButtonState(false);loading(false);
    await loadLocation(normalizePlace(selected||exact[0]||choices[0]));
  }catch(e){if(!isAbort(e))setStatus(e.message||L("ux_failed"));}
  finally{if(state.searchCtl===ctl){state.searchCtl=null;setSearchButtonState(false);loading(false);}}
}

function saveRecent(loc){
  let a=[];
  try{a=JSON.parse(localStorage.getItem(recentKey)||"[]")}catch{}
  a=[loc,...a.filter(x=>x.id!==loc.id)].slice(0,7);
  try{localStorage.setItem(recentKey,JSON.stringify(a));}catch{} renderRecent();
}
function renderRecent(){
  let a=[];try{a=JSON.parse(localStorage.getItem(recentKey)||"[]")}catch{}
  a=a.filter(x=>!String(x.id).startsWith("geo:"));
  if(!a.length){
    a=[
      {id:"mm-mdy",name:"မန္တလေး",name_en:"Mandalay",admin1:"မန္တလေးတိုင်းဒေသကြီး",admin1_en:"Mandalay",country:"Myanmar",country_code:"MM",lat:21.9588,lon:96.0891},
      {id:"mm-ygn",name:"ရန်ကုန်",name_en:"Yangon",admin1:"ရန်ကုန်တိုင်းဒေသကြီး",admin1_en:"Yangon",country:"Myanmar",country_code:"MM",lat:16.8409,lon:96.1735},
      {id:"mm-npt",name:"နေပြည်တော်",name_en:"Nay Pyi Taw",admin1:"နေပြည်တော်",admin1_en:"Naypyitaw",country:"Myanmar",country_code:"MM",lat:19.7633,lon:96.0785},
      {id:"mm-mgk",name:"မိုးကုတ်",name_en:"Mogok",admin1:"မန္တလေးတိုင်းဒေသကြီး",admin1_en:"Mandalay",country:"Myanmar",country_code:"MM",lat:22.9167,lon:96.5000},
      {id:"mm-pol",name:"ပြင်ဦးလွင်",name_en:"Pyin Oo Lwin",admin1:"မန္တလေးတိုင်းဒေသကြီး",admin1_en:"Mandalay",country:"Myanmar",country_code:"MM",lat:22.0350,lon:96.4568},
      {id:"mm-tgy",name:"တောင်ကြီး",name_en:"Taunggyi",admin1:"ရှမ်းပြည်နယ်",admin1_en:"Shan",country:"Myanmar",country_code:"MM",lat:20.7892,lon:97.0378},
      {id:"mm-mgy",name:"မကွေး",name_en:"Magway",admin1:"မကွေးတိုင်းဒေသကြီး",admin1_en:"Magway",country:"Myanmar",country_code:"MM",lat:20.1496,lon:94.9325},
      {id:"mm-bg",name:"ပဲခူး",name_en:"Bago",admin1:"ပဲခူးတိုင်းဒေသကြီး",admin1_en:"Bago",country:"Myanmar",country_code:"MM",lat:17.3352,lon:96.4814}
    ];
  }
  drawRecent=drawRecent||mountRecentView();
  drawRecent(a.map(x=>({id:x.id,raw:x,label:String(x.id).startsWith("geo:")?(L("wx_current_location")):(state.lang==="my"?x.name:(x.name_en||x.name))})),x=>loadLocation(x));
}

function cancelIntent(){
  state.searchCtl?.abort();state.loadCtl?.abort();state.refreshCtl?.abort();state.sugCtl?.abort();
  state.loadSeq++;state.geoSeq=(state.geoSeq||0)+1;state.searchCtl=null;state.loadCtl=null;
  clearTimeout(state.watchdog);clearTimeout(state.searchTimer);clearInterval(state.refreshTimer);
  cancelHospitals();window.dispatchEvent(new Event("mw-cancel"));
  setSearchButtonState(false);loading(false);
}
function clearPlaceView(loc){
  state.conditionsPending=null;state.data=null;state.climate=null;state.cond=null;state.official=null;state.riskOfficial=[];state.riskFor=null;
  window.renderCompareCharts?.(null);
  ["hospitalList","hourlyDetail","rainLogCard","wxEnso","monthlyCompareBody","historyBody","feedCard","riverCard","seaCard","agriLocal","agriWater","agriHistory","healthTipsList","wmtList","hazards","conditions"].forEach(id=>clearSlot(id)); // clearSlot also empties cards that React draws, without breaking them
  els.dashboard.hidden=false;document.body.classList.add("has-location");
  window.dispatchEvent(new CustomEvent("mw-place",{detail:loc}));
  render({weather:{},air_quality:{},meta:{}},loc);
  setStatus(L("ux_weather_pending"));
}
async function loadLocation(loc,{record=true}={}){
  if(!Number.isFinite(loc.lat)||!Number.isFinite(loc.lon)){setStatus(L("ux_failed"));return;}
  const previous=state.data&&state.location?{location:state.location,data:state.data,official:state.official}:state.previousView;
  cancelIntent(); const seq=state.loadSeq; const ctl=new AbortController();state.loadCtl=ctl;
  state.previousView=previous;state.loadingPlace=true;state.location=loc;applyGlobalMode(loc);document.body.classList.remove("show-hero");
  els.input.value=(state.lang==="en"&&loc.name_en)||loc.name;$("#searchResults").hidden=true;
  if(record){saveRecent(loc);persistPlace(loc);}
  try{
  clearPlaceView(loc);loading(true);updateFloodHubLink();
  state.officialPromise=loadOfficialAlerts(loc,seq,ctl.signal);
  renderRisks();
  state.watchdog=setTimeout(()=>{if(state.loadSeq===seq){cancelIntent();state.loadingPlace=false;setStatus(L("wx_loading_took_too_long_so"));addWeatherRetry(loc);}},46000);
  const old=readWeatherCacheAny(loc.lat,loc.lon);
  if(old){const cached=structuredClone(old.data);cached.meta={...cached.meta,stale:true,saved_at:old.saved};state.data=cached;render(cached,loc);}
    const d=await getWeather(loc.lat,loc.lon,ctl.signal);
    if(state.loadSeq!==seq||ctl.signal.aborted)return;
    state.data=d;render(d,loc);
    if(!(d.meta?.fallback||d.meta?.stale))setStatus("");
    startAutoRefresh();
    loadSection(state.tab||navigation.tab);
  }catch(e){
    if(isAbort(e)||state.loadSeq!==seq)return;
    // If the last saved copy is already on screen, say so (instead of a bare error) and keep the retry button.
    setStatus(state.data?.meta?.stale?L("stale_saved"):friendlyError(e));addWeatherRetry(loc);
    // Official warnings remain visible even when weather fails.
  }finally{
    if(state.loadSeq===seq){clearTimeout(state.watchdog);loading(false);state.loadingPlace=false;state.loadCtl=null;}
  }
}
function addWeatherRetry(loc){
  const b=document.createElement("button");b.type="button";b.className="ghost-btn retry-btn";b.textContent=L("ux_retry");
  b.onclick=()=>loadLocation(loc,{record:false});els.status.append(" ",b);
}
function loadSection(name,force=false){
  const loc=state.location;if(!loc)return;
  if(name==="compare"&&!state.cond)loadConditions();
  if(name==="flood"){loadFloodStatus(state.loadSeq,state.loadCtl?.signal,{force});window.loadFeed?.(loc,true);window.loadFarmExtras?.(loc);}
  if(name==="hospitals")loadNearbyHospitals(loc,{signal:state.loadCtl?.signal,force});
  if(name==="hazards")window.loadFeed?.(loc,true);
  if(name==="world")window.loadWorld?.(force);
  if(name==="compare"){window.loadMonthlyCompare?.(loc);window.loadHistory?.(loc);}
  if(name==="lab")window.loadLab?.(loc);
}

function startAutoRefresh(){
  clearInterval(state.refreshTimer);
  state.refreshTimer=setInterval(async()=>{
    if(document.hidden||!state.location||state.loadingPlace)return;
    const loc=state.location,seq=state.loadSeq,ctl=new AbortController();state.refreshCtl=ctl;
    try{
      const d=await getWeather(loc.lat,loc.lon,ctl.signal);
      if(seq!==state.loadSeq||placeKey(loc)!==placeKey(state.location))return;
      state.data=d;state.riskFor=null;state.officialPromise=loadOfficialAlerts(loc,seq);
      render(d,loc);
    }catch{}
  },15*60*1000);
}
function render(d,loc){preserveView(()=>renderData(d,loc));}
function renderData(d,loc){
  try{renderEmergency();}catch{}
  try{renderMoon();}catch{}
  try{renderLocal(d,loc);}catch{}
  if(d.meta&&(d.meta.fallback||d.meta.stale)) setStatus(L(d.meta.stale?"stale_saved":"fallback_used", {provider:d.meta.provider||"fallback source"}));
  const w=d.weather||{}, a=d.air_quality||{}, c=w.current||{}, di=w.daily||{}, h=w.hourly||{}, wi=weatherInfo(c.weather_code);
  applyWeatherTheme(c);
  els.name.textContent=[(state.lang==="en"&&loc.name_en)||loc.name,(state.lang==="en"&&loc.township_en)||loc.township,
    (state.lang==="en"&&loc.admin1_en)||loc.admin1].filter(Boolean).join(", ");
  const townshipNote = loc.township
    ? (L("township_verified", {township: state.lang==="my" ? loc.township : (loc.township_en||loc.township)}))
    : (loc.type==="Township" ? (L("wx_township")) : "");
  els.meta.textContent=[loc.country||"Myanmar",townshipNote,`${Number(loc.lat).toFixed(4)}, ${Number(loc.lon).toFixed(4)}`,w.timezone||""].filter(Boolean).join(" · ");
  { // the DATA's own date and hour at the place (not the phone's clock), so it can be compared with a phone in any time zone
    const wall=fmtWallDateTime(c&&c.time);
    els.updated.textContent=wall?`${L("updated_data_time")}: ${wall}`:fmtPlaceDateTime(new Date());
    els.updated.title=wall?c.time:"";
    tickPlaceClock();
  }
  if(!c.time)els.updated.textContent=L(state.loadingPlace?"ux_loading":"wx_unavailable");
  if(els.sourceMini){
    const provider=d.meta?.provider||"—";
    els.sourceMini.textContent = provider === "RIMES"
      ? (L("wx_rimes_primary"))
      : provider;
    if(d.meta?.stale)els.sourceMini.textContent+=` · ${L("ux_saved_data")}`;
  }
  els.temp.textContent=temp(c.temperature_2m).replace(/°[CF]$/,"");
  document.querySelectorAll(".temp-unit").forEach(e=>e.textContent=`°${state.unit}`);
  els.feels.textContent=temp(c.apparent_temperature);
  els.condition.textContent=state.lang==="my"?wi[1]:wi[0]; els.icon.innerHTML=wxIcon(c.weather_code,Number(c.is_day)!==0);
  // The daily health card is generated from the live weather + risk result.
  updateHeroBadge();
  const my=state.lang==="my", now=Date.now();
  const rainWin=(fromMs,toMs)=>{
    const times=h.time||[], vals=h.precipitation||[]; let sum=0,n=0;
    for(let i=0;i<times.length;i++){ const ts=omTs(times[i],w), v=Number(vals[i]); if(Number.isFinite(ts)&&Number.isFinite(v)&&ts>fromMs&&ts<=toMs){sum+=v;n++;} }
    return n?sum:null;                      // null = no hourly data (never show a made-up 0.0 mm)
  };
  const rain24 = Number.isFinite(Number(d.rainfall_24h_mm)) ? Number(d.rainfall_24h_mm) : rainWin(now-24*3600000,now);
  const rainNext = rainWin(now,now+24*3600000);
  els.rainfall.textContent = rain24==null ? "—" : `${rain24.toFixed(1)} ${L("common_mm")}`;
  if(els.rainfallSource) {
    const provider=d.meta?.provider||"—";
    els.rainfallSource.textContent = `${provider} · ` + (L("wx_last_24_h")) + (rainNext==null?"":L("next_rain", {rain:rainNext.toFixed(1)}));
  }
  setMetricLevel("rain",els.rainfall,rain24);
  const chance=di.precipitation_probability_max?.[0];
  els.rainChance.textContent=chance!=null?`${Math.round(chance)}%`:"—";
  setMetricLevel("rainChance",els.rainChance,chance);
  const aqiVal=a.current?.us_aqi;
  els.aqi.textContent=aqiVal!=null?Math.round(aqiVal):"—";
  els.aqiDetail.textContent=a.current?.pm2_5!=null?`PM2.5 ${Number(a.current.pm2_5).toFixed(1)} µg/m³`:"";
  setMetricLevel("aqi",els.aqi,aqiVal);
  const uvValue=di.uv_index_max?.[0];
  els.uv.textContent=uvValue!=null?Number(uvValue).toFixed(1):(L("wx_unavailable"));
  els.uvDetail.hidden=true;
  setMetricLevel("uv",els.uv,uvValue);
  els.humidity.textContent=c.relative_humidity_2m!=null?`${Math.round(c.relative_humidity_2m)}%`:"—";
  setMetricLevel("humidity",els.humidity,c.relative_humidity_2m);
  els.wind.textContent=speed(c.wind_speed_10m); els.windDir.textContent=dir(c.wind_direction_10m,Number(String(c.time||"").slice(5,7))||null);els.windDir.title=c.wind_direction_10m==null?"":Math.round(c.wind_direction_10m)+"°";
  setMetricLevel("wind",els.wind,c.wind_speed_10m);
  els.pressure.textContent=c.pressure_msl!=null?`${Math.round(c.pressure_msl)} hPa`:"—";
  setMetricLevel("pressure",els.pressure,c.pressure_msl);
  const visKm=c.visibility!=null?c.visibility/1000:null;
  els.visibility.textContent=visKm!=null?`${visKm.toFixed(1)} ${L("common_km")}`:"—";
  setMetricLevel("visibility",els.visibility,visKm);
  els.sunrise.textContent=fmtTime(di.sunrise?.[0]); els.sunset.textContent=fmtTime(di.sunset?.[0]);
  const heat=levelOf("heat",c.apparent_temperature), fl=document.getElementById("feelsLevel");
  state.levelValues.heat=c.apparent_temperature;
  if(fl){ fl.className=heat?`lvl-pill t${heat.step.tone}`:""; fl.textContent=heat?(my?heat.step.my:heat.step.en):""; fl.title=heat?(my?heat.step.tipMy:heat.step.tipEn):""; }
  renderHourly(h,w); renderForecast(di); refreshScale(); renderRisks(); renderCharts(di);
  renderHealthTips();
  renderHospitals();
  renderTranslations();
}

function renderSafetyAlertSummary(){
  const alerts=mergedOfficial();
  if(!els.safetyAlertTitle) return;
  if(!alerts.length){
    safetyBadge(els.safetyAlertBadge,L("wx_none"), "good");
    els.safetyAlertTitle.textContent=L("wx_no_active_warning_location");
    els.safetyAlertText.textContent=L("wx_keep_monitoring_official_dmh_updates");
    return;
  }
  const a=alerts[0], title=(a.title&&(a.title[state.lang]||a.title.en||a.title.my))||"DMH warning";
  const urgent=/flood|cyclone|heavy|storm|tsunami/i.test(a.type||"");
  safetyBadge(els.safetyAlertBadge,urgent?(L("wx_urgent")):(L("wx_watch")),urgent?"urgent":"watch");
  els.safetyAlertTitle.textContent=title;
  els.safetyAlertText.textContent=(a.regions||[]).join(" · ")||"Myanmar";
}

// Health and hazard notices come from the backend risk engine (/api/v1/..., see RISK_ENGINE.md) and are drawn by
// risk_panel.js. The engine replaced the old in-browser thresholds, which read the latest-interval rainfall as a
// 24-hour total, started "poor" air quality at AQI 150 instead of 151, called 60 km/h "storm-force" and ignored humidity.
function renderRisks(){
  const loc=state.location;
  if(!loc) return;
  if(!window.MWRisk){ els.riskScore.textContent="—"; els.risk.textContent="—"; return; }
  const key=`${Number(loc.lat).toFixed(4)},${Number(loc.lon).toFixed(4)}`;
  if(state.riskFor && state.riskFor.key===key){
    MWRisk.setLang(els.hazards,state.lang);          // language/unit toggle: redraw only, no new request
    MWRisk.setLang(els.conditions,state.lang);
    updateRiskSummary(state.riskFor.result);
    return;
  }
  const mine={key,data:state.data,result:null};
  state.riskFor=mine;
  els.riskScore.textContent="…"; els.riskScore.className="risk-score low";
  els.risk.hidden=false; clearSlot("wmtList");
  els.risk.textContent=L("wx_loading_health_notices");
  MWRisk.render(els.hazards,{lat:loc.lat,lon:loc.lon,region:loc.admin1||"",lang:state.lang,header:false,apiBase:MW_API_BASE,
    onResult:res=>{
      if(state.riskFor!==mine) return;
      mine.result=res; updateRiskSummary(res);
      renderHealthTips();
    }});
}

// Climate tab "Compared with normal" (ERA5 1991–2020) and the hero badge, from /api/v1/climate.
function loadConditions(){
  const loc=state.location;
  if(!loc||!window.MWRisk||!MWRisk.renderConditions) return;
  const key=placeKey(loc);if(state.conditionsPending===key)return;state.conditionsPending=key;
  MWRisk.renderConditions(els.conditions,{lat:loc.lat,lon:loc.lon,lang:state.lang,apiBase:MW_API_BASE,
    onResult:r=>{ if(placeKey(state.location)!==key) return; state.conditionsPending=null;state.cond=r.ok?r.data:null; updateHeroBadge(); try{window.renderCompareCharts&&window.renderCompareCharts(state.cond);}catch{} }});
}

function updateHeroBadge(){
  const c=(state.cond?.conditions||[]).find(x=>x.kind==="temperature_max"&&x.level&&x.level_label);
  if(!c){ els.severity.hidden=true; return; }
  const up=/above/.test(c.level), down=/below/.test(c.level);
  els.severity.hidden=false;
  els.severity.className=`badge ${up?"hot":down?"cool":"normal"}`;
  els.severity.textContent=`${up?"↑":down?"↓":"＝"} ${c.level_label[state.lang]||c.level_label.en}`;
  els.severity.title=c.headline[state.lang]||c.headline.en;
}

async function loadOfficialAlerts(loc,seq,signal){
  try{
    const j=await apiJSON("/api/dmh/alerts",{lat:loc.lat,lon:loc.lon,region:loc.admin1_en||loc.admin1||""},{timeout:8000,signal});
    if(state.loadSeq!==seq) return;
    state.official={ok:true,alerts:(j.alerts||[]).filter(a=>a.active!==false),status:{...j.source_status,stale:!!j.source_status?.stale || !j.source_status?.last_success_at || Date.now()-Date.parse(j.source_status.last_success_at)>3*3600000}};
    renderSafetyAlertSummary();
  }catch(e){
    if(state.loadSeq!==seq||isAbort(e)) return;          // superseded or deliberately cancelled
    state.official={ok:false,alerts:[],status:null};
    renderSafetyAlertSummary();
  }
  renderOfficialPulse();
  updateOfficialBadge();
}
function renderOfficialPulse(){
  try{window.setBriefOfficial&&window.setBriefOfficial(mergedOfficial().length);}catch{}
  if(!document.getElementById("officialPulse")) return;
  drawPulse=drawPulse||mountPulseView();
  const off=state.official, list=mergedOfficial(), DMH="https://www.moezala.gov.mm/";
  const note=(icon,title,small)=>({kind:"note",icon,title,small,dmh:DMH});
  if(list.length){
    drawPulse({kind:"list",validUntil:L("wx_valid_until"),original:L("wx_original"),
      stale:(off?.status?.stale||state.riskFor?.result?.offline)?`${L("ux_saved_data")} · ${L("wx_dmh_data_not_refreshed_recently")}`:"",
      rows:list.slice(0,3).map(a=>{
        const type=a.type||"warning";
        return {title:(a.title&&(a.title[state.lang]||a.title.en||a.title.my))||"DMH official warning",regions:(a.regions||[]).join(" · ")||"Myanmar",
          until:a.valid_to?fmtPlaceDateTime(a.valid_to):"",href:(a.links&&(a.links[state.lang]||a.links.en))||a.url||DMH,
          urgent:/flood|cyclone|heavy|storm|tsunami/i.test(type),icon:/flood|tsunami/i.test(type)?"🌊":/cyclone|storm/i.test(type)?"🌀":"⚠️"};})});
    return;
  }
  if(!off){ drawPulse({kind:"pending",title:L("wx_checking_dmh_official_warnings")}); return; }
  if(!off.ok){ drawPulse(note("⚠️",L("wx_couldn_t_check_official_warnings"),L("wx_please_check_dmh_website_directly"))); return; }
  const st=off.status||{}, last=st.last_success_at?fmtPlaceDateTime(st.last_success_at):null;
  if(st.stale||st.importer_enabled===false){
    drawPulse(note("⚠️",L("wx_dmh_data_hasn_t_been"),(L("wx_last_checked"))+(last||"—")+(L("wx_so_don_t_read_no"))));
    return;
  }
  drawPulse({kind:"clear",title:L("wx_no_active_dmh_official_warning"),small:`${L("wx_last_checked_2")}: ${last||"—"} · ${L("wx_absence_warning_does_not_mean")}`});
}
// Summary badge on the Today tab when the risk engine result is not (yet) available.
function updateOfficialBadge(){
  if(state.riskFor&&state.riskFor.result) return;          // updateRiskSummary owns the badge once the engine answered
  const n=mergedOfficial().length;
  if(n){ els.riskScore.className="risk-score high"; els.riskScore.textContent=`◆ ${L("wx_official_warning")}`; }
}

function updateRiskSummary(res){
  if(!res) return;
  const locText=v=>v?(v[state.lang]||v.en||""):"";
  state.riskOfficial=(res.ok&&res.data&&res.data.official_warnings)||[];
  renderOfficialPulse();
  const official=mergedOfficial();
  if(!res.ok){
    // The health/model part failed (e.g. forecast provider down) — official warnings above are unaffected.
    els.riskScore.className=`risk-score ${official.length?"high":"low"}`;
    els.riskScore.textContent=official.length?`◆ ${L("wx_official_warning")}`:"—";
    els.risk.hidden=false; clearSlot("wmtList");
    els.risk.textContent=res.status==="outside"
      ?(L("wx_health_notices_available_only_places"))
      :(L("wx_health_notices_couldn_t_loaded"));
    return;
  }
  // Badge = the highest message class the engine assigned (shape + text; colour only reinforces).
  const rank={information:1,watch:2,advisory:3};
  const items=res.data.items||[];
  const top=items.reduce((m,i)=>(rank[i.alert_class]||0)>(m?rank[m.alert_class]||0:0)?i:m,null);
  const cls=official.length?"official_warning":top?top.alert_class||"information":null;
  const glyph={official_warning:"◆",advisory:"▲",watch:"△",information:"●"};
  els.riskScore.className=`risk-score ${cls==="official_warning"||cls==="advisory"?"high":cls==="watch"?"medium":"low"}`;
  els.riskScore.textContent=cls==="official_warning"?`${glyph[cls]} ${L("wx_official_warning")}`
    :top?`${glyph[cls]||""} ${locText(top.alert_class_label)||locText(top.severity_label)}`:(L("wx_no_notices"));
  els.risk.hidden=true;
  MWRisk.renderSummary(els.wmtList,res,{lang:state.lang,onSeeAll:()=>{switchTab("hazards",{focus:true});}});
}

/* Phone only: long Today cards are cut to a short height with a "show more" button that sits OUTSIDE the Preact root,
   so language changes and re-renders never remove it. Desktop/tablet are untouched (CSS applies the cut only <=650px). */
function setupMobileFolds(){
  [["todayBrief",300]].forEach(([id,h])=>{
    const sec=document.getElementById(id); if(!sec) return;
    let b=document.getElementById(id+"Fold");
    if(!b){
      sec.classList.add("m-fold"); sec.style.setProperty("--fold-h",h+"px");
      sec.insertAdjacentHTML("afterend",`<button id="${id}Fold" class="ghost-btn m-fold-btn" type="button" aria-expanded="false"></button>`);
      b=document.getElementById(id+"Fold");
    }
    b.textContent=sec.classList.contains("m-open")?L("wx_show_less"):L("wx_show_more_details");
  });
}
// the ten key numbers: four on phones and tablets, the rest behind one button (CSS hides them below 1024px; desktop shows all ten)
function setupMetricFold(){
  const grid=document.querySelector(".metric-grid"); if(!grid) return;
  let b=document.getElementById("metricFold");
  if(!b){
    grid.insertAdjacentHTML("afterend",'<button id="metricFold" class="ghost-btn m-fold-btn" type="button" aria-expanded="false" aria-controls="metricGridBox"></button>');
    grid.id=grid.id||"metricGridBox"; b=document.getElementById("metricFold"); b.setAttribute("aria-controls",grid.id);
  }
  b.textContent=grid.classList.contains("m-open")?L("wx_show_less"):L("wx_show_more_details");
}
// One delegated listener for both "show more details" buttons. It looks the card up at click time, so it keeps working even if a
// re-render replaces the card or the button, and there is never a second handler that could toggle it back.
document.addEventListener("click",e=>{
  const b=e.target&&e.target.closest?e.target.closest("#metricFold,#todayBriefFold"):null; if(!b) return;
  const box=b.id==="metricFold"?document.querySelector(".metric-grid"):document.getElementById("todayBrief"); if(!box) return;
  const open=box.classList.toggle("m-open");
  b.setAttribute("aria-expanded",String(open));
  b.textContent=open?L("wx_show_less"):L("wx_show_more_details");
  // closing a long card while its top is above the screen would leave the reader somewhere below it: bring its top back into view
  if(!open&&box.getBoundingClientRect().top<0) box.scrollIntoView({block:"start"});
});
window.addEventListener("mw-lang",()=>setTimeout(()=>{setupMobileFolds();setupMetricFold();},0));
document.addEventListener("DOMContentLoaded",setupMetricFold);setupMetricFold();
window.addEventListener("mw-lang",()=>setTimeout(setupMobileFolds,0));
document.addEventListener("DOMContentLoaded",setupMobileFolds);
setupMobileFolds();

/* ---- Farming tab, heat card, cyclone note, El Niño (all per selected place) ---- */
window.__mwLang=()=>state.lang;
window.__mwRetext=()=>{try{renderTranslations();}catch{}};

/* text size + offline notice */
(function(){
  window.addEventListener("offline",()=>setStatus(L("wx_offline_showing_last_saved_data")));
  window.addEventListener("online",()=>setStatus(""));
})();

(function(){
  const show=()=>{ if(!isSlowNet()||document.getElementById("netHint")) return;
    const st=document.getElementById("status"); if(!st) return;
    const d=document.createElement("div"); d.id="netHint"; d.className="tiny muted net-hint";
    d.textContent=L("wx_slow_connection_loading_only_what");
    st.insertAdjacentElement("afterend",d); };
  window.addEventListener("load",show);
  setInterval(()=>{ if(!isSlowNet()){const n=document.getElementById("netHint"); if(n) n.remove();} else show(); },8000);
})();

function renderLiteToggle(){
  let b=document.getElementById("liteToggle");
  if(!b){
    const f=document.querySelector("footer"); if(!f) return;
    f.insertAdjacentHTML("beforeend",'<div><button id="liteToggle" class="ghost-btn" type="button" aria-pressed="false"></button></div>');
    b=document.getElementById("liteToggle");
    b.onclick=()=>{let on=false; try{on=localStorage.getItem("mw_lite")==="1";}catch{}
      try{localStorage.setItem("mw_lite",on?"0":"1");}catch{} if(on){state.slowSeen=false;state.slowUntil=0;}renderLiteToggle();
      setStatus(L(on?"data_saver_off":"data_saver_on"));};
  }
  let on=false; try{on=localStorage.getItem("mw_lite")==="1";}catch{}
  b.setAttribute("aria-pressed",on);
  b.textContent=(L("wx_data_saver"))+(on?(L("wx_text")):(L("wx_off")));
}

/* Turn technical/English error messages into one short sentence in the user's language. */
function friendlyError(e){
  const m=String((e&&e.message)||"");
  if(/temporarily unavailable|providers/i.test(m)) return L("wx_weather_providers_temporarily_unavailable_please");
  if(/timed out|timeout|abort/i.test(m)) return L("wx_connection_was_too_slow_timed");
  if(/NetworkError|Failed to fetch|Load failed|network/i.test(m)) return L("wx_no_internet_connection_check_connection");
  if(/rate|429|too many/i.test(m)) return L("wx_too_many_requests_please_wait");
  return L("wx_could_not_load_weather_please");
}
function renderTranslations(){
  document.querySelectorAll("[data-i18n]").forEach(e=>e.textContent=tLocal(e.dataset.i18n));
  document.querySelectorAll("[data-i18n-aria]").forEach(e=>e.setAttribute("aria-label",tLocal(e.dataset.i18nAria)));
  if(els.region&&els.region.options[0]) els.region.options[0].textContent=L("wx_select_region_state");
  if(els.town&&els.town.options[0]) els.town.options[0].textContent=L("wx_select_town");
  renderRecent(); renderEmergency(); renderSos(); wireSosDialog(); setupMetricFold(); renderLiteToggle();
  if(regionRows)loadRegionPicker();
  window.dispatchEvent(new Event("mw-lang"));
  els.input.placeholder=L("wx_search_city_township");
  document.documentElement.lang=isJapanese()?"ja":state.lang;
  $("#unitToggle").textContent=`°${state.unit}`;
  const lt=$("#languageToggle"); if(lt){ lt.textContent=state.lang==="my"?"မြန်မာ":(isJapanese()?(japaneseMode()===2?"やさしい":"日本語"):"English"); lt.setAttribute("aria-label","Language / ဘာသာစကား / 言語: "+lt.textContent); lt.setAttribute("aria-haspopup","dialog");document.querySelectorAll("#langSheet [data-lang]").forEach(b=>{const cur=(state.lang==="my"?"my":(isJapanese()?(japaneseMode()===2?"easy":"ja"):"en"))===b.dataset.lang;b.classList.toggle("on",cur);b.setAttribute("aria-checked",String(cur));}); }
}

function switchTab(name,{record=true,reveal=true,focus=false}={}){
  if(reveal)rememberPanelPosition();
  if(!["today","forecast","flood","hospitals","hazards","compare","world","lab"].includes(name))name="today";
  state.tab=name;state.activeTab=name;document.body.dataset.wtab=name;   // pro.css shows the Today summary (warnings, current weather, tiles) on the Today tab only
  document.querySelectorAll(".tab").forEach(b=>{const on=b.dataset.tab===name;b.classList.toggle("active",on);b.setAttribute("aria-selected",String(on));});
  document.querySelectorAll(".tab-panel").forEach(p=>p.hidden=p.dataset.panel!==name);
  if(record)updateNavigation({tab:name});loadSection(name);
  if(reveal)revealPanel(`weather:${name}`,document.querySelector(`[data-panel="${name}"]`),{focus});
}

function bind(){
  renderRecent(); renderTranslations();
  document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
  document.querySelectorAll("[data-tab-target]").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tabTarget)));
  $("#floodRefresh")?.addEventListener("click",()=>loadSection("flood",true));
  $("#hospitalRefresh")?.addEventListener("click",()=>loadSection("hospitals",true));
  $("#searchForm").onsubmit=e=>{e.preventDefault();search(els.input.value);};
  // Desktop: small always-visible search in the top bar once a place is shown. It feeds the main search, so suggestions,
  // world search and "which one?" lists all behave exactly the same.
  const top=document.getElementById("topSearch"), topIn=document.getElementById("topSearchInput");
  if(top&&topIn){
    topIn.addEventListener("input",()=>{els.input.value=topIn.value;els.input.dispatchEvent(new Event("input",{bubbles:true}));});
    top.addEventListener("submit",e=>{e.preventDefault();const q=topIn.value.trim();if(q.length<2)return;document.body.classList.add("show-hero");window.scrollTo(0,0);els.input.value=q;search(q);topIn.blur();});
    window.addEventListener("mw-place",()=>{top.hidden=false;topIn.value="";});
  }
  if(els.region) els.region.onchange=()=>loadRegionTowns(els.region.value);
  if(els.town) els.town.onchange=()=>{const o=els.town.selectedOptions[0];if(o&&o.dataset.lat){loadLocation({id:o.value,name:o.dataset.name||o.textContent,name_en:o.dataset.nameEn||o.textContent,admin1:els.region.value,lat:Number(o.dataset.lat),lon:Number(o.dataset.lon),country:"Myanmar",country_code:"MM",type:"Town"});}};
  loadRegionPicker();
  const tabButtons=[...document.querySelectorAll(".tab")];
  wireTabs(document.querySelector("nav[aria-label='Dashboard sections']"),tabButtons,tabButtons.map(b=>document.querySelector(`[data-panel="${b.dataset.tab}"]`)));
  switchTab(navigation.tab,{record:false,reveal:false});
  document.querySelector(".skip-link")?.addEventListener("click",e=>{e.preventDefault();const target=state.location?els.dashboard:document.querySelector("#searchForm");target.tabIndex=-1;target.focus();target.scrollIntoView({block:"start"});});
  $("#currentLocation").onclick=()=>{
    cancelIntent();const seq=state.geoSeq;
    if(!navigator.geolocation){setStatus(L("wx_geolocation_not_supported"));return;}
    loading(true,L("ux_resolving"));
    navigator.geolocation.getCurrentPosition(
      p=>{if(seq!==state.geoSeq)return;loadLocation({id:`geo:${p.coords.latitude},${p.coords.longitude}`,name:L("wx_current_location"),name_en:"Current location",country:"",admin1:"",lat:p.coords.latitude,lon:p.coords.longitude});},
      ()=>{if(seq!==state.geoSeq)return;loading(false);setStatus(L("wx_could_not_access_location_check"));els.input.focus();},
      {enableHighAccuracy:true,timeout:10000,maximumAge:300000});
  };
  $("#unitToggle").onclick=()=>{state.unit=state.unit==="C"?"F":"C";try{localStorage.setItem("unit",state.unit);}catch{}$("#unitToggle").textContent=`°${state.unit}`;if(state.data&&state.location)render(state.data,state.location);};
  const langSheet=$("#langSheet"),langBack=$("#langBackdrop");
  const closeLang=(back=true)=>{langSheet.hidden=true;langBack.hidden=true;if(back)$("#languageToggle")?.focus();};
  const openLang=()=>{langSheet.hidden=false;langBack.hidden=false;(langSheet.querySelector("[data-lang].on")||langSheet.querySelector("[data-lang]")).focus();};
  async function chooseLang(code){
    if(code==="my"){state.lang="my";await setJapanese(false);}
    else if(code==="en"){state.lang="en";await setJapanese(false);}
    else{state.lang="en";await setJapanese(code==="easy"?"easy":true);}
    try{localStorage.setItem("lang",state.lang);localStorage.setItem("lang_ja",String(japaneseMode()));}catch{}
    renderTranslations();if(state.data&&state.location){render(state.data,state.location);renderHealthTips();}
    // Flood / DMH / hospital panels build their own text, so refresh them in the new language.
    try{renderHospitals();loadFloodStatus(state.loadSeq,undefined,{cachedOnly:true});}catch{}
  }
  $("#languageToggle").onclick=()=>openLang();
  langBack.onclick=()=>closeLang();
  langSheet.addEventListener("click",async e=>{const b=e.target.closest("[data-lang]");if(b){await chooseLang(b.dataset.lang);closeLang();}});
  langSheet.addEventListener("keydown",e=>{if(e.key==="Escape"){e.preventDefault();closeLang();}if(e.key==="Tab"){const f=[...langSheet.querySelectorAll("[data-lang]")];const k=f.indexOf(document.activeElement);if(e.shiftKey&&k<=0){e.preventDefault();f[f.length-1].focus();}else if(!e.shiftKey&&k===f.length-1){e.preventDefault();f[0].focus();}}});
  els.input.addEventListener("input",()=>{
    clearTimeout(state.searchTimer);state.sugCtl?.abort();suggestionPlaces.clear();clearSlot("locationSuggestions");$("#searchResults").hidden=true;
    const q=els.input.value.trim();const turn=(state.suggestionTurn||0)+1;state.suggestionTurn=turn;
    if(q.length<2)return;
    state.searchTimer=setTimeout(async()=>{
      const ctl=new AbortController();state.sugCtl=ctl;
      try{
        const rs=await geocode(q,ctl.signal);if(ctl.signal.aborted||state.suggestionTurn!==turn)return;
        const options=[...rs.filter(x=>x.country_code==="MM"),...rs.filter(x=>x.country_code!=="MM")].slice(0,8).map(x=>{
          const label=resultLabel(x);suggestionPlaces.set(label,x);return {value:label,text:x.country||""};
        });drawSuggest=drawSuggest||mountSuggestView();drawSuggest(options);
      }catch{}
    },350);
  });
  // Stop button: cancels the search and any parts still loading; whatever already arrived stays.
  $("#loadingCancel")?.addEventListener("click",()=>{
    const previous=state.loadingPlace&&state.previousView;cancelIntent();state.loadingPlace=false;
    if(previous){Object.assign(state,previous);state.riskFor=null;render(previous.data,previous.location);persistPlace(previous.location,{replace:true});}
    setStatus(L("ux_cancelled"));
  });
  // "ⓘ Scale" buttons on the metric cards open one shared explanation panel.
  document.addEventListener("click",e=>{
    const more=e.target.closest?.(".lvl-more"); if(more){ showScale(more.dataset.scale); return; }
    if(e.target.closest?.(".scale-close")){ const p=document.getElementById("scalePanel"); if(p){p.hidden=true;document.querySelector(`.lvl-more[data-scale="${p.dataset.key}"]`)?.focus({preventScroll:true});} }
  });
}
bind();
async function restoreLocation(nav){
  if(nav.place){if(placeKey(state.location)!==placeKey(nav.place))await loadLocation(nav.place,{record:false});return;}
  if(nav.placeId&&nav.query){
    // A place the person already used is saved on this device: open it from there (works offline, no search needed).
    try{const saved=JSON.parse(localStorage.getItem(recentKey)||"[]").find(x=>String(x.id)===String(nav.placeId));if(saved){await loadLocation(normalizePlace(saved),{record:false});return;}}catch{}
    try{const rs=await geocode(nav.query);const loc=rs.find(x=>String(x.id)===String(nav.placeId));if(loc){await loadLocation(normalizePlace(loc),{record:false});return;}}catch{}
    setStatus(L("ux_restore_failed"));return;
  }
  if(state.location){cancelIntent();state.location=null;state.data=null;els.dashboard.hidden=true;document.body.classList.remove("has-location");document.body.dataset.located="0";document.body.classList.add("show-hero");els.input.value="";}
}
window.addEventListener("mw-navigation",async e=>{switchTab(e.detail.tab,{record:false,reveal:false});await restoreLocation(e.detail);if(e.detail.mode==="weather"&&state.location)switchTab(e.detail.tab,{record:false});});
restoreLocation(navigation);
window.addEventListener("mw-refresh",()=>{if(state.location&&!state.loadingPlace)loadLocation(state.location,{record:false});});

// Optional browser notifications: explicitly enabled by the user, never automatic.
window.addEventListener("load", () => {
  const getLocation = () => {
    const loc = window.__MWR_GET_LOCATION__ ? window.__MWR_GET_LOCATION__() : null;
    return loc || null;
  };
  // Expose a small read-only bridge for notifications without exposing the mutable app state.
  window.__MWR_GET_LOCATION__ = () => {
    try {
      const s = window.MWR_STATE || null;
      return s && s.location ? {lat:s.location.latitude || s.location.lat, lon:s.location.longitude || s.location.lon,
        region:s.location.admin1_en || s.location.region, name:s.location.name} : null;
    } catch { return null; }
  };
  if (window.MWRNotifications) window.MWRNotifications.start(getLocation);
});

function applyChartHeights(){
  document.querySelectorAll("[data-height]").forEach(el=>{
    const h=Number(el.dataset.height);
    if(Number.isFinite(h)) el.style.setProperty("--bar-height", Math.max(0,Math.min(100,h))+"%");
  });
}

new MutationObserver(applyChartHeights).observe(document.body,{childList:true,subtree:true});

// Live clock of the searched place (12-hour AM/PM) with its time-zone name, beside the change button.
function tickPlaceClock(){
  const t=document.getElementById("placeClock"), n=document.getElementById("placeTzName");
  if(!t||!n) return;
  t.textContent=fmtClock12(new Date(),placeTz()); n.textContent=tzLabel(placeTz());
}
tickPlaceClock(); setInterval(tickPlaceClock,15000);
document.addEventListener("mw-place",()=>setTimeout(tickPlaceClock,0));
