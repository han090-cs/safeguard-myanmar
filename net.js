// Network layer: timeouts and retry for the backend API, offline-friendly weather cache, slow-connection detection.
import { els, state } from "./core.js";
import { L } from "./i18n.js";
import { abortableDelay } from "./interaction.js";

const weatherCachePrefix = "weather-wx-v1:";

const WEATHER_CACHE_MS = 10 * 60 * 1000; // 10 min: cuts repeat API/network calls

let slowHintTimer=null;

const EMPTY_SLOTS=["todayBrief"];
function markBusy(v){
  // skeleton shimmer for still-empty cards while loading (CSS); a plain "no data yet" line if they stay empty afterwards
  document.body.classList.toggle("is-loading",!!v);
  els.dashboard?.setAttribute("aria-busy",v?"true":"false");
  if(!v) for(const id of EMPTY_SLOTS){const el=document.getElementById(id); if(el) el.dataset.empty=L("ux_no_data");}
}
export function loading(v,message){
  markBusy(v);
  els.loading.hidden=!v;
  clearTimeout(slowHintTimer);
  if(v){
    slowHintTimer=setTimeout(()=>{
      const t=els.loading&&els.loading.querySelector("[data-i18n=loading]");
      if(t&&!els.loading.hidden) t.textContent=L("wx_slow_connection_please_wait_saved");
    },8000);
  }
  if(v && els.loading) {
    const t=els.loading.querySelector("[data-i18n=loading]");
    if(t) t.textContent = message || L("loading_weather");
  }
}

// Set window.MW_API_BASE (in weather.html, before this script loads) to a deployed
// backend URL (e.g. "https://myanmar-weather-api.onrender.com") so the app works
// from any device without a local server. Leave "" to use the same-origin backend.
export const MW_API_BASE = (window.MW_API_BASE || "").replace(/\/$/, "");

// Every request has a deadline and can be cancelled, so a slow or dead upstream can never keep the page "searching".
async function apiJSONOnce(path, params={}, opts={}){
  const {signal}=opts; const timeout=Math.min(opts.remaining || 30000, Math.round((opts.timeout||10000)*(opts.exactTimeout?1:netFactor())));
  const url=new URL(path, MW_API_BASE||location.href);
  Object.entries(params).forEach(([k,v])=>{ if(v!==undefined&&v!==null&&v!=="") url.searchParams.set(k,v); });
  if(signal&&signal.aborted) throw new DOMException("Aborted","AbortError");
  const ctl=new AbortController(); let timedOut=false;
  const onAbort=()=>ctl.abort();
  if(signal) signal.addEventListener("abort",onAbort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;ctl.abort();},timeout);
  try{
    const r=await fetch(url,{signal:ctl.signal,headers:{Accept:"application/json"}});
    if(!r.ok){let detail=`${r.status} ${r.statusText}`;try{const x=await r.json();if(x.detail)detail=x.detail;}catch{}const err=Error(detail); err.status=r.status; throw err;}
    return await r.json();
  }catch(e){
    if(e&&e.name==="AbortError"&&timedOut){const te=Error(L("wx_timed_out"));te.transient=true;throw te;}
    throw e;
  }finally{
    clearTimeout(timer);
    if(signal) signal.removeEventListener("abort",onAbort);
  }
}

/* Poor-connection helpers: timeouts stretch with the connection quality, and one automatic retry covers short drops. */
function netFactor(){
  const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  if(isSlowNet()) return 2.5;
  if(c&&(c.effectiveType==="3g"||(c.rtt&&c.rtt>=400))) return 1.6;
  return 1;
}

export async function apiJSON(path, params={}, opts={}){
  try{ return await apiJSONOnce(path,params,opts); }
  catch(e){
    // retry only transient failures (timeout / dropped connection), never a user cancel or an HTTP error answer
    const transient=!isAbort(e)&&(e&&(e.transient||e instanceof TypeError));
    if(opts.retry===false||!transient) throw e;
    state.slowSeen=true; state.slowUntil=Date.now()+60000;
    await abortableDelay(700,opts.signal);
    return apiJSONOnce(path,params,opts);
  }
}

export const isAbort=e=>e&&e.name==="AbortError";

function weatherCacheKey(lat,lon){ return weatherCachePrefix+Number(lat).toFixed(3)+":"+Number(lon).toFixed(3); }

export function readWeatherCache(lat,lon){
  try{
    const cached=JSON.parse(localStorage.getItem(weatherCacheKey(lat,lon))||"null");
    if(cached && Date.now()-cached.saved<WEATHER_CACHE_MS) return weatherFreshness(cached.data);
  }catch{}
  return null;
}

export function weatherFreshness(data){
  const d=JSON.parse(JSON.stringify(data));
  const fetched=Number(d.meta?.fetched_at)*1000;
  d.meta={...d.meta,stale:!!d.meta?.stale || !Number.isFinite(fetched) || Date.now()-fetched>30*60000};
  return d;
}
function writeWeatherCache(lat,lon,data){
  const fetched=Number(data.meta?.fetched_at)*1000;
  // Cache access time is never a substitute for the original source time.
  const saved=data.meta?.stale ? (Number.isFinite(fetched)?fetched:0) : Date.now();
  try{ localStorage.setItem(weatherCacheKey(lat,lon), JSON.stringify({saved, data})); }catch{}
}

export function isSlowNet(){
  const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  let lite=false; try{lite=localStorage.getItem("mw_lite")==="1";}catch{}
  return !!(lite||(state.slowSeen && Date.now() < (state.slowUntil||0))||(c&&(c.saveData||/(^|-)2g$/.test(c.effectiveType||"")||(c.downlink&&c.downlink<0.7)||(c.rtt&&c.rtt>=900))));
}
window.isSlowNet=isSlowNet; // feeds.js defers its extra requests on slow or data-saver connections

export function readWeatherCacheAny(lat,lon){
  try{const c=JSON.parse(localStorage.getItem(weatherCacheKey(lat,lon))||"null"); if(c&&c.data&&Date.now()-c.saved<24*3600*1000) return c;}catch{}
  return null;
}

export async function getWeather(lat,lon,signal){
  const cached=readWeatherCache(lat,lon); if(cached)return cached;
  // Weather data is intentionally backend-controlled (provider fallback, cache/stale handling, rate limits live there).
  // Poor-network policy: two attempts with long timeouts, then fall back to the last saved copy (up to 24 h) marked stale.
  const tries=[isSlowNet()?20000:12000, 25000];
  let lastErr; const deadline=Date.now()+45000;
  for(let n=0;n<tries.length;n++){
    try{
      const data=await apiJSON("/api/weather",{lat,lon},{timeout:Math.min(tries[n],Math.max(1,deadline-Date.now())),exactTimeout:true,signal,retry:false});
      const checked=weatherFreshness(data); writeWeatherCache(lat,lon,checked); state.slowSeen=false; return checked;
    }catch(e){
      if(isAbort(e)) throw e;
      lastErr=e; state.slowSeen=true; state.slowUntil=Date.now()+60000;
      if(e.status>=400&&e.status<500) break;
      if(n===0) await abortableDelay(800,signal);
    }
  }
  const old=readWeatherCacheAny(lat,lon);
  if(old){const d=JSON.parse(JSON.stringify(old.data)); d.meta=Object.assign({},d.meta,{stale:true,saved_at:old.saved}); return d;}
  throw lastErr;
}
