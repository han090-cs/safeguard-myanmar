// Shared interaction behavior. No visual design or provider rules live here.
export const placeKey = loc => loc ? `${Number(loc.lat).toFixed(4)},${Number(loc.lon).toFixed(4)}` : "";
export const readLocal = (key, fallback = null) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
export const writeLocal = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const namedPlace = loc => loc && !String(loc.id).startsWith("geo:") && Number.isFinite(loc.lat) && Number.isFinite(loc.lon) ? {...loc} : null;
const weatherTabs = ["today", "forecast", "flood", "hospitals", "hazards", "compare", "world", "lab"];
const farmTabs = ["now", "crops", "season", "soil"];
const legacy = key => { try { return localStorage.getItem(key); } catch { return null; } };
const saved = readLocal("mw_navigation_v1", {});
export const navigation = {
  mode: saved.mode || legacy("mw_mode") || "weather",
  tab: saved.tab || "today", farmTab: saved.farmTab || legacy("mw_ftab") || "now",
  region: saved.region ?? legacy("mw_region") ?? "", place: namedPlace(saved.place), query: saved.query || ""
};
function fromHash(fallback) {
  if (!location.hash.startsWith("#mode=")) return {...fallback};
  const p = new URLSearchParams(location.hash.slice(1));
  const id = p.get("place");
  // The place the address bar names is looked up locally first (saved copy, history entry, recent searches), so a refresh never depends on the search service answering the same way twice.
  const known = id ? [fallback.place, history.state?.mw?.place, ...readLocal("weather-recent-v3", [])].map(namedPlace).find(x => x && String(x.id) === id) : null;
  return {mode:p.get("mode"), tab:p.get("tab"), farmTab:p.get("farm"), region:p.get("region") || "",
    place:known || null,
    placeId:id || "", query:p.get("q") || ""};
}
function validate(n) {
  n.mode = n.mode === "farm" ? "farm" : "weather";
  n.tab = weatherTabs.includes(n.tab) ? n.tab : "today";
  n.farmTab = farmTabs.includes(n.farmTab) ? n.farmTab : "now";
  n.region = /^R\d{2}$/.test(n.region || "") ? n.region : "";
  n.place = namedPlace(n.place);
  return n;
}
Object.assign(navigation, validate(fromHash(navigation)));
function hashFor(n) {
  const p = new URLSearchParams({mode:n.mode, tab:n.tab, farm:n.farmTab});
  if (n.region) p.set("region", n.region);
  if (n.place) { p.set("place", String(n.place.id)); p.set("q", n.place.name_en || n.place.name); }
  else if (n.placeId) { p.set("place", n.placeId); if (n.query) p.set("q", n.query); }
  return "#" + p;
}
export function updateNavigation(patch, {replace = false} = {}) {
  Object.assign(navigation, validate({...navigation, ...patch}));
  if (Object.hasOwn(patch, "place")) { navigation.placeId = navigation.place?.id || ""; navigation.query = navigation.place?.name_en || navigation.place?.name || ""; }
  writeLocal("mw_navigation_v1", navigation);
  const hash = hashFor(navigation);
  if (location.hash !== hash) history[replace ? "replaceState" : "pushState"]({mw:{...navigation}}, "", hash);
  else history.replaceState({mw:{...navigation}}, "", hash);
}
export function persistPlace(loc, options) { updateNavigation({place:namedPlace(loc)}, options); }
updateNavigation({}, {replace:true});
window.addEventListener("popstate", event => {
  rememberPanelPosition();
  Object.assign(navigation, validate(event.state?.mw || fromHash({...navigation, place:null, placeId:"", query:""})));
  writeLocal("mw_navigation_v1", navigation);
  window.dispatchEvent(new CustomEvent("mw-navigation", {detail:{...navigation}}));
});

const scrollPositions = new Map();
let activeView = navigation.mode === "farm" ? `farm:${navigation.region || null}:${navigation.farmTab}` : `weather:${navigation.tab}`, navigationTurn = 0;
export function rememberPanelPosition() {
  if (activeView) scrollPositions.set(activeView, window.scrollY);
}
export function revealPanel(key, panel, {focus = false, restore = true} = {}) {
  if (!panel) return;
  activeView = key;
  const turn = ++navigationTurn;
  const behavior = () => matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  const targetFor = () => {
    const headerBottom = document.querySelector(".topbar")?.getBoundingClientRect().bottom || 0;
    const offset = Math.max(20, Math.min(150, headerBottom)) + 12;
    return Math.max(0, restore && scrollPositions.has(key) ? scrollPositions.get(key) : panel.getBoundingClientRect().top + window.scrollY - offset);
  };
  requestAnimationFrame(() => {
    if (turn !== navigationTurn || !panel.isConnected || !panel.getClientRects().length) return;
    window.scrollTo({top:targetFor(), behavior:behavior()});
    if (focus) { const heading = panel.querySelector("h2,h3,h4") || panel; heading.tabIndex = -1; heading.focus({preventScroll:true}); }
    // The page is briefly shorter than the target while the new panel is still loading, so the browser clamps the scroll.
    // Re-aim whenever the page grows during the next ~2 s, unless the person has already started scrolling.
    const stop = () => { observer.disconnect(); clearTimeout(timer); ["wheel","touchstart","keydown"].forEach(e => removeEventListener(e, stop)); };
    const observer = new ResizeObserver(() => {
      if (turn !== navigationTurn || !panel.isConnected) return stop();
      if (Math.abs(window.scrollY - targetFor()) > 2) window.scrollTo({top:targetFor(), behavior:"auto"});
    });
    const timer = setTimeout(stop, 2000);
    ["wheel","touchstart","keydown"].forEach(e => addEventListener(e, stop, {passive:true, once:true}));
    observer.observe(document.documentElement);
  });
}

