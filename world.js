import { fetchJSON } from "./interaction.js";
import { L, t } from "./i18n.js";
import { fmtWhen } from "./core.js";
/* World tab: natural hazards anywhere on Earth (USGS M5+, GDACS red/orange, NASA EONET) from /api/world-hazards.
   Automatic international products, never presented as official warnings. Plain DOM, textContent only. */
(function(){
  "use strict";
  const my=()=>(window.__mwLang?window.__mwLang():"my")==="my";
  const ICON={earthquake:"🌐",cyclone:"🌀",storm:"⛈️",flood:"🌊",volcano:"🌋",drought:"🏜️",wildfire:"🔥",landslide:"⛰️",heat:"🥵",snow:"❄️"};
  let DATA=null,STATE="idle",FILTER="all",LOC=null,ctl=null;
  const mk=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e;};
  const km=(a,b,c,d)=>{const r=Math.PI/180,p=(c-a)*r,l=(d-b)*r,x=Math.sin(p/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(l/2)**2;return 12742*Math.asin(Math.sqrt(x));};
  const ago=fmtWhen;
  const label=(map,k)=>{const v=(map||{})[k]||[k,k];return my()?v[0]:v[1];};
  function render(){
    const el=document.getElementById("worldCard"); if(!el) return;
    el.replaceChildren();
    el.append(mk("h3","",L("world_title")),mk("p","muted",L("world_note")));
    if(STATE==="loading"||STATE==="idle"){el.append(mk("p","muted",L("world_loading")));return;}
    if(STATE==="error"){
      el.append(mk("p","muted",L("world_error")));
      const b=mk("button","ghost-btn",L("world_retry"));b.type="button";b.dataset.world="retry";el.append(b);return;
    }
    const all=(DATA&&DATA.alerts)||[];
    if(DATA&&DATA.stale) el.append(mk("p","muted",L("world_stale")));
    const kinds=[...new Set(all.map(a=>a.kind))];
    if(kinds.length>1){
      const bar=mk("div","world-chips");
      [["all",L("world_all")],...kinds.map(k=>[k,(ICON[k]||"")+" "+label(t(my()?"my":"en","feed_kind"),k)])].forEach(([k,txt])=>{
        const b=mk("button","chip"+(FILTER===k?" active":""),txt);b.type="button";b.dataset.worldFilter=k;b.setAttribute("aria-pressed",String(FILTER===k));bar.append(b);
      });
      el.append(bar);
    }
    const list=all.filter(a=>FILTER==="all"||a.kind===FILTER);
    if(!list.length){el.append(mk("p","muted",L("world_none")));return;}
    const KIND=t(my()?"my":"en","feed_kind"),LEVEL=t(my()?"my":"en","feed_level");
    list.forEach(a=>{
      const row=mk("div","fa-row world-row fa-"+(a.level||"info"));
      row.append(mk("span","fa-tag",label(LEVEL,a.level||"info")));
      row.append(mk("strong","",(ICON[a.kind]||"")+" "+label(KIND,a.kind)+(a.kind==="earthquake"&&a.magnitude?` M${a.magnitude}`:"")+" · "+String(a.title||"").replace(/^M\s?[\d.]+\s*[-–]\s*/,"")));
      const bits=[a.country,ago(a.time),a.source].filter(Boolean);
      if(LOC&&typeof LOC.lat==="number") bits.push(L("world_km",{n:Math.round(km(LOC.lat,LOC.lon,a.lat,a.lon)).toLocaleString("en-US")}));
      row.append(mk("span","muted",bits.join(" · ")));
      if(a.url&&/^https:\/\//.test(a.url)){const l=mk("a","quiet-btn-link",L("world_open")+" ↗");l.href=a.url;l.target="_blank";l.rel="noopener noreferrer";row.append(l);}
      el.append(row);
    });
    if(DATA&&DATA.fetched_at) el.append(mk("p","tiny muted",L("feeds_checked")+": "+fmtWhen(DATA.fetched_at)));
  }
  function load(force){
    if(STATE==="loading"&&ctl) return;
    if(!force&&STATE==="ok") {render();return;}
    ctl?.abort();const c=new AbortController();ctl=c;STATE="loading";render();
    fetchJSON("/api/world-hazards",{signal:c.signal}).then(j=>{if(c.signal.aborted)return;DATA=j;STATE="ok";render();})
      .catch(()=>{if(c.signal.aborted)return;STATE="error";render();}).finally(()=>{if(ctl===c)ctl=null;});
  }
  window.loadWorld=force=>load(!!force||STATE==="error");
  document.addEventListener("click",e=>{
    const f=e.target.closest&&e.target.closest("[data-world-filter]"); if(f){FILTER=f.dataset.worldFilter;render();return;}
    if(e.target.closest&&e.target.closest("[data-world=retry]")) load(true);
  });
  window.addEventListener("mw-place",e=>{LOC=e.detail;if(STATE==="ok")render();});
  window.addEventListener("mw-lang",()=>{if(STATE!=="idle")render();});
  render();
})();
