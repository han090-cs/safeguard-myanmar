import { fetchJSON } from "./interaction.js";
import { L, t } from "./i18n.js";
import { mountFeedsView } from "./views.js";
/* International hazard feeds for the selected place (USGS quakes, GDACS cyclone/flood/quake, GloFAS river trend).
   Server: /api/hazard-feed. These are automatic international products, never presented as official DMH warnings. */
(function(){
  "use strict";
  const my=()=>(window.__mwLang?window.__mwLang():"my")==="my";
  let feedController=null,extraController=null,extraKey="";
  let LOC=null, DATA=null, STATE="idle"; // idle | loading | ok | error | deferred
  const KIND=t("my","feed_kind");
  const LEVEL=t("my","feed_level");
  function ago(iso){
    const t=Date.parse(iso&&!/[zZ]|[+-]\d\d:?\d\d$/.test(iso)?iso+"Z":iso); if(!isFinite(t)) return "";
    const m=Math.max(0,Math.round((Date.now()-t)/60000));
    if(m<60) return L("feed_minutes", {n:m});
    const h=Math.round(m/60); if(h<48) return L("feed_hours", {n:h});
    const d=Math.round(h/24); return L("feed_days", {n:d});
  }
  // Drawn by React (frontend/src/feeds_view.jsx -> views.js); this file keeps the data, the requests and the events.
  let VIEW=null;
  const view=()=>VIEW||(VIEW=mountFeedsView());
  const snap=()=>({L,my:my(),STATE,DATA,EX,KIND,LEVEL,ago});
  let EX=null;
  function renderFeed(){ if(document.getElementById("feedCard")||document.getElementById("riverCard")) view().draw(snap()); }
  function renderRiver(){ /* drawn together with the feed card */ }
  function renderExtras(){ if(document.getElementById("seaCard")||document.getElementById("agriWater")) view().drawExtras(snap()); }
  const slowNet=()=>typeof window.isSlowNet==="function"&&window.isSlowNet();
  function loadExtras(loc,force=false){
    if(!loc||typeof loc.lat!=="number"||(slowNet()&&!force))return;
    const key=`${loc.lat},${loc.lon}`;if(extraKey===key&&(EX||extraController))return;
    extraController?.abort();const ctl=new AbortController();extraController=ctl;extraKey=key;
    const mine=loc;EX=null;renderExtras();
    fetchJSON(`/api/local-extras?lat=${encodeURIComponent(loc.lat)}&lon=${encodeURIComponent(loc.lon)}`,{signal:ctl.signal})
      .then(j=>{if(ctl.signal.aborted||mine!==LOC||!j)return;EX=j;renderExtras();})
      .catch(()=>{}).finally(()=>{if(extraController===ctl)extraController=null;});
  }
  function render(){renderFeed(); renderRiver(); renderExtras();}
  function load(force){
    if(!LOC||typeof LOC.lat!=="number") return;
    if(!force&&slowNet()){STATE="deferred"; render(); return;}
    if(STATE==="loading"&&feedController)return;
    feedController?.abort();const ctl=new AbortController();feedController=ctl;
    STATE="loading"; render();
    const mine=LOC;
    fetchJSON("/api/hazard-feed?lat="+encodeURIComponent(LOC.lat)+"&lon="+encodeURIComponent(LOC.lon),{signal:ctl.signal})
      .then(j=>{ if(mine!==LOC||ctl.signal.aborted) return; DATA=j; STATE="ok"; render(); })
      .catch(()=>{ if(mine!==LOC||ctl.signal.aborted) return; STATE="error"; render(); });
  }
  window.loadFeed=function(loc,force=false){ if(LOC&&loc&&LOC.lat===loc.lat&&LOC.lon===loc.lon&&STATE==="ok") return; LOC=loc; DATA=null; load(force); loadExtras(loc); };
  document.addEventListener("click",ev=>{ const b=ev.target.closest&&ev.target.closest("[data-feed=load]"); if(b) load(true); });
  window.loadFarmExtras=loc=>{if(!loc)return;if(LOC!==loc){LOC=loc;}loadExtras(loc,true);};
  window.addEventListener("mw-place",e=>{feedController?.abort();extraController?.abort();feedController=null;extraController=null;LOC=e.detail;DATA=null;EX=null;extraKey="";STATE="idle";render();});
  window.addEventListener("mw-cancel",()=>{feedController?.abort();extraController?.abort();feedController=null;extraController=null;if(STATE==="loading")STATE="deferred";render();});
  window.addEventListener("mw-lang",render);
})();
