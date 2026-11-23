import { fetchJSON } from "./interaction.js";
import { L, t } from "./i18n.js";
import { fmtWhen } from "./core.js";
import { mountFeedsView } from "./lazy_views.js";
/* International hazard feeds for the selected place (USGS quakes, GDACS cyclone/flood/quake, GloFAS river trend).
   Server: /api/hazard-feed. These are automatic international products, never presented as official DMH warnings. */
(function(){
  "use strict";
  const my=()=>(window.__mwLang?window.__mwLang():"my")==="my";
  let feedController=null,extraController=null,extraKey="";
  let LOC=null, DATA=null, STATE="idle"; // idle | loading | ok | error | deferred
  const KIND=t("my","feed_kind");
  const LEVEL=t("my","feed_level");
  const ago=fmtWhen;
  // Drawn by Preact (frontend/src/feeds_view.jsx -> views.js); this file keeps the data, the requests and the events.
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
  // DMH "Low Pressure Area" news: shown as a watch note, never as a warning. Plain DOM + textContent only.
  let WATCH=[];
  // An item leaves the card by itself when it is too old, even if the page stays open (server: 36 h for the DMH Top
  // Announcement, 3 days for other DMH news).
  const watchLive=w=>{const t=Date.parse(w.issued);return !t||Date.now()-t<=(w.kind==="announcement"?36:72)*3600000;};
  const watchWhen=w=>{const t=Date.parse(w.issued);return t?new Date(t).toLocaleString(my()?"my-MM":"en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})+" · ":"";};
  function renderWatch(){
    const el=document.getElementById("watchCard"); if(!el) return;
    el.replaceChildren();
    const live=WATCH.filter(watchLive);
    if(!live.length){el.hidden=true;return;}
    el.hidden=false;
    const h=document.createElement("h3"); h.textContent="👀 "+L("watch_title");
    const p=document.createElement("p"); p.className="muted"; p.textContent=L("watch_note");
    el.append(h,p);
    live.forEach(w=>{
      const a=document.createElement("a"); a.className="quiet-btn-link"; a.target="_blank"; a.rel="noopener noreferrer";
      a.href=my()?w.url_my:w.url_en; a.textContent=watchWhen(w)+(my()?w.title:w.title_en)+" ↗"; a.title=L("watch_open");
      el.append(a);
    });
  }
  function loadWatch(){
    fetchJSON("/api/v1/official-alerts").then(r=>{WATCH=(r&&r.source_status&&r.source_status.watch)||[];renderWatch();}).catch(()=>{});
  }
  loadWatch(); setInterval(loadWatch,15*60*1000);
  // Warnings card: DMH official alerts for the place + alerts computed from the forecast (rain, gusts, waves). Plain DOM, textContent only.
  let FA=null, faCtl=null;
  const mk=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e;};
  function renderFA(){
    const el=document.getElementById("faCard"); if(!el) return;
    el.replaceChildren();
    const off=(FA&&FA.official)||[], fc=(FA&&FA.forecast)||[];
    if(!off.length&&!fc.length){el.hidden=true;return;}
    el.hidden=false;
    el.append(mk("h3","","⚠️ "+L("fa_title")),mk("p","muted",L("fa_note")));
    const lg=my()?"my":"en";
    off.forEach(a=>{
      const row=mk("div","fa-row fa-official");
      row.append(mk("span","fa-tag",L("fa_official")));
      const link=mk("a","quiet-btn-link",((a.title&&(a.title[lg]||a.title.en))||a.type||"DMH")+" ↗");
      link.href=(a.links&&(a.links[lg]||a.links.en))||a.url||"#";link.target="_blank";link.rel="noopener noreferrer";
      row.append(link);el.append(row);
    });
    fc.forEach(a=>{
      const row=mk("div","fa-row fa-"+a.level);
      row.append(mk("span","fa-tag",L("fa_"+a.level)));
      row.append(mk("strong","",a.title[lg]||a.title.en));
      row.append(mk("span","muted",`${a.detail[lg]||a.detail.en}: ${a.value} ${a.unit} · ${a.date}`));
      row.append(mk("em","muted fa-src",L("fa_forecast")));
      el.append(row);
    });
  }
  function loadFA(loc){
    faCtl?.abort(); FA=null; renderFA();
    if(!loc||typeof loc.lat!=="number") return;
    const ctl=new AbortController(); faCtl=ctl;
    fetchJSON(`/api/forecast-alerts?lat=${encodeURIComponent(loc.lat)}&lon=${encodeURIComponent(loc.lon)}`,{signal:ctl.signal})
      .then(j=>{if(ctl.signal.aborted||loc!==LOC)return;FA=j;renderFA();}).catch(()=>{});
  }
  window.addEventListener("mw-place",e=>loadFA(e.detail));
  setInterval(()=>{if(LOC)loadFA(LOC);},30*60*1000);
  window.addEventListener("mw-lang",()=>{render();renderWatch();renderFA();});
})();
