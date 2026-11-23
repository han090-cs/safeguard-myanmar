importScripts("./sw-version.js");

const VERSION = SW_VERSION;
async function matchCached(request){
  const current=await caches.open(VERSION),hit=await current.match(request);
  return hit || caches.match(request);
}
const SHELL = [
  "./",
  "./weather.html",
  "./i18n.js",
  "./i18n/my.json",
  "./i18n/en.json",
  "./i18n/weather_codes.json",
  "./i18n/scales.json",
  "./i18n/ja.json",
  "./i18n/scales_ja.json",
  "./i18n/weather_codes_ja.json",
  "./i18n/ja_easy.json",
  "./i18n/scales_ja_easy.json",
  "./i18n/weather_codes_ja_easy.json",
  "./sw-version.js",
  "./theme_init.js",
  "./error_report.js",
  "./styles.css",
  "./ux.css",
  "./pro.css",
  "./about.js",
  "./legal.html",
  "./pests.js",
  "./weather_script.js",
  "./core.js",
  "./net.js",
  "./enso_card.js",
  "./emergency_card.js",
  "./nature.js",
  "./mm_calendar.js",
  "./wxicon.js",
  "./swipe_tabs.js",
  "./field_guides.js",
  "./scale_ui.js",
  "./render_cards.js",
  "./health_tips.js",
  "./safety.js",
  "./flood_status.js",
  "./hospitals.js",
  "./risk_panel.js",
  "./agri.js",
  "./views.js",
  "./views_compare.js",
  "./views_farm.js",
  "./views_more.js",
  "./views_lab.js",
  "./vchunk-preact.js",
  "./vchunk-slots.js",
  "./vchunk-guides_view.js",
  "./lazy_views.js",
  "./feeds.js",
  "./world.js",
  "./history.js",
  "./monthly_compare.js",
  "./interaction.js",
  "./compare.js",
  "./help.js",
  "./brief.js",
  "./rainlog.js",
  "./leaf.js",
  "./leaf_data.js",
  "./leaf_models.js",
  "./leaf_prep.js",
  "./leaf_engine.js",
  "./app_boot.js",
  "./fonts/noto-myanmar-400.woff2",
  "./fonts/noto-myanmar-700.woff2",
  "./notifications.js",
  "./manifest.json",
  "./logo.png",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => Promise.all(SHELL.map(u => fetch(new Request(u, { cache: "reload" })).then(r => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return cache.put(u, r); }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => {
        const old = keys.filter(k => k !== VERSION);
        // Retain prior caches during this non-destructive local upgrade.
        return old.some(k=>k.startsWith("weather-"));
      })
      .then(async (wasUpdate) => {
        await self.clients.claim();
        // Only announce an update when a previous version existed; a first visit is not an update.
        if (!wasUpdate) return;
        const clients = await self.clients.matchAll({type: "window"});
        for (const client of clients) client.postMessage({type: "MW_APP_UPDATED", version: VERSION});
      })
  );
});

// On a poor connection a plain network-first fetch can hang for a minute. After `ms` we answer from the cache
// (if we have one) and let the network request keep running so the cache is refreshed for next time.
function isSlowConn() {
  const c = self.navigator && self.navigator.connection;
  return !!(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || "") || c.effectiveType === "3g" || (c.rtt && c.rtt >= 700)));
}

