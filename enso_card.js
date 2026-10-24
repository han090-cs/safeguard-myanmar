// El Niño card (Weather mode and Farming tab), rendered from /api/enso.
import { state } from "./core.js";
import { L } from "./i18n.js";
import { fetchJSON } from "./interaction.js";
import { mountEnsoView } from "./views.js";
let draw=null;

export function renderEnso(loc,place,sum,n){
  const targets=["agriEnso","wxEnso"].map(id=>document.getElementById(id)).filter(Boolean); if(!targets.length) return;
  const e=state.enso;
  if(e===undefined){
    state.enso=null;
    fetchJSON("/api/enso").then(j=>{state.enso=j||false; renderEnso(state.location||loc,state.location?.name_en||state.location?.name||place,sum,n);}).catch(()=>{state.enso=false;});
  }
  draw=draw||mountEnsoView();
  if(!e){["agriEnso","wxEnso"].forEach(id=>draw(id,null));return;}
  const wsUrl=/^https:\/\//.test(e.warning_system_url||"")?e.warning_system_url:"";
  // same card, with the Warning System link under it, in the Weather mode (Today tab) and the Farming tab
  const base={e,L,place,ws:wsUrl,compatible:!!window.MW_FARM_CONTEXT?.compatible};
  if(document.getElementById("agriEnso")) draw("agriEnso",{...base,farm:true});
  if(document.getElementById("wxEnso")) draw("wxEnso",base);
}

window.renderGlobalEnso=()=>renderEnso(state.location,state.location?.name_en||state.location?.name||"",0,0);
