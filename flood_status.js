// River/flood status, Flood Hub link and the DMH sources panel.
import { els, state } from "./core.js";
import { L } from "./i18n.js";
import { placeKey } from "./interaction.js";
import { apiJSON } from "./net.js";
import { mergedOfficial, safetyBadge } from "./safety.js";

export function updateFloodHubLink(){
  if(!els.floodLink || !state.location) return;
  const lat=Number(state.location.lat), lon=Number(state.location.lon);
  // Google Flood Hub public map supports location deep-links; the page resolves the nearest covered gauge.
  const url=`https://sites.research.google/floods/l/${lat}/${lon}/7`;
  els.floodLink.href=url;
  if(els.safetyFloodLink) els.safetyFloodLink.href=url;
  if(els.floodStatusTitle) els.floodStatusTitle.textContent=L("wx_google_flood_hub");
  if(els.floodStatusText) els.floodStatusText.textContent=state.lang==="my"
    ?`${state.location.name} အတွက် Flood Hub ကို ဖွင့်ပြီး အနီးဆုံး မြစ်ရေတိုင်းတာစခန်းနဲ့ ရေကြီးမှုခန့်မှန်းချက်ကို ကြည့်နိုင်ပါတယ်။`
    :`Open Flood Hub for ${state.location.name} to view the nearest river gauge and flood forecast.`;
}

let floodPending=null,floodCache=null;
export async function loadFloodStatus(seq=state.loadSeq,signal,{force=false,cachedOnly=false}={}){
  const loc=state.location;if(!loc)return;const key=placeKey(loc);
  if(floodPending?.key===key)return floodPending.promise;
  let j=floodCache?.key===key?floodCache.data:null;
  if(cachedOnly){if(j)await drawFloodStatus(seq,signal,j);return;}
  const b=document.getElementById("floodRefresh");if(b){b.disabled=true;b.setAttribute("aria-busy","true");}
  const promise=(async()=>{
    try{
      if(force||!j||Date.now()-floodCache.time>120000){j=await apiJSON("/api/flood",{lat:loc.lat,lon:loc.lon},{timeout:8000,signal});if(seq!==state.loadSeq||signal?.aborted)return;floodCache={key,data:j,time:Date.now()};}
      await drawFloodStatus(seq,signal,j);
    }catch{if(seq===state.loadSeq&&!signal?.aborted)await drawFloodStatus(seq,signal,null);}
    finally{if(floodPending?.promise===promise)floodPending=null;if(seq===state.loadSeq&&b){b.disabled=false;b.removeAttribute("aria-busy");}}
  })();floodPending={key,promise};return promise;
}
async function drawFloodStatus(seq=state.loadSeq,signal,j){
  if(!state.location || !document.getElementById("floodStatus")) return;
  const my=state.lang==="my";
  const setFlood=(title,text)=>{
    if(state.loadSeq!==seq) return;
    els.floodStatusTitle.textContent=title; els.floodStatusText.textContent=text;
    if(els.safetyFloodTitle) els.safetyFloodTitle.textContent=title;
    if(els.safetyFloodText) els.safetyFloodText.textContent=text;
    const urgent=/warning|flood|heavy|cyclone|tsunami|HIGH|EXTREME/i.test(`${title} ${text}`);
    safetyBadge(els.safetyFloodBadge, urgent?(L("wx_watch")):(L("wx_normal")), urgent?"watch":"good");
  };
  setFlood(L("common_checking"),"—");
  // Google Flood Hub (optional API key) and DMH are separate: one failing must not hide the other.
  if(state.loadSeq!==seq||signal?.aborted)return;
  if(j&&j.status==="available"&&(j.gauges||[]).length){
    const g=j.gauges[0], sev=g.severity||"UNKNOWN", trend=g.forecast_trend||"NO_CHANGE";
    setFlood(`Google Flood Hub · ${sev}`,my?`အနီးဆုံး မြစ်ရေတိုင်းတာစခန်း ${g.distance_km} ကီလိုမီတာ · ${trend} · ${g.quality_verified?"အတည်ပြုပြီးသား စခန်း":"အချက်အလက် ယုံကြည်စိတ်ချရမှု နည်းနိုင်ပါတယ်"}`:`Nearest gauge ${g.distance_km} km · ${trend} · ${g.quality_verified?"Quality verified":"Lower confidence"}`);
    return;
  }
  try{ await (state.officialPromise||Promise.resolve()); }catch{}
  if(state.loadSeq!==seq) return;
  const off=state.official;
  const flood=(mergedOfficial()).filter(a=>/flood|heavy_rain|cyclone|tsunami/i.test(a.type||""));
  if(flood.length){
    const a=flood[0], title=(a.title&&(a.title[state.lang]||a.title.en||a.title.my))||"DMH flood/rain warning";
    setFlood(L("wx_dmh_official_warning"),`${title} · ${(a.regions||[]).join(", ")}`);
    return;
  }
  if(off&&off.ok){
    const stale=off.status&&(off.status.stale||off.status.importer_enabled===false);
    setFlood(stale?(L("wx_dmh_data_not_refreshed_recently")):(L("wx_no_active_flood_heavy_rain")),
      stale?(L("wx_don_t_treat_none_check")):
      (L("wx_also_check_river_levels_google")));
    return;
  }
  setFlood(L("wx_flood_data_temporarily_unavailable"),L("wx_open_flood_hub_map_directly"));
}
