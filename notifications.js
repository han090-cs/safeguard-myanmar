import { L } from "./i18n.js";
import { setStatus } from "./core.js";
import { readLocal, writeLocal, fetchJSON } from "./interaction.js";
/*
 * Lightweight, privacy-first alert notifications.
 *
 * This module intentionally does not require a third-party push service. While the
 * dashboard is open, it polls the official/model alert endpoint and can show a
 * browser notification after the user explicitly enables notifications.
 * Background Web Push is an optional deployment feature and is documented in
 * docs/NOTIFICATIONS.md; no subscription is created automatically.
 */
(() => {
  "use strict";
  const KEY = "mwr:notification-state:v1";
  const INTERVAL = 10 * 60 * 1000;
  const SEEN_TTL = 7 * 24 * 60 * 60 * 1000;
  let timer = null;
  let locationGetter = null;
  let appEnabled=readLocal("mw_notifications_enabled",null),pollController=null;

  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
  const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };
  const enabled = () => "Notification" in window && Notification.permission === "granted" && appEnabled!==false;

  function buttonLabel() {
    const b = document.getElementById("notificationToggle");
    if (!b) return;
    const supported="Notification" in window;
    const on = enabled();
    const text = on ? (L("notif_text")) : (L("notif_alerts"));
    // icon always visible, word hidden on small phones (see styles.css) so the top bar stays on one row
    b.innerHTML = '<span aria-hidden="true">' + (on ? "🔔" : "🔕") + '</span><span class="lbl"> ' + text + '</span>';
    b.setAttribute("aria-label", text);
    b.setAttribute("aria-pressed", String(on));
    b.title=L(supported?"ux_notifications_scope":"ux_notifications_unavailable");
  }

  window.addEventListener("mw-lang", buttonLabel);

  async function requestPermission() {
    if (!("Notification" in window)){setStatus(L("ux_notifications_unavailable"));return;}
    if(enabled()){
      appEnabled=false;writeLocal("mw_notifications_enabled",false);clearInterval(timer);timer=null;pollController?.abort();buttonLabel();setStatus(L("ux_notifications_off"));return;
    }
    if(Notification.permission==="denied"){setStatus(L("ux_notifications_denied"));buttonLabel();return;}
    const b=document.getElementById("notificationToggle");if(b)b.disabled=true;
    try{
      const result=Notification.permission==="granted"?"granted":await Notification.requestPermission();
      if(result==="granted"){appEnabled=true;writeLocal("mw_notifications_enabled",true);setStatus(L("ux_notifications_scope"));beginPolling();}
      else if(result==="denied")setStatus(L("ux_notifications_denied"));
    }catch{setStatus(L("ux_notifications_unavailable"));}
    finally{if(b)b.disabled=false;buttonLabel();}
  }

  function notify({title, body, url}) {
    if (!enabled()) return;
    const n = new Notification(title, { body, icon: "./icon-192.png", tag: "myanmar-weather-alert" });
    if (url) n.onclick = () => { window.focus(); window.open(url, "_blank", "noopener"); };
  }

  function alertKey(w) {
    return [w.id || w.nid || "", w.valid_from || w.issued || "", w.alert_class || w.severity || ""].join("|");
  }

  async function poll(lat, lon, region, name) {
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon)) || !enabled()) return;
    pollController?.abort();const ctl=new AbortController();pollController=ctl;
    try {
      const u = new URL("/api/v1/alerts", (window.MW_API_BASE || location.origin));
      u.searchParams.set("lat", lat); u.searchParams.set("lon", lon);
      if (region) u.searchParams.set("region", region);
      const data=await fetchJSON(u,{signal:ctl.signal,timeout:10000});
      const current=locationGetter?.();if(ctl.signal.aborted||!enabled()||!current||Number(current.lat)!==Number(lat)||Number(current.lon)!==Number(lon))return;
      const state = read();
      const now = Date.now();
      const seen = new Set((state.seen || []).filter(x => {
        const parts = String(x).split("@");
        return parts.length === 2 ? now - Number(parts[1]) < SEEN_TTL : true;
      }).map(x => String(x).split("@")[0]));
      const official = data.official_warnings || [];
      const model = data.model_alerts || [];
      const items = [...official.map(x => ({...x, official: true})), ...model.map(x => ({...x, official: false}))];
      for (const item of items.slice(0, 10)) {
        const key = alertKey(item);
        if (!key || seen.has(key)) continue;
        // Do not spam the user with the first snapshot after enabling.
        if (!state.initialized) { seen.add(key); continue; }
        const title = item.official ? (L("notif_official_dmh_warning")) :
          (L("notif_weather_alert"));
        const text = item.title?.en || item.label || item.situation?.en || item.title?.my || L("notification_weather_attention");
        notify({title, body: `${name || ""}${name ? " · " : ""}${text}`.trim()});
        seen.add(key);
      }
      state.seen = Array.from(seen).slice(-100).map(x => `${x}@${now}`);
      state.initialized = true;
      state.location = {lat, lon, region, name};
      write(state);
    } catch (_) { /* Notifications must never break the weather app. */ }
  }

  function beginPolling() {
    // Never poll (and never touch the "seen" state) until permission is
    // actually granted — polling before that silently marked whatever
    // warnings were active at page-load time as "seen", so a later grant
    // never surfaced them. See docs/NOTIFICATIONS.md.
    if (!enabled() || !locationGetter || timer) return;
    const tick = () => {
      const x = typeof locationGetter === "function" ? locationGetter() : null;
      if (x) poll(x.lat, x.lon, x.region, x.name);
    };
    tick();
    timer = setInterval(tick, INTERVAL);
  }

  function start(getLocation) {
    locationGetter = getLocation;
    // Permission may already be granted from an earlier session — resume
    // polling immediately in that case. Otherwise wait for requestPermission().
    beginPolling();
  }

  window.MWRNotifications = { requestPermission, start, enabled, buttonLabel };
  const bindButton=() => {
    const b = document.getElementById("notificationToggle");
    if (b) b.addEventListener("click", requestPermission);
    buttonLabel();
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bindButton);else bindButton();
  window.addEventListener("mw-cancel",()=>pollController?.abort());
  window.addEventListener("mw-place",()=>{pollController?.abort();if(enabled()&&locationGetter){const x=locationGetter();if(x)poll(x.lat,x.lon,x.region,x.name);}});
})();
