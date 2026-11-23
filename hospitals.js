// Location-scoped lookup: reuse data, reject late responses, and keep refresh local.
import { els, state } from "./core.js";
import { L } from "./i18n.js";
import { apiJSON, isAbort } from "./net.js";
import { placeKey } from "./interaction.js";
import { safetyBadge } from "./safety.js";
import { mountHospitalsView } from "./lazy_views.js";
let current=null,pending=null,generation=0;
// The list itself is drawn by Preact (frontend/src/hospitals_view.jsx -> views.js); this file keeps the requests and state.
let draw=null;
const show=s=>{draw=draw||mountHospitalsView();draw(s&&{...s,L,my:state.lang==="my"});};
const cache=new Map();
export function cancelHospitals(){generation++;pending?.controller.abort();pending=null;els.hospitalList?.removeAttribute("aria-busy");const b=document.getElementById("hospitalRefresh");if(b){b.disabled=false;b.removeAttribute("aria-busy");}}
export function renderHospitals(){
  if(!current||current.key!==placeKey(state.location))return;
  const j=current.data,rows=j.results||[];
  if(!rows.length){show({kind:"empty"});safetyBadge(els.safetyHospitalBadge,L("wx_none"),"neutral");return;}
  show({kind:"list",rows});
  if(els.hospitalSource)els.hospitalSource.textContent=L("hospital_source",{source:j.source||"—",count:j.total_available??rows.length});
  const first=rows[0];safetyBadge(els.safetyHospitalBadge,`${Number(first.distance_km).toFixed(1)} km`,"good");
  if(els.safetyHospitalTitle)els.safetyHospitalTitle.textContent=first.name||"—";
  if(els.safetyHospitalText)els.safetyHospitalText.textContent=L("hospital_map_count",{count:rows.length});
}
export async function loadNearbyHospitals(loc,{signal,force=false}={}){
  if(!els.hospitalList||!Number.isFinite(loc?.lat)||!Number.isFinite(loc?.lon))return;
  const key=placeKey(loc);
  if(pending?.key===key)return pending.promise;
  const kept=cache.get(key);
  if(!force&&kept&&Date.now()-kept.time<15*60000){current={key,data:kept.data};renderHospitals();return;}
  cancelHospitals();const token=generation,controller=new AbortController(),seq=state.loadSeq;
  const abort=()=>controller.abort();if(signal?.aborted)controller.abort();else signal?.addEventListener("abort",abort,{once:true});
  const b=document.getElementById("hospitalRefresh");if(b){b.disabled=true;b.setAttribute("aria-busy","true");}
  els.hospitalList.setAttribute("aria-busy","true");
  if(!current||current.key!==key)show({kind:"loading"});
  const promise=(async()=>{
    try{
      const data=await apiJSON("/api/hospitals/nearest",{lat:loc.lat,lon:loc.lon,limit:6},{timeout:6000,signal:controller.signal});
      if(token!==generation||seq!==state.loadSeq||key!==placeKey(state.location)||controller.signal.aborted)return;
      cache.set(key,{data,time:Date.now()});current={key,data};renderHospitals();
    }catch(e){if(!isAbort(e)&&token===generation&&key===placeKey(state.location)){if(!current||current.key!==key)show({kind:"failed"});else show({kind:"list",rows:current.data.results||[],note:true});}}
    finally{signal?.removeEventListener("abort",abort);if(token===generation){pending=null;els.hospitalList.removeAttribute("aria-busy");if(b){b.disabled=false;b.removeAttribute("aria-busy");}}}
  })();pending={key,controller,promise};return promise;
}
