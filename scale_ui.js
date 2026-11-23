// Level scales ("how high is high?") for each reading: bands, tones and the scale pop-up.
import { esc, state } from "./core.js";
import { L, SCALES } from "./i18n.js";
import { windName } from "./nature.js";
import { mountScaleView } from "./views.js";
let draw=null;

// Wind direction as a name ("အနောက်တောင်လေ"), not degrees. In the rainy season south-west wind is the monsoon.
export function dir(deg,month=null){ return windName(deg,state.lang,month); }

export function levelOf(key,v){
  const sc=SCALES[key]; if(!sc||v==null||v===""||!Number.isFinite(Number(v))) return null;
  const n=Number(v); let idx=sc.steps.findIndex(x=>x.max === null || n < x.max); if(idx<0) idx=sc.steps.length-1;
  return {scale:sc,idx,step:sc.steps[idx]};
}

export function setMetricLevel(key,valueEl,v){
  state.levelValues[key]=v;
  const card=valueEl?.closest(".metric"); if(!card) return;
  let box=card.querySelector(".lvl"); const lv=levelOf(key,v), my=state.lang==="my";
  if(!lv){ card.removeAttribute("data-tone"); box?.remove(); return; }
  if(!box){ box=document.createElement("div"); box.className="lvl"; (card.querySelector(":scope > div")||card).appendChild(box); }
  const st=lv.step; card.dataset.tone=st.tone;
  box.innerHTML=`<span class="lvl-pill t${st.tone}">${esc(my?st.my:st.en)}</span><span class="lvl-tip">${esc(my?st.tipMy:st.tipEn)}</span><button type="button" class="lvl-more" data-scale="${key}" aria-label="ⓘ ${L("wx_scale")} – ${L("wx_show_full_scale")}">ⓘ ${L("wx_scale")}</button>`;
}

export function showScale(key,toggle=true){
  const panel=document.getElementById("scalePanel"), sc=SCALES[key]; if(!panel||!sc) return;
  if(toggle&&!panel.hidden&&panel.dataset.key===key){ panel.hidden=true; return; }
  const my=state.lang==="my", cur=levelOf(key,state.levelValues[key]);
  draw=draw||mountScaleView(); draw({sc,my,cur,L});
  panel.dataset.key=key; panel.hidden=false;
  if(toggle) panel.scrollIntoView({behavior:"smooth",block:"nearest"});
}

export function refreshScale(){ const p=document.getElementById("scalePanel"); if(p&&!p.hidden&&p.dataset.key) showScale(p.dataset.key,false); }
