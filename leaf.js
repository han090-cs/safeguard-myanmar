// Lab tab = leaf check. This file is the controller: the picked crop, the photo, the ticked signs, the three independent looks
// (signs, photo model on this phone, optional AI on the visitor's own key) and the log of saved checks. The numbers and rules are in leaf_data.js (pure),
// the models in leaf_models.js / leaf_engine.js, and the screen is frontend/src/leaf_view.jsx (drawn by Preact, loaded on first use).
import { L, isJapanese } from "./i18n.js";
import { state, digits, placeTz, fmtPlaceDateTime } from "./core.js";
import { preserveView, readLocal, writeLocal } from "./interaction.js";
import { PESTS, PEST_CROPS } from "./pests.js";
import * as D from "./leaf_data.js";
import { PHOTO, MODELS, CLASSES, FACTS, GATE, ENGINE } from "./leaf_models.js";
import { loadModel, classify, engineReady, modelReady } from "./leaf_engine.js";
import { mountLeafView } from "./lazy_views.js";

const MAX_SIDE = 1024, MAX_FILE = 30 * 1024 * 1024, ENGINE_FLAG = "mw_leaf_engine", CROP_KEY = "mw_leaf_crop";
const BY_ID = Object.fromEntries(PESTS.map(p => [p.id, p]));
const lang = () => (state.lang === "my" ? "my" : "en");
const T = (k, p) => L(k, p);
const pct = v => Math.round(v * 100);

// ---- state ------------------------------------------------------------------------------------------------------------
let VIEW = null, LOC = null;
let CROP = String(readLocal(CROP_KEY, "") || "");
if (!PEST_CROPS.some(c => c.id === CROP)) CROP = "";
let PICKED = new Set();
let PX = null, PREVIEW = "", PHOTOBAD = false, PHOTO_SEQ = 0;                  // PX = {data (RGBA), w, h}: what the photo model reads
let PQ = null;                                                                  // quick quality check of that photo: { issues: ["dark" | "bright" | "far" | "blurry"], ... }
let PH = { state: "idle" }, PH_SEQ = 0;                                         // photo model: idle | busy | done | err
let ENG = { loaded: 0, total: 0 };
let AIS = { enabled: false, byok: false, per_hour: 0, byok_per_hour: 0, known: false }, AI = { state: "idle" }, AI_SEQ = 0, AI_CTL = null;
let KEY = loadKey(), KEY_NOTE = "";                                             // the visitor's own AI key: this device only, never in the log, the CSV or any URL
let LOG = readLog(), SAVED = "", CLEAR_ARMED = false, CLEAR_TIMER = 0;
let engineCached = readLocal(ENGINE_FLAG, 0) === 1;

/** The key lives in sessionStorage (until this tab closes) or, only if the person ticked "remember", in localStorage. Never anywhere else. */
function loadKey() {
  for (const [area, remember] of [["localStorage", true], ["sessionStorage", false]]) {
    try { const v = window[area].getItem(D.KEY_STORE); if (D.isKey(v)) return { value: v, remember, bad: false }; } catch { /* storage blocked: no saved key */ }
  }
  return { value: "", remember: false, bad: false };
}
function persistKey() {
  const put = (area, v) => { try { if (v) window[area].setItem(D.KEY_STORE, v); else window[area].removeItem(D.KEY_STORE); } catch { /* the key then lives in memory only */ } };
  put("localStorage", KEY.remember ? KEY.value : "");
  put("sessionStorage", KEY.remember ? "" : KEY.value);
}
function readLog() { const j = readLocal(D.LOG_KEY, null); return j && j.v === 1 && Array.isArray(j.rows) ? j : D.emptyLog(); }
function writeLog(log) { try { localStorage.setItem(D.LOG_KEY, JSON.stringify(log)); return true; } catch { return false; } }