function detailKey(el) {
  if (el.dataset.detailKey)return el.dataset.detailKey;
  if (el.id) return "#" + el.id;
  const parent = el.parentElement?.closest("[id]");
  return parent ? `${parent.id}:${[...parent.querySelectorAll("details")].indexOf(el)}` : null;
}
function focusSelector(el) {
  if (!el || el === document.body) return null;
  if (el.id) return "#" + CSS.escape(el.id);
  for (const name of ["data-prep","data-rl","data-scale","data-tab","data-ftab","data-region"]) {
    if (el.hasAttribute(name)) return `[${name}="${CSS.escape(el.getAttribute(name))}"]`+(el.hasAttribute("data-a")?`[data-a="${CSS.escape(el.getAttribute("data-a"))}"]`:"");
  }
  return null;
}
export function preserveView(fn) {
  const open = new Map([...document.querySelectorAll("details")].map(d=>[detailKey(d),d.open]).filter(([k])=>k));
  const focused = document.activeElement, selector = focusSelector(focused), y = window.scrollY;
  const result = fn();
  document.querySelectorAll("details").forEach(d=>{const k=detailKey(d); if (open.has(k)) d.open=open.get(k);});
  if (selector && !focused.isConnected) document.querySelector(selector)?.focus({preventScroll:true});
  if (Math.abs(window.scrollY-y)>1) window.scrollTo({top:y,behavior:"instant"});
  return result;
}

export function wireTabs(group, buttons, panels) {
  if (!group) return;
  const sync = () => {
    const vertical = group.matches("nav[aria-label='Dashboard sections']") && matchMedia("(min-width:1024px)").matches;
    group.setAttribute("aria-orientation", vertical ? "vertical" : "horizontal");
    buttons.forEach((button,index) => {
      button.id ||= `${group.id || "mw-tabs"}-${index}`;
      const panel = panels[index];
      if (panel) { panel.id ||= `${button.id}-panel`; button.setAttribute("aria-controls",panel.id); panel.setAttribute("role","tabpanel"); panel.setAttribute("aria-labelledby",button.id); }
      button.tabIndex = button.getAttribute("aria-selected") === "true" ? 0 : -1;
    });
  };
  sync();
  new MutationObserver(sync).observe(group,{subtree:true,attributes:true,attributeFilter:["aria-selected"]});
  window.addEventListener("resize",sync);
  group.addEventListener("keydown",event=>{
    const index=buttons.indexOf(event.target); if(index<0)return;
    const vertical=group.getAttribute("aria-orientation")==="vertical";
    let next=index;
    if(event.key===(vertical?"ArrowDown":"ArrowRight")) next=(index+1)%buttons.length;
    else if(event.key===(vertical?"ArrowUp":"ArrowLeft")) next=(index-1+buttons.length)%buttons.length;
    else if(event.key==="Home") next=0;
    else if(event.key==="End") next=buttons.length-1;
    else return;
    event.preventDefault(); buttons.forEach((b,i)=>b.tabIndex=i===next?0:-1); buttons[next].focus();
  });
}

export async function fetchJSON(url, {signal,timeout=12000} = {}) {
  const ctl=new AbortController(); let expired=false;
  const abort=()=>ctl.abort(); if(signal?.aborted)ctl.abort(); else signal?.addEventListener("abort",abort,{once:true});
  const timer=setTimeout(()=>{expired=true;ctl.abort();},timeout);
  try { const r=await fetch(url,{signal:ctl.signal,headers:{Accept:"application/json"}}); if(!r.ok)throw Error(`HTTP ${r.status}`); return await r.json(); }
  catch(e) { if(expired)throw Error("Request timed out"); throw e; }
  finally { clearTimeout(timer); signal?.removeEventListener("abort",abort); }
}
export function abortableDelay(ms,signal) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new DOMException("Aborted","AbortError"));return;}
    const abort=()=>{clearTimeout(timer);reject(new DOMException("Aborted","AbortError"));};
    const timer=setTimeout(()=>{signal?.removeEventListener("abort",abort);resolve();},ms);
    signal?.addEventListener("abort",abort,{once:true});
  });
}
window.MWUX={preserveView,fetchJSON,placeKey};
