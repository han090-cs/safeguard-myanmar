import { L } from "./i18n.js";
import { initSwipeTabs } from "./swipe_tabs.js";
// Small external bootstrap so the dashboard can use a strict CSP without inline script/style exceptions.
window.MW_API_BASE = "";

(() => {
  const updateStatus = (message) => {
    const el = document.getElementById("status");
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
    el.classList.remove("status-action");
    const button=document.createElement("button");button.type="button";button.className="ghost-btn";button.textContent=L("ux_reload");
    button.onclick=()=>location.reload();el.append(" ",button);
  };

  // isSecureContext is true for https, localhost AND 127.0.0.1 (the old hostname check missed 127.0.0.1)
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type !== "MW_APP_UPDATED") return;
      updateStatus(L("app_updated"));
    });
  }


  // "Add to home screen" tip: Chrome/Android gets a real Install button, iPhone Safari gets the two-step hint. Shown once a place is open, never again after Close.
  const tip=document.getElementById("installTip"), keyName="mw-install-tip";
  const store={get(){try{return localStorage.getItem(keyName);}catch{return null;}},set(){try{localStorage.setItem(keyName,"1");}catch{}}};
  let deferred=null;
  const standalone=()=>window.matchMedia?.("(display-mode: standalone)").matches||navigator.standalone===true;
  const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent)&&!/crios|fxios/i.test(navigator.userAgent);
  const paintTip=()=>{
    if(!tip||store.get()||standalone()||!document.body.classList.contains("has-location")||!(deferred||isIOS)){if(tip)tip.hidden=true;return;}
    const btn=document.getElementById("installBtn");
    document.getElementById("installText").textContent=L(deferred?"install_tip":"install_ios");
    btn.hidden=!deferred; btn.textContent=L("install_btn");
    document.getElementById("installClose").textContent=L("install_close");
    tip.hidden=false;
  };
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferred=e;paintTip();});
  window.addEventListener("appinstalled",()=>{store.set();deferred=null;paintTip();});
  window.addEventListener("mw-place",()=>setTimeout(paintTip,1500));
  window.addEventListener("mw-lang",paintTip);
  document.getElementById("installBtn")?.addEventListener("click",async()=>{if(!deferred)return;deferred.prompt();try{await deferred.userChoice;}catch{} deferred=null;store.set();paintTip();});
  document.getElementById("installClose")?.addEventListener("click",()=>{store.set();paintTip();});

  // Phone bottom bar shortcuts: Farming / Weather switch the mode, More opens the Flood, Hospitals and Compare tabs.
  const bar=document.querySelector("nav.tabbar[aria-label='Dashboard sections']"), moreBtn=document.querySelector(".tab-more");
  const setMore=open=>{bar?.classList.toggle("more-open",open);moreBtn?.setAttribute("aria-expanded",String(open));};
  document.addEventListener("click",e=>{
    const go=e.target.closest?.("[data-go]");
    if(go){
      const k=go.dataset.go;
      if(k==="farm")document.getElementById("modeFarm")?.click();
      else if(k==="weather")document.getElementById("modeWeather")?.click();
      else if(k==="more"){setMore(!bar?.classList.contains("more-open"));return;}
    }
    if(bar?.classList.contains("more-open"))setMore(false);
  });
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&bar?.classList.contains("more-open")){setMore(false);moreBtn?.focus();}});

  // Large-text control for older users. The setting is local-only and works offline.
  const FONT_STEPS = [100, 112, 125];
  const fontLabel = document.getElementById("fontReset");
  const applyFont = (value) => {
    const n = FONT_STEPS.includes(Number(value)) ? Number(value) : 100;
    document.documentElement.style.setProperty("--mw-root-font", n + "%");
    document.documentElement.dataset.fontScale = String(n);
    const down=document.getElementById("fontDown"),up=document.getElementById("fontUp");
    if(down)down.disabled=n===FONT_STEPS[0];if(up)up.disabled=n===FONT_STEPS.at(-1);
    if (fontLabel) { fontLabel.textContent = n + "%"; fontLabel.setAttribute("aria-label", L("app_font_label", {n})); }
    try { localStorage.setItem("mw_font_scale", String(n)); } catch {}
  };
  let savedFont = 100;
  try { savedFont = Number(localStorage.getItem("mw_font_scale")) || 100; } catch {}
  applyFont(savedFont);
  window.addEventListener("mw-lang",()=>applyFont(Number(document.documentElement.dataset.fontScale)||100));
  document.getElementById("fontDown")?.addEventListener("click", () => {
    const cur = Number(document.documentElement.dataset.fontScale) || 100;
    applyFont(FONT_STEPS[Math.max(0, FONT_STEPS.indexOf(cur) - 1)]);
  });
  document.getElementById("fontUp")?.addEventListener("click", () => {
    const cur = Number(document.documentElement.dataset.fontScale) || 100;
    applyFont(FONT_STEPS[Math.min(FONT_STEPS.length - 1, FONT_STEPS.indexOf(cur) + 1)]);
  });
  document.getElementById("fontReset")?.addEventListener("click", () => applyFont(100));

  const offlineBanner = document.getElementById("offlineBanner");
  const updateOffline = () => {
    if (!offlineBanner) return;
    const off = !navigator.onLine;
    offlineBanner.hidden = !off;
    document.body.classList.toggle("offline-mode", off);
  };
  window.addEventListener("online", updateOffline);
  window.addEventListener("offline", updateOffline);
  updateOffline();

  window.addEventListener("online", () => document.body.classList.remove("offline-mode"));
  window.addEventListener("offline", () => document.body.classList.add("offline-mode"));

})();