// ---- names -------------------------------------------------------------------------------------------------------------
const cropName = id => { const c = PEST_CROPS.find(x => x.id === id); return c ? c[lang()] : id; };
const pestName = id => { const p = BY_ID[id]; return p ? p[lang()] : id; };
const clsName = c => (CLASSES[c]?.healthy ? T("leaf_ph_healthy") : (CLASSES[c]?.[lang()] || CLASSES[c]?.en || c));
const stText = s => T("leaf_st_" + s);
const guideOf = id => {
  const p = BY_ID[id]; if (!p) return null;
  const l = lang();
  return { id, name: p[l], sci: p.sci, kind: T(p.kind === "pest" ? "leaf_kind_pest" : "leaf_kind_disease"), signs: p.signs[l], prevent: p.prevent[l],
    similar: D.lookAlikes(PESTS, id).map(x => ({ id: x, name: BY_ID[x][l], signs: BY_ID[x].signs[l] })) };
};
const supported = () => !!PHOTO[CROP];
const saveData = () => { try { return !!navigator.connection?.saveData; } catch { return false; } };

// ---- the three looks ------------------------------------------------------------------------------------------------------
function signMatches() { return D.rank(PESTS, CROP, [...PICKED]); }

function photoModel() {
  const out = { src: PREVIEW, bad: PHOTOBAD, has: !!PX, supported: supported(), crop: cropName(CROP), state: PH.state, first: !engineCached, saveData: saveData() };
  out.quality = PX && PQ ? PQ.issues.map(id => ({ id, text: T("leaf_q_" + id) })) : [];
  if (!out.has || !out.supported) return out;
  const cfg = PHOTO[CROP], key = cfg.model;
  out.mb = digits(Math.round((ENGINE.bytes + MODELS[key].bytes) / 1e6));
  if (PH.state === "busy") {
    out.loading = ENG.total > 0 && ENG.loaded < ENG.total;
    out.done = digits((Math.min(ENG.loaded, ENG.total) / 1e6).toFixed(1)); out.total = digits((ENG.total / 1e6).toFixed(1));
    out.frac = ENG.total ? Math.min(1, ENG.loaded / ENG.total) : 0;
  }
  if (PH.state === "err") out.err = T("leaf_ph_err_" + PH.err);
  if (PH.state === "done" && PH.res) {
    const r = PH.res, f = FACTS[CROP];
    const items = r.items.map(x => ({ cls: x.cls, name: clsName(x.cls), pct: pct(x.p), healthy: !!CLASSES[x.cls]?.healthy, guide: guideOf(CLASSES[x.cls]?.pest) }));
    let line;
    if (r.mode === "gate") line = r.status === "sure" ? T("leaf_ph_sure", { gate: pct(GATE) }) : T("leaf_ph_unsure");
    else if (r.mode === "hint") line = T("leaf_ph_hint", { top1: digits(f.top1) });
    else line = r.status === "sure" ? T("leaf_ph_single_sure", { gate: pct(GATE) }) : T("leaf_ph_single_unsure");
    if (r.capped) line += " " + T("leaf_q_cap");
    const nums = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, digits(v)]));
    out.res = { status: r.status, mode: r.mode, line, items, score: pct(r.p),
      facts: T("leaf_ph_facts_" + CROP, nums), stamp: T("leaf_ph_stamp", { ms: digits(PH.ms), when: fmtPlaceDateTime(PH.at) }) };
  }
  return out;
}

function keyModel() {
  return { show: AIS.known && AIS.byok, has: !!KEY.value, masked: D.maskKey(KEY.value), remember: KEY.remember, bad: KEY.bad, note: KEY_NOTE,
    shared: AIS.enabled, sharedN: digits(AIS.per_hour), n: digits(AIS.byok_per_hour) };
}

function aiModel() {
  const has = !!KEY.value, usable = has || AIS.enabled;
  const out = { show: AIS.known && AIS.byok && !!PX && !!CROP, usable, state: AI.state,
    note: has ? T("leaf_ai_note_own", { n: digits(AIS.byok_per_hour) }) : T("leaf_ai_note", { n: digits(AIS.per_hour) }) };
  if (AI.state === "err") out.err = T((AI.err.startsWith("limit_") ? "leaf_ai_" : "leaf_ai_err_") + AI.err);
  if (AI.state === "done" && AI.res) {
    const r = AI.res;
    out.res = {
      matches: r.matches.map(m => ({ id: m.id, name: pestName(m.id), conf: T("leaf_ai_conf_" + m.conf), confKey: m.conf, why: m.why, guide: guideOf(m.id) })),
      healthy: r.healthy, none: !r.matches.length && !r.healthy, issue: r.issue ? T("leaf_issue_" + r.issue) : "", other: r.other,
      stamp: T("leaf_ai_stamp", { model: r.model || "?", when: fmtPlaceDateTime(AI.at) }),
    };
  }
  return out;
}