function networkFirstWithTimeout(request, ms) {
  return new Promise(resolve => {
    let settled = false;
    const done = r => { if (!settled) { settled = true; resolve(r); } };
    const fromCache = () => matchCached(request).then(hit => { if (hit) done(hit); return hit; });
    const timer = setTimeout(fromCache, ms);
    fetch(request, { cache: "no-cache" }).then(response => {
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        caches.open(VERSION).then(cache => cache.put(request, copy));
      }
      clearTimeout(timer);
      done(response);
    }).catch(() => {
      clearTimeout(timer);
      fromCache().then(hit => { if (!hit) done(Response.error()); });
    });
  });
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Health notices: network only. A cached notice saying "Today 12:00" could be days old, so it is never
  // served from this cache. When offline, risk_panel.js shows its own last good copy (at most 3 hours old,
  // marked "offline") or "couldn't be loaded".
  if (url.pathname.startsWith("/api/v1/")) {
    event.respondWith(fetch(request, { cache: "no-cache" }));
    return;
  }

  // Crash notes (error_report.js) are fire-and-forget: never cached, never answered from the cache.
  if (url.pathname === "/api/client-error") { return; }

  // API calls: network-first. A stale API response is useful during
  // temporary outages, but we never put an API failure into the shell cache.
  // Hazard feed: never answer from a cache, an old quake/cyclone alert must not look current.
  if (url.pathname.startsWith("/api/hazard-feed") || url.pathname.startsWith("/api/local-extras")) { return; }

  // Static reference data (places, hospitals, El Nino status) changes rarely: if the network is slow, answer from
  // the cache after a short deadline. Warnings and flood data are NOT in this list, so a stale alert is never served.
  if (/^\/api\/(regions|hospitals|enso|agri)/.test(url.pathname)) {
    event.respondWith(networkFirstWithTimeout(request, isSlowConn() ? 3000 : 5000));
    return;
  }

  if (url.pathname.startsWith("/api/") || url.hostname.includes("open-meteo.com")) {
    event.respondWith(fetch(request, {cache:"no-cache"}).then(response=>{
      if(response.ok) {
        const headers=new Headers(response.headers); headers.set("X-MW-Cached-At",String(Date.now()));
        const stored=new Response(response.clone().body,{status:response.status,headers});
        event.waitUntil(caches.open(VERSION).then(cache=>cache.put(request,stored)));
      }
      return response;
    }).catch(async()=>{
      const hit=await matchCached(request); if(!hit)return Response.error();
      const isWarning=/^\/api\/(dmh|flood)/.test(url.pathname);
      const age=Date.now()-Number(hit.headers.get("X-MW-Cached-At")||0);
      if(age>(isWarning?3*3600000:24*3600000))return Response.error();
      try {
        const data=await hit.clone().json();
        data.meta={...data.meta,stale:true,offline_cache:true,cached:true};
        if(isWarning){data.source_status={...data.source_status,stale:true}; if(data.status==="available")data.status="stale";}
        return new Response(JSON.stringify(data),{headers:{"Content-Type":"application/json","X-MW-Offline":"1"}});
      } catch { return hit; }
    }));
    return;
  }

  // On-device leaf check: the ONNX runtime parts and the two models never change under the same file name (a new model gets a new name),
  // so they are answered cache-first from their own cache and downloaded once (about 14 MB). They are not part of the precached shell on purpose.
  if (url.pathname.startsWith("/vendor/ort/") || url.pathname.startsWith("/models/leaf/")) {
    event.respondWith(caches.open("sg-leaf-v1").then(async cache => {
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") event.waitUntil(cache.put(request, response.clone()));
      return response;
    }));
    return;
  }

  // App shell (html/js/css): network-first so a fixed script reaches users immediately; cache only when offline.
  const isCode = /\.(?:html|js|css|json)$/.test(url.pathname) || url.pathname === "/" || url.pathname.endsWith("/");
  if (isCode) {
    // Poor connection (2G/3G, high latency, data saver): open instantly from the cache and refresh it in the
    // background, so the page never waits on a slow network. Otherwise keep network-first with a short deadline.
    if (isSlowConn()) {
      event.respondWith(matchCached(request).then(hit => {
        const refresh = fetch(request, { cache: "no-cache" }).then(response => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(VERSION).then(cache => cache.put(request, copy));
          }
          return response;
        });
        if (hit) { event.waitUntil(refresh.catch(() => {})); return hit; }
        return refresh;
      }));
    } else {
      event.respondWith(networkFirstWithTimeout(request, 2500));
    }
    return;
  }

  // Icons / manifest: cache-first, then network.
  event.respondWith(
    matchCached(request).then(cached => {
      if (cached) return cached;
      return fetch(request, { cache: "no-cache" }).then(response => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(VERSION).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
