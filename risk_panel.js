import { t } from "./i18n.js";
import { mountRiskView } from "./views.js";
/*
 * risk_panel.js — "What matters today" panel for the Myanmar Weather dashboard.
 *
 * Renders the risk engine's decision objects (/api/v1/what-matters-today) and, on demand, a 7-day outlook and
 * seasonal health notes (/api/v1/risk). All health wording comes from the server; this file only lays it out.
 *
 *   MWRisk.render(container, { lat, lon, region, lang: "my" | "en", apiBase: "", header: true, onResult })
 *        -> Promise<{ ok, count, status, data }>   status: ok | outside | stale | error | aborted | superseded
 *        onResult(result) is also called after the panel's own "Try again" button succeeds or fails.
 *   MWRisk.setLang(container, "en")      re-renders from memory, no network call (any container below)
 *   MWRisk.headline(item, lang)          item title without the repeated severity word
 *   MWRisk.clearCache()
 *   MWRisk.renderSummary(container, result, { lang, onSeeAll })
 *        compact home list (information level 1 + "What can I do?" / "Why am I seeing this?") drawn from the
 *        result that render() passed to onResult — no second request.
 *   MWRisk.renderConditions(container, { lat, lon, lang, apiBase, onResult })
 *        "Compared with normal" cards from /api/v1/climate (levels 2 and 3). Informational only.
 *
 * Offline: the last good What-Matters-Today response per place is kept in localStorage for up to 3 hours and
 * shown, clearly marked, when the network fails. Nothing older is ever shown.
 *
 * Safety rules kept here on purpose:
 *   - Official warnings are drawn in their own block and never mixed with model signals.
 *   - Every model signal shows that it is a model estimate, its confidence (not a probability) and review status.
 *   - API text is drawn as text nodes only (no innerHTML), and only http(s) links are rendered.
 *   - Colour is never the only cue: every class has a shape glyph and a text label; icons are decorative.
 *   - This file never decides a level itself: classes, severities and categories all come from the engine.
 */