function logModel() {
  const t = D.logTable(LOG, { tz: placeTz(), name: pestName, cls: clsName, crop: cropName, lv: x => T("leaf_lv_" + x), st: stText, cf: x => T("leaf_ai_conf_" + x), T });
  return { cols: t.cols, rows: t.rows, n: LOG.rows.length, note: T("leaf_log_note", { n: digits(LOG.rows.length), max: digits(D.LOG_MAX) }) };
}

export function leafModel() {
  const matches = signMatches();
  const rows = matches.map(m => ({
    id: m.id, name: pestName(m.id), sci: m.pest.sci, kind: m.pest.kind, level: m.level, levelText: T("leaf_lv_" + m.level),
    hit: T("leaf_m_hit", { n: digits(m.seen), m: digits(m.of) }), guide: guideOf(m.id),
  }));
  const n = PICKED.size;
  return {
    T, crop: CROP, crops: PEST_CROPS.map(c => ({ id: c.id, name: c[lang()] })),
    groups: D.SYMPTOMS.map(g => ({ g: g.g, label: T("leaf_g_" + g.g), items: g.items.map(id => ({ id, label: T("leaf_sy_" + id), on: PICKED.has(id) })) })),
    n, matches: rows, matchNote: !CROP ? "" : n === 0 ? "need" : n === 1 ? "one" : rows.length ? "" : "none",
    photo: photoModel(), ai: aiModel(), key: keyModel(),
    others: D.otherCauses([...PICKED]).map(id => ({ id, title: T("leaf_oc_" + id + "_t"), text: T("leaf_oc_" + id + "_d") })),
    canSave: !!CROP && (n > 0 || PH.state === "done" || AI.state === "done"), saved: SAVED, clearArmed: CLEAR_ARMED,
    log: logModel(), on,
  };
}

// ---- rendering -------------------------------------------------------------------------------------------------------------
function render() {
  if (!document.getElementById("leafCard")) return;
  VIEW ||= mountLeafView();
  preserveView(() => VIEW(leafModel()));
}
let progressTimer = 0;
function renderSoon() { if (progressTimer) return; progressTimer = setTimeout(() => { progressTimer = 0; render(); }, 120); }

// ---- photo -----------------------------------------------------------------------------------------------------------------------
async function decode(file) {
  if (typeof createImageBitmap === "function") { try { return await createImageBitmap(file); } catch { /* fall back to <img> */ } }
  const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
  return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("image")); i.src = url; });
}

/** Decode, shrink to at most 1024 px on the long side (the AI request stays small; the photo model needs 224 px anyway) and keep the RGBA pixels. */
async function takePhoto(file) {
  if (!file) return;
  const seq = ++PHOTO_SEQ;
  PHOTOBAD = false;
  try {
    if (file.size > MAX_FILE) throw new Error("big");
    const img = await decode(file);
    const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    if (!sw || !sh) throw new Error("empty");
    const s = Math.min(1, MAX_SIDE / Math.max(sw, sh)), w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.imageSmoothingQuality = "high"; cx.drawImage(img, 0, 0, w, h);
    img.close?.();
    const data = cx.getImageData(0, 0, w, h).data, url = cv.toDataURL("image/jpeg", 0.85);
    if (seq !== PHOTO_SEQ) return;
    PX = { data, w, h }; PREVIEW = url; SAVED = "";
    try { PQ = D.assessPhoto(data, w, h); } catch { PQ = null; }
    clearPhotoResults();
  } catch { if (seq === PHOTO_SEQ) { PHOTOBAD = true; } }
  render();
  if (PX && !PHOTOBAD) autoCheck();
}

function clearPhotoResults() { PH_SEQ++; AI_SEQ++; AI_CTL?.abort(); AI_CTL = null; PH = { state: "idle" }; AI = { state: "idle" }; }
function removePhoto() { PHOTO_SEQ++; PX = null; PQ = null; PREVIEW = ""; PHOTOBAD = false; SAVED = ""; clearPhotoResults(); render(); }

