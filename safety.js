// Official-alert helpers shared by the safety summary, flood status and hospital cards.
import { state } from "./core.js";

export function safetyBadge(el, text, tone="neutral"){
  if(!el) return;
  el.textContent=text||"—";
  el.className=`safety-badge ${tone}`;
}

// Official DMH warnings come from /api/dmh/alerts, which does not depend on the forecast providers: a forecast outage
// must never hide an active warning. Warnings that the risk engine also returns are merged in (same id = one card).
export function mergedOfficial(){
  const seen=new Set(), out=[];
  for(const a of [...(state.official?.alerts||[]),...(state.riskOfficial||[])]){
    if(a.active===false||(a.valid_to&&Date.parse(a.valid_to)<Date.now()))continue;
    const id=a.id||a.alert_id||JSON.stringify([a.type,a.valid_from]);
    if(seen.has(id)) continue; seen.add(id); out.push(a);
  }
  return out;
}