(function (global) {
  "use strict";
  // i18n.js is an ES module; the remaining IIFE keeps the public MWRisk global API stable.

  // UI copy lives in i18n/my.json and i18n/en.json; this builder only supplies formatting helpers.
  function riskT(lang) {
    var tr = function (key, params) {
      var value = String(t(lang, "risk_" + key));
      return value.replace(/\{(\w+)\}/g, function (_, name) { return params && params[name] !== undefined ? params[name] : "{" + name + "}"; });
    };
    var weekdays = t(lang, "risk_weekdays");
    var months = t(lang, "risk_months");
    return {
      title: tr("title"), subtitle: tr("subtitle"), official: tr("official"), issuedBy: tr("issuedBy"),
      validUntil: function (s) { return tr("validUntil", {s:s}); }, readOfficial: tr("readOfficial"), when: tr("when"),
      soWhat: tr("soWhat"), whatNext: tr("whatNext"), who: tr("who"), why: tr("why"), canDo: tr("canDo"),
      timeWindow: tr("timeWindow"), limitations: tr("limitations"), dataUsed: tr("dataUsed"), messageClass: tr("messageClass"),
      classNote: t(lang, "risk_classNote"), seeAll: tr("seeAll"), offline: tr("offline"),
      lastData: function (rel) { return tr("lastData", {rel:rel}); }, justNow: tr("justNow"),
      minAgo: function (n) { return tr("minAgo", {n:n}); }, hourAgo: function (n) { return tr("hourAgo", {n:n}); },
      condTitle: tr("condTitle"), condDetails: tr("condDetails"), condNone: tr("condNone"),
      baselineLine: function (period, src) { return tr("baselineLine", {period:period, src:src}); },
      agriculture: tr("agriculture"), sourcesTitle: tr("sourcesTitle"), strength: tr("strength"), myanmarEvidence: tr("myanmarEvidence"),
      confidence: tr("confidence"), notProbability: tr("notProbability"), basedOn: tr("basedOn"), threshold: tr("threshold"),
      sources: function (n) { return tr("sources", {n:n}); }, showSources: tr("showSources"), provisional: tr("provisional"),
      modelSignal: tr("modelSignal"), none: tr("none"), noneNote: tr("noneNote"), outside: tr("outside"), error: tr("error"),
      staleError: function (x) { return tr("staleError", {s:x}); }, retry: tr("retry"), loading: tr("loading"), updated: tr("updated"), stale: tr("stale"),
      officialChecked: function (x) { return tr("officialChecked", {s:x}); }, officialStale: function (x) { return tr("officialStale", {s:x}); },
      officialNever: tr("officialNever"), more: tr("more"), outlook: tr("outlook"), outlookNone: tr("outlookNone"),
      thisWeek: tr("thisWeek"), seasonal: tr("seasonal"), infoTag: tr("infoTag"),
      day: function (p) { return tr("day", {d:p.d, weekday:weekdays[p.wd]}); },
      dayLong: function (p) { return tr("dayLong", {d:p.d, weekday:weekdays[p.wd], month:months[p.m - 1]}); },
      time: function (p) { return tr("time", {time:p.hh + ":" + p.mi}); }
    };
  }
  // The English slot is rebuilt on every read so the Japanese text layer (i18n.js) shows up without a reload.
  var T = { my: riskT("my"), get en() { return riskT("en"); } };


  var VARS_MY = t("my", "risk_vars"), VARS = {};
  Object.keys(VARS_MY).forEach(function (k) {
    Object.defineProperty(VARS, k, { enumerable: true, get: function () { var e = t("en", "risk_vars")[k]; return [VARS_MY[k][0], e ? e[1] : VARS_MY[k][1]]; } });
  });
  var STRENGTH_MY = t("my", "risk_strength_my");
  var ISSUER_MY = t("my", "risk_issuer_my");
  var CLASS_FALLBACK = t("my", "risk_class_fallback");
  var MY_DIGITS = t("my", "risk_digits");

  // Decorative hazard icons (aria-hidden); the text always carries the meaning.
  var HAZARD_ICON = {
    extreme_heat: "🌡️", hot_night: "🌙", occupational_heat: "👷", high_uv: "☀️", fine_particulate_pollution: "🌫️",
    dust_pm10: "🌫️", lightning: "⚡", flood_water: "🌊", post_flood_leptospirosis_exposure: "🌊",
    post_flood_water_food_safety: "🚰", mosquito_breeding_habitat: "🦟", storm_or_cyclone: "🌀",
    dry_spell_water_safety: "💧"
  };
  var COND_ICON = { temperature_max: "🌡️", temperature_min: "🌙", rain_30d: "🌧️", rain_forecast_7d: "☔",
                    dry_spell: "☀️", wet_spell: "🌧️", water_balance_14d: "💧", soil_moisture: "🌱", climate_trend: "📈" };
  var LEVEL_GLYPH = { much_above_normal: "⇈", above_normal: "↑", near_normal: "＝", below_normal: "↓",
                      much_below_normal: "⇊", surplus: "＋", deficit: "−" };
  // Decorative glyph per alert class (aria-hidden); the label text always carries the meaning.
  var CLASS_GLYPH = { information: "ℹ️", advisory: "⚠️", watch: "👁️", official_warning: "🚨" };
  var STORE_PREFIX = "mwr-wmt-v1:";

  var SEVERITY_RANK = { low: 1, moderate: 2, high: 3, very_high: 4, extreme: 5 };
  var TTL_MS = 5 * 60 * 1000;
  var STALE_MS = 3 * 60 * 60 * 1000;    // never show notices older than this ("Today 12:00" would be wrong)
  var YGN_OFFSET_MIN = 390;            // Myanmar Standard Time, UTC+06:30, no daylight saving

  // ------------------------------------------------------------------ helpers
  function my(v) { return String(v).replace(/[0-9]/g, function (d) { return MY_DIGITS[+d]; }); }
  function num(v, lang) { return lang === "my" ? my(v) : String(v); }
  function loc(v, lang) { return v ? (v[lang] || v.en || v.my || "") : ""; }
  /** Evidence level from the knowledge base, e.g. "High (global) / Limited (Myanmar)"; Burmese via the STRENGTH_MY word pairs. */
  function strength(v, lang) {
    var s = String(v || "");
    if (lang !== "my") return s;
    STRENGTH_MY.forEach(function (p) { s = s.split(p[0]).join(p[1]); });
    return s;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /** Date parts in Myanmar time, independent of the viewer's own time zone. */
  function ygn(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return null;
    var s = new Date(t + YGN_OFFSET_MIN * 60000);
    return { y: s.getUTCFullYear(), m: s.getUTCMonth() + 1, d: s.getUTCDate(), wd: s.getUTCDay(),
             hh: pad(s.getUTCHours()), mi: pad(s.getUTCMinutes()), key: s.toISOString().slice(0, 10) };
  }

  function classLabel(cls, lbl, lang) {
    return loc(lbl, lang) || (CLASS_FALLBACK[cls] ? CLASS_FALLBACK[cls][lang === "my" ? 0 : 1] : "");
  }

  function classBadge(cls, lbl, lang, extra) {
    var c = CLASS_GLYPH[cls] ? cls : "information";
    return { c: c, glyph: CLASS_GLYPH[c], text: classLabel(c, lbl, lang) + (extra ? " · " + extra : "") };
  }

  /** "လွန်ခဲ့တဲ့ ၁၈ မိနစ်" / "18 min ago" */
  function relative(iso, lang) {
    var t = T[lang], ms = Date.now() - Date.parse(iso);
    if (isNaN(ms)) return "";
    var min = Math.floor(ms / 60000);
    if (min < 1) return t.justNow;
    if (min < 60) return t.minAgo(min);
    var g = ygn(iso);
    if (min < 24 * 60) return t.hourAgo(Math.floor(min / 60));
    return g ? t.dayLong(g) + " " + t.time(g) : "";
  }

  // Last good response per place, for offline use. Storage can be missing or full; every call is guarded.
  function remember(url, data) {
    try { global.localStorage.setItem(STORE_PREFIX + url, JSON.stringify({ saved: Date.now(), data: data })); } catch (e) { /* ignore */ }
  }
  function recall(url) {
    try {
      var v = JSON.parse(global.localStorage.getItem(STORE_PREFIX + url) || "null");
      if (!v || !v.data || !(Date.now() - Date.parse(v.data.generated_at) < STALE_MS)) return null;
      return v;
    } catch (e) { return null; }
  }

  function safeUrl(u) {
    try {
      var p = new URL(u, global.location.href);
      return (p.protocol === "https:" || p.protocol === "http:") ? p.href : null;
    } catch (e) { return null; }
  }

  // ------------------------------------------------------------------ network (in-memory cache, abortable)
  var cache = new Map();

  var REQUEST_TIMEOUT_MS = 15000;   // a slow upstream shows an error + retry instead of an endless spinner

  function getJSON(url, signal) {
    var hit = cache.get(url);
    if (hit && Date.now() - hit.t < TTL_MS) return Promise.resolve(hit.data);
    var ctl = new AbortController(), timedOut = false;
    var onAbort = function () { ctl.abort(); };
    if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener("abort", onAbort); }
    var timer = setTimeout(function () { timedOut = true; ctl.abort(); }, REQUEST_TIMEOUT_MS);
    return fetch(url, { signal: ctl.signal, headers: { Accept: "application/json" } }).then(function (r) {
      if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
      return r.json();
    }).then(function (data) { cache.set(url, { t: Date.now(), data: data }); return data; })
      .catch(function (e) {
        if (timedOut) { var te = new Error("timeout"); te.status = "timeout"; throw te; }
        throw e;
      })
      .then(function (v) { clearTimeout(timer); if (signal) signal.removeEventListener("abort", onAbort); return v; },
            function (e) { clearTimeout(timer); if (signal) signal.removeEventListener("abort", onAbort); throw e; });
  }

  function apiUrl(o, path, extra) {
    var q = new URLSearchParams({ lat: (+o.lat).toFixed(4), lon: (+o.lon).toFixed(4) });
    if (o.region) q.set("region", o.region);
    Object.keys(extra || {}).forEach(function (k) { q.set(k, extra[k]); });
    return (o.apiBase || "") + path + "?" + q.toString();
  }

  // ------------------------------------------------------------------ per-container state
  var states = new WeakMap();
  window.addEventListener("mw-cancel",function(){["hazards","conditions"].forEach(function(id){var c=document.getElementById(id),st=c&&states.get(c);if(st){st.controller.abort();states.delete(c);c.removeAttribute("aria-busy");}});});

  function render(container, opts) {
    if (!container) return Promise.resolve({ ok: false, count: 0, status: "no-container" });
    var prev = states.get(container);
    if (prev && prev.controller) prev.controller.abort();
    var st = { opts: Object.assign({ lang: "my", apiBase: "", limit: 3, header: true }, opts), controller: new AbortController(),
               wmt: null, risk: null, error: null, outlookOpen: false };
    states.set(container, st);

    container.classList.add("mwr");
    container.setAttribute("aria-busy", "true");
    if (!container.firstChild || !prev || prev.opts.lat !== st.opts.lat || prev.opts.lon !== st.opts.lon) drawLoading(container, st);

    var url = apiUrl(st.opts, "/api/v1/what-matters-today", { limit: st.opts.limit });
    return getJSON(url, st.controller.signal).then(function (data) {
      if (states.get(container) !== st) return { ok: false, count: 0, status: "superseded" };
      var age = Date.now() - Date.parse(data.generated_at);
      if (!(age < STALE_MS)) {                       // also catches a missing or unparsable timestamp
        var e = new Error("stale"); e.status = "stale"; e.generatedAt = data.generated_at; throw e;
      }
      st.wmt = data;
      remember(url, data);
      draw(container, st);
      return finish(st, { ok: true, count: data.items.length, status: "ok", data: data });
    }).catch(function (err) {
      if (err && err.name === "AbortError") return { ok: false, count: 0, status: "aborted" };
      if (states.get(container) !== st) return { ok: false, count: 0, status: "superseded" };
      if (err && err.status === "stale") cache.delete(url);
      var kept = err && err.status !== 422 ? recall(url) : null;
      if (kept) {                                   // offline or server down: last good data, clearly marked
        st.wmt = kept.data; st.offline = true;
        draw(container, st);
        return finish(st, { ok: true, count: kept.data.items.length, status: "offline", offline: true, data: kept.data });
      }
      st.error = err;
      draw(container, st);
      var status = err && err.status === 422 ? "outside" : err && err.status === "stale" ? "stale" : "error";
      return finish(st, { ok: false, count: 0, status: status, data: null });
    });
  }

  function finish(st, result) {
    if (typeof st.opts.onResult === "function") {
      try { st.opts.onResult(result); } catch (e) { /* a caller's error must not break the panel */ }
    }
    return result;
  }

  function setLang(container, lang) {
    var st = states.get(container);
    if (!st) return;
    st.opts.lang = lang === "en" ? "en" : "my";
    if(!st.wmt && !st.data && !st.error)return;
    if(window.MWUX)window.MWUX.preserveView(function(){(st.redraw || draw)(container, st);});else (st.redraw || draw)(container, st);
  }

  // ------------------------------------------------------------------ drawing (Preact: frontend/src/risk_view.jsx)
  // These functions only build plain text models; risk_view.jsx lays them out.
  var V = null;
  function view() { return V || (V = mountRiskView()); }
  function redrawNow(container, st) { (st.redraw || draw)(container, st); }

  function headerModel(st) {
    var t = T[st.opts.lang];
    return st.opts.header ? { title: t.title, subtitle: t.subtitle } : null;
  }

  function drawLoading(container, st) {
    var t = T[st.opts.lang];
    container.setAttribute("lang", st.opts.lang);
    view().panel(container.id, { head: headerModel(st), loading: t.loading });
  }

  function draw(container,st){return window.MWUX?window.MWUX.preserveView(function(){return drawData(container,st);}):drawData(container,st);}
  function drawData(container, st) {
    var lang = st.opts.lang, t = T[lang];
    container.setAttribute("lang", lang);
    container.removeAttribute("aria-busy");
    var head = headerModel(st);

    if (st.error) {
      var outside = st.error.status === 422, g = st.error.status === "stale" ? ygn(st.error.generatedAt) : null;
      var msg = outside ? t.outside : g ? t.staleError(t.dayLong(g) + " " + t.time(g)) : t.error;
      view().panel(container.id, { head: head, error: { outside: outside, msg: msg, retry: outside ? null : t.retry,
        onRetry: function () { render(container, st.opts); } } });
      return;
    }

    var d = st.wmt;
    view().panel(container.id, {
      head: head,
      offline: st.offline ? t.offline : null,
      official: (d.official_warnings || []).map(function (w) { return officialModel(w, lang); }),
      none: d.items.length ? null : { text: t.none, note: t.noneNote },
      items: d.items.map(function (it) { return itemModel(it, lang, container, st); }),
      outlook: outlookModel(container, st),
      foot: footerModel(d, lang, st.offline)
    });
  }

  function officialModel(w, lang) {
    var t = T[lang], until = ygn(w.valid_to);
    return {
      glyph: CLASS_GLYPH.official_warning, tag: t.official, title: loc(w.title, lang), summary: w.summary ? loc(w.summary, lang) : null,
      issued: t.issuedBy + ": " + (lang === "my" && ISSUER_MY[w.source] ? ISSUER_MY[w.source] : w.issuer),
      until: until ? " · " + t.validUntil(t.dayLong(until) + " " + t.time(until)) : "",
      url: safeUrl((w.links && w.links[lang]) || w.url || ""), readOfficial: t.readOfficial
    };
  }

  function itemModel(it, lang, container, st, compact) {
    var t = T[lang], why = it.why_we_believe_this || {};
    var sev = SEVERITY_RANK[it.severity] ? it.severity : "moderate";
    return {
      sev: sev, cls: it.alert_class || "information", badge: classBadge(it.alert_class, it.alert_class_label, lang),
      pill: loc(it.severity_label, lang), whenLabel: t.when + ": ", when: loc(it.when, lang),
      icon: icon(it.hazard), headline: compact ? headline(it, lang) + " – " + loc(it.severity_label, lang) : headline(it, lang),
      soWhatLabel: t.soWhat + ": ", soWhat: loc(it.so_what, lang), nextLabel: t.whatNext, next: loc(it.what_next, lang),
      canDo: t.canDo,
      who: it.who && it.who.length ? { label: t.who, list: it.who.map(function (g) { return loc(g, lang); }) } : null,
      why: whyModel(it, why, lang, container, st, compact)
    };
  }

  function icon(hazard) { return HAZARD_ICON[hazard] ? HAZARD_ICON[hazard] + " " : null; }

  /** "UV index – HIGH" → "UV index": the severity pill already carries the level. */
  function headline(it, lang) {
    var w = loc(it.what, lang), sl = loc(it.severity_label, lang), tail = " – " + sl;
    return sl && w.length > tail.length && w.slice(-tail.length) === tail ? w.slice(0, -tail.length) : w;
  }

  function driverLine(dv, lang) {
    var t = T[lang], name = VARS[dv.variable] ? VARS[dv.variable][lang === "my" ? 0 : 1] : dv.variable;
    var s = name;
    if (dv.value !== null && dv.value !== undefined) s += ": " + num(dv.value, lang) + (dv.unit ? " " + dv.unit : "");
    if (dv.threshold !== null && dv.threshold !== undefined) s += " (" + t.threshold + " " + num(dv.threshold, lang) + ")";
    return s;
  }

  function whyModel(it, why, lang, container, st, compact) {
    var t = T[lang];
    var cls = it.alert_class || why.alert_class;
    var tw = why.time_window && why.time_window.label ? loc(why.time_window.label, lang) : loc(it.when, lang);
    var rows = [
      compact ? [t.soWhat, loc(it.so_what, lang)] : null,
      cls ? [t.messageClass, classLabel(cls, it.alert_class_label, lang) + " – " + t.classNote[cls]] : null,
      [t.timeWindow, tw],
      [t.strength, strength(why.relationship_strength, lang)],
      [t.myanmarEvidence, loc(why.myanmar_evidence, lang)],
      [t.confidence, loc(why.confidence, lang) + " (" + t.notProbability + ")"],
      why.data_sources && why.data_sources.length ? [t.dataUsed, why.data_sources.join(", ")] : null
    ].filter(Boolean).filter(function (r) { return r[1]; });
    var lims = why.limitations || [];
    var srcs = (why.sources || []).filter(function (s) { return s && (s.citation || s.url); });
    var drivers = (why.drivers || []).filter(function (dv) { return dv.variable; });
    var ep = why.evidence_endpoint, ss = ep && st.sources ? st.sources[ep] : null;
    var key = "why:" + (it.risk_id || it.rule_id || (it.what && it.what.en) || "");
    return {
      key: key, summary: t.why, rows: rows,
      drivers: drivers.length ? { label: t.basedOn, list: drivers.map(function (dv) { return driverLine(dv, lang); }) } : null,
      lims: lims.length ? { label: t.limitations, list: lims, lang: why.limitations_lang || null } : null,
      tagModel: t.modelSignal, tagProv: why.review_status && why.review_status !== "approved" ? t.provisional : null,
      srcs: srcs.length ? { label: t.sourcesTitle, list: srcs.map(function (s) { var href = s.url && safeUrl(s.url); return { href: href, text: s.citation || href }; }) } : null,
      btn: !srcs.length && ep && !(ss && ss.status === "done") ? {
        text: why.source_count ? t.showSources + " (" + t.sources(num(why.source_count, lang)) + ")" : t.showSources,
        disabled: !!(ss && ss.status === "loading"),
        onClick: function () { loadSources(container, st, ep, key); } } : null,
      box: !srcs.length && ep && ss ? (ss.status === "loading" ? { kind: "loading", text: t.loading }
        : ss.status === "error" ? { kind: "error", text: t.error } : { kind: "list", list: ss.items }) : null
    };
  }

  function loadSources(container, st, endpoint, key) {
    st.sources = st.sources || {};
    st.sources[endpoint] = { status: "loading" };
    redrawNow(container, st);
    var url = (st.opts.apiBase || "") + endpoint;
    getJSON(url, st.controller ? st.controller.signal : undefined).then(function (data) {
      if (states.get(container) !== st) return;
      st.sources[endpoint] = { status: "done", items: (data.sources || []).map(function (s) {
        var href = s.url && safeUrl(s.url);
        return { href: href, text: s.citation || s.organization || s.key };
      }) };
      redrawNow(container, st);
      var open = container.querySelectorAll("details.mwr-why[data-detail-key]");   // the button is gone: keep keyboard focus on the section
      for (var i = 0; i < open.length; i++) if (open[i].getAttribute("data-detail-key") === key) { var s = open[i].querySelector("summary"); if (s) s.focus({ preventScroll: true }); break; }
    }).catch(function () {
      if (states.get(container) !== st) return;
      st.sources[endpoint] = { status: "error" };
      redrawNow(container, st);
    });
  }

  // ------------------------------------------------------------------ 7-day outlook + seasonal cards (lazy)
  function outlookModel(container, st) {
    var t = T[st.opts.lang], body = null;
    if (st.outlookOpen) {
      if (st.risk) body = outlookBody(st);
      else if (st.riskError) body = { kind: "error", text: t.error };
      else body = { kind: "loading", text: t.loading };
    }
    return { summary: t.more, open: !!st.outlookOpen, body: body, onToggle: function (ev) {
      var open = ev.currentTarget.open;
      if (open === !!st.outlookOpen) return;
      st.outlookOpen = open;
      if (!open) return;
      if (st.risk) { redrawNow(container, st); return; }
      st.riskError = false; redrawNow(container, st);
      getJSON(apiUrl(st.opts, "/api/v1/risk", { horizon_days: 7 }), st.controller.signal).then(function (data) {
        if (states.get(container) !== st) return;
        st.risk = data;
        redrawNow(container, st);
      }).catch(function (err) {
        if (err && err.name === "AbortError") return;
        st.riskError = true;
        redrawNow(container, st);
      });
    } };
  }

  function outlookBody(st) {
    var lang = st.opts.lang, t = T[lang], d = st.risk;
    var shown = {};
    (st.wmt ? st.wmt.items : []).forEach(function (i) { shown[i.risk_id] = true; });

    // Group notice-level signals by rule: highest severity, list of days.
    var groups = {}, order = [];
    (d.model_signals || []).forEach(function (s) {
      if (s.display !== "notice" || shown[s.risk_id]) return;
      var g = groups[s.rule_id];
      if (!g) { g = groups[s.rule_id] = { label: s.label, severity: s.severity, severity_label: s.severity_label, days: [], weekly: false }; order.push(s.rule_id); }
      if ((SEVERITY_RANK[s.severity] || 0) > (SEVERITY_RANK[g.severity] || 0)) { g.severity = s.severity; g.severity_label = s.severity_label; }
      if (s.frequency_cap === "weekly") { g.weekly = true; return; }
      var p = ygn(s.time_window.start);
      if (p && !g.days.some(function (x) { return x.key === p.key; })) g.days.push(p);
    });
    order.sort(function (a, b) { return (SEVERITY_RANK[groups[b].severity] || 0) - (SEVERITY_RANK[groups[a].severity] || 0); });

    var cards = d.informational || [];
    return {
      kind: "data", head: t.outlook, none: t.outlookNone, seasonal: t.seasonal, infoTag: t.infoTag,
      rows: order.map(function (rid) {
        var g = groups[rid];
        g.days.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
        return { sev: SEVERITY_RANK[g.severity] ? g.severity : "moderate", pill: loc(g.severity_label, lang), name: loc(g.label, lang),
          days: g.weekly && !g.days.length ? t.thisWeek : g.days.map(function (p) { return t.day(p); }).join(" · ") };
      }),
      prov: cards.some(function (c) { return c.evidence && c.evidence.review_status && c.evidence.review_status !== "approved"; }) ? t.provisional : null,
      cards: cards.map(function (c) { return loc(c.text, lang); })
    };
  }

  function footerModel(d, lang, offline) {
    var t = T[lang];
    var stale = (d.data_freshness || []).some(function (f) { return f.stale; });
    var sources = (d.data_freshness || []).map(function (f) { return f.source; }).join(", ");
    return {
      official: officialSourceModel(d.official_source, lang),
      last: d.generated_at ? { cls: offline ? "mwr-stale" : null, text: t.lastData(relative(d.generated_at, lang)) } : null,
      sources: sources, stale: stale ? t.stale : null
    };
  }

  /** Only shown when a source is not fully available: "Air quality – Temporarily unavailable". */
  function providerText(providers, lang) {
    var bad = (providers || []).filter(function (p) { return p.status !== "available" && p.status !== "not_configured"; });
    if (!bad.length) return null;
    return bad.map(function (p, i) { return (i ? " · " : "") + loc(p.label, lang) + " – " + loc(p.status_label, lang); }).join("");
  }

  /** When DMH was last checked, so that "no official warning shown" is never ambiguous. */
  function officialSourceModel(os, lang) {
    if (!os || !os.importer_enabled) return null;
    var t = T[lang], g = os.last_success_at ? ygn(os.last_success_at) : null, today = ygn(new Date().toISOString());
    var when = g ? (today && g.key === today.key ? t.time(g) : t.dayLong(g) + " " + t.time(g)) : null;
    var text = !g ? t.officialNever : os.stale ? t.officialStale(when) : t.officialChecked(when);
    return { cls: os.stale || !g ? "mwr-official-source mwr-official-source--stale" : "mwr-muted mwr-official-source", text: text };
  }

  // ------------------------------------------------------------------ home: compact "What matters today"
  function renderSummary(container, result, opts) {
    if (!container) return;
    var st = { opts: Object.assign({ lang: "my" }, opts), result: result, redraw: drawSummary };
    states.set(container, st);
    container.classList.add("mwr", "mwr-summary");
    drawSummary(container, st);
  }

  function drawSummary(container, st) {
    var lang = st.opts.lang, t = T[lang], res = st.result || {};
    container.setAttribute("lang", lang);
    if (!res.ok) {
      view().summary(container.id, { msg: res.status === "outside" ? t.outside : res.status === "loading" ? t.loading : t.error });
      return;
    }
    var d = res.data;
    view().summary(container.id, {
      offline: res.offline ? t.offline : null,
      official: (d.official_warnings || []).map(function (w) {
        var until = ygn(w.valid_to), url = safeUrl((w.links && w.links[lang]) || w.url || "");
        return { badge: classBadge("official_warning", null, lang), title: loc(w.title, lang),
          until: until ? t.validUntil(t.dayLong(until) + " " + t.time(until)) : "", url: url, readOfficial: t.readOfficial };
      }),
      none: d.items.length ? null : t.none,
      items: d.items.map(function (it) { return itemModel(it, lang, container, st, true); }),
      foot: {
        official: officialSourceModel(d.official_source, lang),
        providers: providerText(d.providers, lang),
        last: d.generated_at ? { cls: "mwr-muted" + (res.offline ? " mwr-stale" : ""), text: t.lastData(relative(d.generated_at, lang)) } : null,
        seeAll: typeof st.opts.onSeeAll === "function" ? { text: t.seeAll, onClick: function () { st.opts.onSeeAll(); } } : null
      }
    });
  }

  // ------------------------------------------------------------------ climate tab: conditions vs normal
  function renderConditions(container, opts) {
    if (!container) return Promise.resolve({ ok: false, status: "no-container" });
    var prev = states.get(container);
    var o = Object.assign({ lang: "my", apiBase: "" }, opts);
    var url = apiUrl({ lat: o.lat, lon: o.lon, apiBase: o.apiBase }, "/api/v1/climate");
    if (prev && prev.url === url && (prev.data || prev.pending)) {      // same place: reuse, just redraw
      prev.opts.lang = o.lang;
      if (prev.data) drawConditions(container, prev);
      return prev.pending || Promise.resolve({ ok: true, status: "ok", data: prev.data });
    }
    if (prev && prev.controller) prev.controller.abort();
    var st = { opts: o, url: url, data: null, error: null, controller: new AbortController(), redraw: drawConditions };
    states.set(container, st);
    container.classList.add("mwr", "mwr-conditions");
    container.setAttribute("aria-busy", "true");
    view().conditions(container.id, { loading: T[o.lang].loading });
    st.pending = getJSON(url, st.controller.signal).then(function (data) {
      if (states.get(container) !== st) return { ok: false, status: "superseded" };
      st.data = data; st.pending = null;
      drawConditions(container, st);
      var r = { ok: true, status: "ok", data: data };
      if (typeof o.onResult === "function") { try { o.onResult(r); } catch (e) { /* ignore */ } }
      return r;
    }).catch(function (err) {
      st.pending = null;
      if (err && err.name === "AbortError") return { ok: false, status: "aborted" };
      if (states.get(container) !== st) return { ok: false, status: "superseded" };
      st.error = err;
      drawConditions(container, st);
      var r = { ok: false, status: err && err.status === 422 ? "outside" : "error" };
      if (typeof o.onResult === "function") { try { o.onResult(r); } catch (e) { /* ignore */ } }
      return r;
    });
    return st.pending;
  }

  function fmtMetric(m, lang) {
    if (m.value === null || m.value === undefined) return "—";
    var v = Math.round(m.value * 100) / 100;
    return num(v, lang) + (m.unit && m.unit !== "days" ? " " + m.unit : m.unit === "days" ? " " + t(lang, "risk_days") : "");
  }

  function drawConditions(container, st) {
    var lang = st.opts.lang, t = T[lang];
    container.setAttribute("lang", lang);
    container.removeAttribute("aria-busy");
    if (st.error || !st.data) {
      view().conditions(container.id, { msg: st.error && st.error.status === 422 ? t.outside : t.condNone });
      return;
    }
    var d = st.data;
    view().conditions(container.id, {
      none: t.condNone, last: d.generated_at ? t.lastData(relative(d.generated_at, lang)) : null,
      list: (d.conditions || []).map(function (c) {
        var lvl = c.level && LEVEL_GLYPH[c.level] ? c.level : null;
        var agri = (c.domains || []).indexOf("agriculture") >= 0 && (c.domains || []).indexOf("environment") < 0;
        return {
          lvl: lvl, icon: COND_ICON[c.kind] ? COND_ICON[c.kind] + " " : null, title: loc(c.title, lang), agri: agri ? t.agriculture : null,
          level: c.level_label ? loc(c.level_label, lang) : null, glyph: lvl ? LEVEL_GLYPH[lvl] + " " : null, headline: loc(c.headline, lang),
          details: t.condDetails, metrics: (c.metrics || []).map(function (m) { return [loc(m.label, lang), fmtMetric(m, lang)]; }),
          lims: (c.limitations || []).length ? { label: t.limitations, list: c.limitations.map(function (x) { return loc(x, lang); }) } : null,
          sources: (c.sources || []).length ? t.dataUsed + ": " + c.sources.join("; ") : null
        };
      })
    });
  }

  global.MWRisk = {
    render: render,
    setLang: setLang,
    headline: headline,
    renderSummary: renderSummary,
    renderConditions: renderConditions,
    clearCache: function () { cache.clear(); },
    _internals: { ygn: ygn, my: my, T: T, relative: relative }
  };
})(window);