// ---- photo model (on this phone) ----------------------------------------------------------------------------------------------
function errKind(e) {
  const m = String(e?.message || e);
  if (/no wasm|WebAssembly|CompileError/i.test(m)) return "wasm";
  if (/hash|size/i.test(m)) return "bad";
  if (/http|fetch|network|import|Load failed/i.test(m)) return "dl";
  return "run";
}
function autoCheck() { if (PX && supported() && engineCached && !saveData() && PH.state === "idle") checkPhoto(); }

async function checkPhoto() {
  const cfg = PHOTO[CROP];
  if (!PX || !cfg || PH.state === "busy") return;
  const mine = ++PH_SEQ, px = PX, crop = CROP, key = cfg.model;
  ENG = { loaded: 0, total: (engineReady() ? 0 : ENGINE.bytes) + (modelReady(key) ? 0 : MODELS[key].bytes) };
  PH = { state: "busy" }; SAVED = ""; render();
  try {
    await loadModel(key, n => { ENG.loaded += n; renderSoon(); });
    if (!engineCached) { engineCached = true; writeLocal(ENGINE_FLAG, 1); }
    const t0 = performance.now();
    const probs = await classify(key, px.data, px.w, px.h);
    if (mine !== PH_SEQ) return;
    const res = D.capByQuality(D.readout(crop, probs), PQ?.issues);
    if (!res) throw new Error("outputs");
    PH = { state: "done", res, ms: Math.max(1, Math.round(performance.now() - t0)), at: Date.now() };
  } catch (e) {
    if (mine !== PH_SEQ) return;
    PH = { state: "err", err: errKind(e) };
  }
  render();
}

// ---- AI second look (optional, through the server) -----------------------------------------------------------------------------
let statusAsked = false;
export async function ensureLeaf() {
  if (statusAsked) return;
  statusAsked = true;
  try {
    const r = await fetch("/api/v1/leaf/status", { cache: "no-store" });
    const j = r.ok ? await r.json() : null;
    AIS = { enabled: !!j?.enabled, byok: j ? (j.byok ?? !!j.enabled) === true : false, per_hour: Number(j?.per_hour) || 0, byok_per_hour: Number(j?.byok_per_hour) || 0, known: true };
  } catch { statusAsked = false; }
  render();
}

async function askAI() {
  if (!PX || !CROP || AI.state === "busy" || !AIS.byok || !(KEY.value || AIS.enabled)) return;
  const mine = ++AI_SEQ, crop = CROP, ctl = new AbortController(); AI_CTL = ctl;
  AI = { state: "busy" }; SAVED = ""; if (KEY_NOTE !== "format") KEY_NOTE = ""; render();
  const timer = setTimeout(() => ctl.abort(), 60000);
  const headers = { "content-type": "application/json" };
  if (KEY.value) headers["x-user-api-key"] = KEY.value;                           // only in this header: never in the URL, the body, the log or the console
  try {
    const r = await fetch("/api/v1/leaf", { method: "POST", headers, signal: ctl.signal,
      body: JSON.stringify({ image: PREVIEW, crop, lang: isJapanese() ? "ja" : state.lang === "my" ? "my" : "en" }) });
    if (mine !== AI_SEQ) return;
    if (r.status === 401) {
      const j = await r.json().catch(() => ({}));
      if (j.detail === "bad_key" && KEY.value) { KEY.bad = true; AI = { state: "err", err: "bad_key" }; }
      else AI = { state: "err", err: "need_key" };
    }
    else if (r.status === 429) { const j = await r.json().catch(() => ({})); AI = { state: "err", err: "limit_" + (j.scope === "day" ? "day" : "visitor") }; }
    else if (r.status === 503) { const j = await r.json().catch(() => ({})); AI = { state: "err", err: j.detail === "off" ? "off" : "busy" }; }
    else if (r.status === 413 || r.status === 422 || r.status === 415) AI = { state: "err", err: "photo" };
    else if (!r.ok) AI = { state: "err", err: "net" };
    else {
      const res = D.cleanAI(await r.json(), PESTS, crop);
      AI = res ? { state: "done", res, at: Date.now() } : { state: "err", err: "net" };
    }
  } catch { if (mine === AI_SEQ) AI = { state: "err", err: "net" }; }
  finally { clearTimeout(timer); if (AI_CTL === ctl) AI_CTL = null; }
  if (mine === AI_SEQ) render();
}