// Dynamic bar widths/heights/colours are set through the CSSOM (allowed by the strict CSP), not inline style attributes.
(() => {
  const MAP = [["w", "width", v => v + "%"], ["h", "height", v => v + "px"], ["op", "opacity", v => v], ["bg", "background", v => v], ["bc", "borderLeftColor", v => v]];
  const apply = (root) => {
    if (!root || root.nodeType !== 1) return;
    const nodes = [root, ...root.querySelectorAll("[data-w],[data-h],[data-op],[data-bg],[data-bc]")];
    for (const el of nodes) {
      if (!el.dataset) continue;
      for (const [k, prop, fmt] of MAP) {
        if (el.dataset[k] !== undefined && el.dataset[k] !== "") el.style[prop] = fmt(el.dataset[k]);
      }
    }
  };
  const start = () => {
    apply(document.body);
    new MutationObserver(list => { for (const m of list) m.addedNodes.forEach(apply); }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();


// Dark mode: follows the phone's own setting until the person taps the moon button; after that their choice is remembered.
(() => {
  const btn = document.getElementById("themeToggle");
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const applyDark = (on, remember) => {
    document.body.classList.toggle("sg-dark", !!on);
    document.documentElement.classList.toggle("sg-dark", !!on);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", on ? "#07170e" : "#0b5328");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", on ? "dark" : "light");
    if (btn) {
      btn.textContent = on ? "☀️" : "🌙";
      btn.setAttribute("aria-pressed", String(!!on));
    }
    if (remember) { try { localStorage.setItem("mw_dark_mode", on ? "1" : "0"); } catch {} }
  };
  let saved = null;
  try { saved = localStorage.getItem("mw_dark_mode"); } catch {}
  const initial = () => saved === "1" || (saved === null && !!mq?.matches);
  if (document.body) applyDark(initial(), false);
  else document.addEventListener("DOMContentLoaded", () => applyDark(initial(), false));
  mq?.addEventListener?.("change", e => { if (saved === null) applyDark(e.matches, false); });
  document.addEventListener("click", (e) => {
    if (e.target.closest?.("#themeToggle")) {
      saved = document.body.classList.contains("sg-dark") ? "0" : "1";
      applyDark(saved === "1", true);
    }
  });
})();

// mobile: ⚙️ settings menu + charts folded by default on narrow screens
(() => {
  const btn = document.getElementById("topMoreBtn"), box = document.getElementById("topMore");
  if (btn && box) btn.addEventListener("click", () => {
    const o = box.classList.toggle("open");
    btn.setAttribute("aria-expanded", String(o));
  });
  try { if (window.matchMedia("(max-width:650px)").matches) document.getElementById("foldCharts")?.removeAttribute("open"); } catch (_) {}
})();

// ===== Thumb-zone layer (phones): place sheet, share, pull-to-refresh, settings in ⚙️, notification prompt =====
(() => {
  const $ = id => document.getElementById(id);
  const mq = window.matchMedia("(max-width:650px)");
  const body = document.body;
  const store = { get(k){ try { return localStorage.getItem(k); } catch { return null; } }, set(k,v){ try { localStorage.setItem(k,v); } catch {} } };

  // 1) language + dark mode live inside the ⚙️ panel on phones (same buttons, so their handlers keep working)
  const topActions = document.querySelector(".top-actions"), topMore = $("topMore"), themeBtn = $("themeToggle"), langBtn = $("languageToggle"), moreBtn = $("topMoreBtn");
  const placeToggles = () => {
    if (!topActions || !topMore || !themeBtn || !langBtn) return;
    if (mq.matches) { topMore.prepend(langBtn); topMore.prepend(themeBtn); }
    else { topActions.insertBefore(langBtn, moreBtn); topActions.insertBefore(themeBtn, langBtn); }
  };
  placeToggles(); mq.addEventListener?.("change", placeToggles);

  // 2) place sheet: the existing search hero, opened from the 📍 pill, closed by ✕ / backdrop / Esc
  const backdrop = $("sheetBackdrop");
  const syncBackdrop = () => { if (backdrop) backdrop.hidden = !(mq.matches && body.classList.contains("show-hero") && body.classList.contains("has-location")); };
  new MutationObserver(syncBackdrop).observe(body, { attributes: true, attributeFilter: ["class"] });
  const closeSheet = () => { body.classList.remove("show-hero"); syncBackdrop(); };
  $("sheetClose")?.addEventListener("click", closeSheet);
  backdrop?.addEventListener("click", closeSheet);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && body.classList.contains("show-hero") && body.classList.contains("has-location")) closeSheet(); });

  // 3) share (a button in the place row: nothing floats over the cards)
  const shareText = () => {
    const t = s => (document.querySelector(s)?.textContent || "").trim();
    const place = t("#locationName"), temp = t("#temperature"), cond = t("#condition");
    const rainEl = document.querySelector("#hourlyList [data-rain], .rain-chance, #rainChance");
    const p = rainEl ? (rainEl.dataset.rain || rainEl.textContent.replace(/[^\d၀-၉]/g, "")) : "";
    const line = [L("share_today"), place, temp ? temp + "°" : "", cond].filter(Boolean).join(" ");
    return line + (p ? " · " + L("share_rain", { p }) : "");
  };
  const toast = msg => { const st = $("status"); if (st) { st.hidden = false; st.textContent = msg; setTimeout(() => { if (st.textContent === msg) st.hidden = true; }, 5000); } };
  $("shareFab")?.addEventListener("click", async () => {
    // First choice: a picture card (place, temperature, rain, today's key lines) that can be posted in Viber / Facebook.
    const btn = $("shareFab"), label = btn.innerHTML;
    if (window.mwShareImage) {
      btn.disabled = true; btn.textContent = "…";
      let r = "error";
      try { r = await window.mwShareImage(); } catch { r = "error"; }
      btn.disabled = false; btn.innerHTML = label;
      if (r === "shared" || r === "cancel") return;
      if (r === "saved") { toast(L("share_img_saved")); return; }
    }
    // No data yet, or the picture could not be made: share the same facts as text.
    const text = shareText(), url = location.origin + location.pathname;
    try { if (navigator.share) { await navigator.share({ title: L("share_title"), text, url }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(text + "\n" + url); } catch {}
    const st = $("status"); if (st) { st.hidden = false; st.textContent = L("share_copied"); setTimeout(() => { if (st.textContent === L("share_copied")) st.hidden = true; }, 4000); }
  });

  // 4) pull-to-refresh (only at the very top of the page, phones/touch only)
  const ptr = $("ptr"), ptrText = $("ptrText");
  let y0 = 0, pull = 0, active = false;
  const setPull = v => { pull = v; if (ptr) { ptr.style.setProperty("--pull", Math.min(v, 90) + "px"); ptr.classList.toggle("show", v > 8); } if (ptrText) ptrText.textContent = L(v > 70 ? "ptr_release" : "ptr_pull"); };
  document.addEventListener("touchstart", e => {
    active = mq.matches && window.scrollY <= 0 && body.classList.contains("has-location") && !body.classList.contains("show-hero") && e.touches.length === 1;
    y0 = active ? e.touches[0].clientY : 0; pull = 0;
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (!active) return;
    const d = e.touches[0].clientY - y0;
    if (d <= 0 || window.scrollY > 0) { if (pull) setPull(0); return; }
    setPull(d * 0.5);
  }, { passive: true });
  document.addEventListener("touchend", () => {
    if (!active) return;
    active = false;
    if (pull > 70) { if (ptrText) ptrText.textContent = L("ptr_loading"); window.dispatchEvent(new Event("mw-refresh")); setTimeout(() => setPull(0), 900); }
    else setPull(0);
  });

  // 5) notification opt-in: asked once, on the 2nd+ visit, never on the very first open
  const tip = $("notifyTip");
  const visits = (() => { const n = (parseInt(store.get("mw_visits") || "0", 10) || 0); return n; })();
  if (!sessionStorage.getItem("mw_visit_counted")) { try { sessionStorage.setItem("mw_visit_counted", "1"); } catch {} store.set("mw_visits", String(visits + 1)); }
  const canAsk = () => "Notification" in window && Notification.permission === "default" && !store.get("mw_notify_tip_done") && (parseInt(store.get("mw_visits") || "0", 10) >= 2);
  const paintNotify = () => { if (tip) tip.hidden = !(canAsk() && body.classList.contains("has-location")); };
  new MutationObserver(paintNotify).observe(body, { attributes: true, attributeFilter: ["class"] });
  $("notifyYes")?.addEventListener("click", async () => { store.set("mw_notify_tip_done", "1"); if (tip) tip.hidden = true; try { await window.MWRNotifications?.requestPermission(); } catch {} });
  $("notifyLater")?.addEventListener("click", () => { store.set("mw_notify_tip_done", "1"); if (tip) tip.hidden = true; });
  paintNotify();

  // 6) swipe left / right between tabs (touch screens only; the tab buttons keep working)
  try { initSwipeTabs(); } catch {}

  // 8) Compare tab: one of three views at a time (Now / This year / Long term). The cards are shown or hidden by CSS from data-view.
  const seg = document.getElementById("cmpSeg"), cmp = document.querySelector('[data-panel="compare"]');
  if (seg && cmp) {
    const btns = [...seg.querySelectorAll("[data-cmp-view]")];
    const show = (b, focus) => {
      cmp.dataset.view = b.dataset.cmpView;
      btns.forEach(x => { const on = x === b; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; });
      if (focus) b.focus();
    };
    seg.addEventListener("click", e => { const b = e.target.closest("[data-cmp-view]"); if (b) show(b); });
    seg.addEventListener("keydown", e => {
      const i = btns.indexOf(document.activeElement); if (i < 0) return;
      const j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? btns.length - 1 : -1;
      if (j < 0) return;
      e.preventDefault(); show(btns[(j + btns.length) % btns.length], true);
    });
  }

  // 7) the moving sky: off when the phone is saving data, paused while the weather band is scrolled out of view
  try { if (navigator.connection?.saveData) document.documentElement.classList.add("no-fx"); } catch {}
  const band = document.querySelector(".current-card");
  if (band && "IntersectionObserver" in window) new IntersectionObserver(es => es.forEach(en => band.classList.toggle("sky-paused", !en.isIntersecting))).observe(band);
})();
