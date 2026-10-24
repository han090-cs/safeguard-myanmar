import { fetchJSON, preserveView } from "./interaction.js";
import { L } from "./i18n.js";
import { mountHistoryView } from "./views.js";
/* Climate history cards (Today tab + Farming tab): /api/history, modelled 1985-present data for the nearest state/region.
   Every chart has labelled axes/values and a one-line plain-language caption. Informational only, never an official warning. */
(function(){
  "use strict";
  const isMy=()=>(window.__mwLang?window.__mwLang():"my")==="my";
  let LOC=null, DATA=null, FAIL=false, ENSO=null, refocus=false;
  let REGION="";
  // Drawn by React (frontend/src/history_view.jsx -> views.js); this file keeps the data, the events and the language hook.
  let VIEW=null;
  const render=()=>{
    if(!document.getElementById("historyBody")&&!document.getElementById("agriHistory")) return;
    VIEW=VIEW||mountHistoryView();
    preserveView(()=>{VIEW.draw({LOC,DATA,FAIL,ENSO,REGION,my:isMy(),L,month:new Date().getMonth()});});
    if(refocus&&DATA){refocus=false; document.getElementById("histRegion")?.focus({preventScroll:true});}
  };
  let controller=null;
  function load(){
    if(!LOC||controller)return; const loc=LOC;const ctl=new AbortController();controller=ctl;
    fetchJSON(`/api/history?lat=${encodeURIComponent(loc.lat)}&lon=${encodeURIComponent(loc.lon)}${REGION?"&region="+encodeURIComponent(REGION):""}`,{signal:ctl.signal})
      .then(j=>{if(LOC!==loc||ctl.signal.aborted) return; DATA=j; FAIL=false; render();}).catch(()=>{if(LOC!==loc||ctl.signal.aborted) return; FAIL=true; render();}).finally(()=>{if(controller===ctl)controller=null;});
    if(ENSO===null) fetchJSON("/api/enso").then(j=>{ENSO=j||false;render();}).catch(()=>{ENSO=false;});
  }
  window.loadHistory=function(loc){ if(!loc||!isFinite(loc.lat)||!isFinite(loc.lon)) return; if(LOC&&LOC.lat===loc.lat&&LOC.lon===loc.lon&&DATA) return; LOC=loc; DATA=null; FAIL=false; load(); };
  document.addEventListener("change",e=>{
    if(e.target.id!=="histRegion") return;
    REGION=e.target.value; controller?.abort(); controller=null; FAIL=false; refocus=true; load(); // old charts stay visible until the new region arrives
  });
  document.addEventListener("click",e=>{if(e.target.closest?.("[data-history-retry]")){FAIL=false;load();}});
  window.addEventListener("mw-place",e=>{controller?.abort();controller=null;LOC=e.detail;REGION="";DATA=null;FAIL=false;render();});
  window.addEventListener("mw-cancel",()=>{controller?.abort();controller=null;});
  window.addEventListener("mw-lang",render);
})();