// ---- the visitor's own key: the separate card in the Lab ----------------------------------------------------------------------------
function saveKey(raw) {
  const v = D.cleanKey(raw);
  if (!D.isKey(v)) { KEY_NOTE = "format"; render(); return false; }
  KEY = { value: v, remember: KEY.remember, bad: false };
  persistKey(); KEY_NOTE = "ok";
  if (AI.state === "err" && (AI.err === "need_key" || AI.err === "bad_key")) AI = { state: "idle" };
  render();
  return true;
}
function removeKey() {
  KEY = { value: "", remember: false, bad: false };
  persistKey(); KEY_NOTE = "removed";
  if (AI.state === "err" && AI.err === "bad_key") AI = { state: "idle" };
  render();
}
function rememberKey(yes) { KEY.remember = !!yes; if (KEY.value) persistKey(); render(); }

// ---- save, log, CSV ---------------------------------------------------------------------------------------------------------------
const placeLabel = () => { const l = state.location || LOC || {}; return String(state.lang === "my" ? l.name || l.name_en || "" : l.name_en || l.name || ""); };
function saveCheck() {
  if (!CROP) return;
  const top = signMatches()[0];
  const row = D.makeRow({ now: Date.now(), place: placeLabel(), lat: LOC?.lat, lon: LOC?.lon, crop: CROP, picked: [...PICKED],
    top: top?.id || "", level: top?.level || "", photo: PH.state === "done" ? PH.res : null, ai: AI.state === "done" ? AI.res : null, hadPhoto: !!PX });
  const next = D.addRow(LOG, row);
  if (writeLog(next)) { LOG = next; SAVED = "ok"; } else SAVED = "fail";
  render();
}
function downloadCSV() {
  const t = D.logTable(LOG, { tz: placeTz(), name: id => id, cls: c => c, crop: id => id, lv: x => x, st: x => x, cf: x => x, csv: true });
  const blob = new Blob([D.toCSV(t)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"), d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `leaf-checks-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.csv`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function clearLog() {
  if (!LOG.rows.length) return;
  if (!CLEAR_ARMED) { CLEAR_ARMED = true; clearTimeout(CLEAR_TIMER); CLEAR_TIMER = setTimeout(() => { CLEAR_ARMED = false; render(); }, 6000); render(); return; }
  CLEAR_ARMED = false; clearTimeout(CLEAR_TIMER);
  const next = D.emptyLog();
  if (writeLog(next)) { LOG = next; SAVED = ""; } else SAVED = "fail";
  render();
}

// ---- what the screen can do ---------------------------------------------------------------------------------------------------------
const on = {
  crop(id) { CROP = PEST_CROPS.some(c => c.id === id) ? id : ""; writeLocal(CROP_KEY, CROP); SAVED = ""; if (PX) { clearPhotoResults(); } render(); if (PX) autoCheck(); },
  sign(id) { if (!D.SYMPTOM_IDS.includes(id)) return; if (PICKED.has(id)) PICKED.delete(id); else PICKED.add(id); SAVED = ""; render(); },
  photo: takePhoto, remove: removePhoto, check: checkPhoto, ask: askAI, save: saveCheck, csv: downloadCSV, clear: clearLog,
  keySave: saveKey, keyRemove: removeKey, keyRemember: rememberKey,
  keyGo() { const el = document.getElementById("leafKeyIn"); if (el) { el.scrollIntoView({ block: "center" }); el.focus(); } },
  reset() { PICKED = new Set(); removePhoto(); SAVED = ""; },
};

// ---- hooks used by the rest of the app -----------------------------------------------------------------------------------------------
window.loadLab = function (loc) {
  if (loc && isFinite(loc.lat) && isFinite(loc.lon)) LOC = loc;
  ensureLeaf();
  render();
};
window.addEventListener("mw-place", e => { LOC = e.detail; });
window.addEventListener("mw-lang", () => { if (VIEW) render(); });
