import { navigation, updateNavigation, rememberPanelPosition, revealPanel, wireTabs, preserveView, fetchJSON, placeKey } from "./interaction.js";
import { L, t as i18nText } from "./i18n.js";
import { mountAgriView } from "./lazy_views.js";
const tMonth=(lang)=>i18nText(lang,"agri_months");
/* Farming tab: the person picks a FARMING REGION (no town search). Everything shown is data that exists on file:
   - data/agri_research.json (built from the research CSV bundle): regions, crops, soil records, sources. Unknown stays unknown.
   - data/agri.json: the older crop calendar, used only for regions with an explicit calendar_zone link.
   Every statement carries an evidence badge or a verification mark:
   v = checked against a published source, p = partly checked, u = only from the project owner's own document. */
(function(){
  "use strict";
  const MY=tMonth("my");
  let DATA=null, RES=null, LOADING=false, FAILED=false, REGION=navigation.region||null;
  let LOC=null,SCOPE=null,scopeController=null;const scopeCache=new Map();
  const isMy=()=>(window.__mwLang?window.__mwLang():"my")==="my";
  const regionOf=()=>RES&&REGION?RES.regions.find(r=>r.id===REGION)||null:null;
  // The six farming cards are drawn by the Preact view (frontend/src/agri_view.jsx -> agri_view.js); this file keeps data, navigation and tab logic.
  let view=null;
  function render(){preserveView(renderData);syncScope();}
  function renderData(){
    if(!document.getElementById("agriRoot")) return;
    view=view||mountAgriView();
    view({L,my:isMy(),MY,RES,DATA,month:new Date().getMonth()+1},RES&&DATA?regionOf():null,{failed:FAILED,onRetry:()=>{load();render();}});
  }
  function load(){
    if((DATA&&RES)||LOADING) return; LOADING=true; FAILED=false;
    Promise.all([fetchJSON("/api/agri"),fetchJSON("/api/agri/research")])
      .then(([a,b])=>{DATA=a;RES=b;LOADING=false; if(REGION&&!RES.regions.some(r=>r.id===REGION)) REGION=null; render();})
      .catch(()=>{LOADING=false;FAILED=true;render();});
  }
  function syncScope(){
    const rg=regionOf(),zone=SCOPE?.location_zone;
    const match=rg&&LOC&&SCOPE?.key===placeKey(LOC)&&zone&&!zone.mixed&&zone.confidence!=="low"&&(
      (rg.id==="R01"&&zone.zone==="dry")||(rg.id==="R02"&&zone.region==="Ayeyarwady")||
      (rg.id==="R03"&&zone.region==="Tanintharyi")||(rg.id==="R04"&&zone.region==="Shan")||
      (rg.id==="R06"&&zone.region==="Chin"));
    window.MW_FARM_CONTEXT={compatible:!!match,place:LOC,region:rg?.id||null};
    ["agriLocal","diseaseCard","agriWater","agriHistory"].forEach(id=>{const el=document.getElementById(id);if(el)el.hidden=!match;});
    document.querySelectorAll("#agriEnso .enso-place").forEach(e=>e.hidden=!match);
    if(match&&document.body.dataset.mode==="farm")window.loadFarmExtras?.(LOC);
  }
  function loadScope(){
    if(!LOC||document.body.dataset.mode!=="farm")return;
    const loc=LOC,key=placeKey(loc);if(SCOPE?.key===key){syncScope();return;}
    if(scopeCache.has(key)){SCOPE=scopeCache.get(key);syncScope();return;}
    if(scopeController?.key===key)return;scopeController?.abort();
    const ctl=new AbortController();ctl.key=key;scopeController=ctl;
    fetchJSON(`/api/agri?lat=${encodeURIComponent(loc.lat)}&lon=${encodeURIComponent(loc.lon)}`,{signal:ctl.signal})
      .then(data=>{if(ctl.signal.aborted||placeKey(LOC)!==key)return;SCOPE={key,location_zone:data.location_zone};scopeCache.set(key,SCOPE);syncScope();})
      .catch(()=>{if(!ctl.signal.aborted)SCOPE=null;})
      .finally(()=>{if(scopeController===ctl)scopeController=null;});
  }
  function setRegion(id,{record=true,reveal=true}={}){
    if(reveal)rememberPanelPosition();
    REGION=id||null;try{localStorage.setItem("mw_region",REGION||"");}catch{}
    if(record)updateNavigation({region:REGION||""});render();loadScope();
    if(reveal)revealPanel(`farm:${REGION}:${navigation.farmTab}`,document.getElementById("farmHead"),{restore:false});
  }
  window.renderAgri=function(d,loc){
    if(loc&&placeKey(LOC)!==placeKey(loc)){LOC=loc;SCOPE=null;scopeController?.abort();scopeController=null;}
    document.body.dataset.located="1";syncScope();loadScope();
  };
  window.addEventListener("mw-lang",render);
  window.addEventListener("mw-cancel",()=>{scopeController?.abort();scopeController=null;});
  /* ---- mode switch (weather / farming) and farming tab bar ---- */
  const HERO={farm:{my:[L("agri_where"),L("agri_search")],en:[i18nText("en","agri_where"),i18nText("en","agri_search")]}};
  function applyHero(){
    const h1=document.querySelector(".hero-copy h1"), p=document.querySelector(".hero-copy p");
    if(!h1||!p||document.body.dataset.mode!=="farm") return;
    const t=HERO.farm[isMy()?"my":"en"]; h1.textContent=t[0]; p.textContent=t[1];
  }
  function setMode(m,{record=true,reveal=true}={}){
    if(reveal)rememberPanelPosition();
    m=m==="farm"?"farm":"weather";document.body.dataset.mode=m;
    try{localStorage.setItem("mw_mode",m);}catch{}
    if(record)updateNavigation({mode:m});
    document.querySelectorAll(".mode-btn").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.mode===m)));
    if(m==="farm"){applyHero();load();render();loadScope();window.renderGlobalEnso?.();}else if(window.__mwRetext)window.__mwRetext();
    if(reveal){const target=m==="farm"?document.getElementById("farmHead"):(document.querySelector("#dashboard:not([hidden]) .tab-panel:not([hidden])")||document.querySelector(".search-hero"));revealPanel(m==="farm"?`farm:${REGION}:${navigation.farmTab}`:`weather:${navigation.tab}`,target);}
  }
  function setFarmTab(t,{record=true,reveal=true}={}){
    if(reveal)rememberPanelPosition();
    document.querySelectorAll(".farm-panel").forEach(p=>p.hidden=p.dataset.fpanel!==t);
    document.querySelectorAll(".ftab").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.ftab===t)));
    try{localStorage.setItem("mw_ftab",t);}catch{}
    if(record)updateNavigation({farmTab:t});
    if(reveal)revealPanel(`farm:${REGION}:${t}`,document.querySelector(`[data-fpanel="${t}"]`));
  }
  document.addEventListener("click",ev=>{
    const mb=ev.target.closest&&ev.target.closest(".mode-btn"); if(mb){setMode(mb.dataset.mode);return;}
    const ft=ev.target.closest&&ev.target.closest(".ftab"); if(ft){setFarmTab(ft.dataset.ftab);return;}
    const pk=ev.target.closest&&ev.target.closest("[data-act=pick]");
    if(pk){document.body.classList.add("show-hero"); const h=document.querySelector(".search-hero"); if(h) h.scrollIntoView({behavior:"smooth",block:"start"}); const i=document.getElementById("locationInput"); if(i) requestAnimationFrame(()=>{if(document.body.classList.contains("show-hero"))i.focus({preventScroll:true});}); return;}
    const rb=ev.target.closest&&ev.target.closest("[data-region]"); if(rb){setRegion(rb.dataset.region);return;}
  });
  document.addEventListener("change",ev=>{ if(ev.target&&ev.target.id==="agriRegionSel") setRegion(ev.target.value); });
  window.addEventListener("mw-lang",()=>{applyHero();});
  const m0=navigation.mode,t0=navigation.farmTab;
  // tips card: open on wide screens, folded on phones so the first screen stays short
  const tips=()=>{const t=document.getElementById("healthTips"); if(t&&!t.dataset.init){t.dataset.init="1"; if(window.matchMedia("(min-width:900px)").matches) t.open=true;}};
  const boot=()=>{tips();setFarmTab(t0,{record:false,reveal:false});setMode(m0,{record:false,reveal:false});
    const ft=[...document.querySelectorAll(".ftab")];wireTabs(document.getElementById("farmTabbar"),ft,ft.map(b=>document.querySelector(`[data-fpanel="${b.dataset.ftab}"]`)));
    wireTabs(document.querySelector(".mode-switch"),[...document.querySelectorAll(".mode-btn")],[document.getElementById("weatherView"),document.getElementById("farmView")]);};
  window.addEventListener("mw-navigation",e=>{setRegion(e.detail.region,{record:false,reveal:false});setFarmTab(e.detail.farmTab,{record:false,reveal:false});setMode(e.detail.mode,{record:false,reveal:e.detail.mode==="farm"});});
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot); else boot();
})();
