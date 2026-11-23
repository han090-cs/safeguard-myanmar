// Leaf check (Lab tab): the pure part. No DOM, no network, no storage, so it can be unit-tested.
// The app already lists 61 crop pests and diseases (pests.js). A leaf photo is not enough to name a disease by itself, so there are three
// independent looks, and the screen shows each one on its own, never merged into one verdict:
//   1. signs: the person picks the crop and ticks what they can see; each listed problem is scored by how well its typical signs match;
//   2. photo: the Lab's models, run on this phone (rice, potato, cucurbit), through readout();
//   3. AI: an optional second look (any crop) that runs on the VISITOR's own Anthropic key, through cleanAI(). The key stays on the device.
// Every score is only a ranking of the app's own list, never a diagnosis.
import { GATE, MODELS, PHOTO, CLASSES } from "./leaf_models.js";

export const LOG_KEY = "mw_leaf_log_v1";
export const LOG_MAX = 300;
export const CONF = ["low", "medium", "high"];
export const ISSUES = ["blurry", "too_far", "dark", "not_plant"];

/** "2026-11-17 19:10": an instant on the clock of a place (ISO date, 24 h, ASCII digits, the same text on every phone). */
export function isoLocal(iso, tz = "Asia/Yangon") {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const o = {};
    for (const p of new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d)) o[p.type] = p.value;
    return `${o.year}-${o.month}-${o.day} ${o.hour}:${o.minute}`;
  } catch { return d.toISOString().slice(0, 16).replace("T", " "); }
}

// Signs a person can see, in three groups (leaf, whole plant, fruit/pods/flowers). Ids are stable: they are stored in the log.
export const SYMPTOMS = [
  { g: "leaf", items: ["spots", "rings", "halo", "yellow", "mosaic", "powder", "rust", "fuzz", "stripes", "wet", "curl", "holes", "tunnels", "dry", "web"] },
  { g: "plant", items: ["wilt", "stunt", "insects", "stem"] },
  { g: "fruit", items: ["fruit"] },
];
export const SYMPTOM_IDS = SYMPTOMS.flatMap(g => g.items);

// Typical signs of each listed problem, written from its "signs" text in pests.js. The first signs are the ones it is known by;
// a leading "~" marks a sign that is only sometimes seen. Weight 2 = typical, 1 = sometimes.
const SRC = {
  rice_blast: "spots,~dry,~stem,~fruit", brown_planthopper: "insects,dry,~yellow", bacterial_blight: "stripes,wet,yellow,~dry",
  tungro: "yellow,stunt,~insects", sheath_blight: "spots,~stem", stem_borer: "stem,dry,~stunt",
  sesame_phyllody: "stunt,fruit,~curl", sesame_charcoal_rot: "wilt,stem,~dry", sesame_fusarium_wilt: "wilt,yellow,stem",
  sesame_webworm: "web,insects,~holes,~fruit",
  coffee_leaf_rust: "rust,yellow,spots,~dry", coffee_berry_borer: "fruit,~holes", coffee_white_stem_borer: "stem,yellow,wilt",
  coffee_brown_eye_spot: "spots,halo,~rings,~fruit",
  potato_late_blight: "wet,spots,fuzz,~fruit", potato_early_blight: "rings,spots", potato_bacterial_wilt: "wilt,stem",
  potato_tuber_moth: "insects,tunnels,~fruit",
  mustard_alternaria: "rings,spots,~fruit", mustard_white_rust: "powder,~fruit,~curl", mustard_diamondback: "holes,insects",
  mustard_aphid: "insects,curl,~stem,~fruit",
  tomato_late_blight: "wet,spots,~stem,~fruit", tomato_bacterial_wilt: "wilt,stem", tomato_fruitworm: "fruit,insects,holes",
  tomato_leaf_curl: "curl,yellow,stunt",
  onion_downy_mildew: "fuzz,spots,~dry", onion_purple_blotch: "rings,spots", onion_thrips: "tunnels,insects",
  chilli_anthracnose: "fruit,spots", chilli_leaf_curl: "curl,stunt", chilli_fruit_borer: "fruit,holes,insects",
  eggplant_shoot_fruit_borer: "wilt,fruit,holes,~stem,~dry", eggplant_bacterial_wilt: "wilt,stem",
  cabbage_black_rot: "stripes,yellow", cabbage_clubroot: "wilt,stunt,~stem", cabbage_white: "holes,insects",
  cucurbit_downy_mildew: "yellow,fuzz,spots", cucurbit_powdery_mildew: "powder,yellow,~dry", cucurbit_fruit_fly: "fruit,~insects",
  groundnut_leaf_spot: "spots,halo,~dry", groundnut_rust: "rust,~dry", groundnut_aflatoxin: "fruit,~fuzz",
  pulses_pod_borer: "web,fruit,insects,~holes", pulses_yellow_mosaic: "mosaic,yellow,stunt", pulses_powdery_mildew: "powder,~stem,~fruit",
  maize_fall_armyworm: "holes,insects,~stem", maize_common_rust: "rust,~spots", maize_leaf_blight: "spots,dry",
  sugarcane_red_rot: "stem,dry", sugarcane_smut: "stem,stunt", sugarcane_shoot_borer: "stem,dry,~insects",
  banana_fusarium_wilt: "yellow,wilt,stem", banana_black_sigatoka: "stripes,spots,dry", banana_bunchy_top: "curl,stunt",
  mango_anthracnose: "spots,fruit,~dry", mango_hopper: "insects,fruit", mango_fruit_fly: "fruit,~insects",
  citrus_canker: "spots,halo,~fruit", citrus_greening: "yellow,mosaic,~stunt,~fruit", citrus_leaf_miner: "tunnels,curl",
};
export const TAGS = Object.fromEntries(Object.entries(SRC).map(([id, s]) => [id, s.split(",").map(x => x.trim()).filter(Boolean).map(x => (x[0] === "~" ? { s: x.slice(1), w: 1 } : { s: x, w: 2 }))]));

/** Rank the listed problems of one crop by how well their typical signs fit the signs that were ticked.
 *  level: "strong" = every typical sign was ticked and nothing ticked is unexplained; "possible" = most fit;
 *  "weak" = some fit. With fewer than two signs ticked nothing is better than "weak": one sign fits too many problems. */
export function rank(pests, crop, picked) {
  const sel = new Set((picked || []).filter(s => SYMPTOM_IDS.includes(s)));
  if (!crop || !sel.size) return [];
  const out = [];
  for (const p of pests) {
    if (p.crop !== crop) continue;
    const tags = TAGS[p.id] || [];
    const hit = tags.filter(t => sel.has(t.s));
    if (!hit.length) continue;
    const typical = tags.filter(t => t.w === 2), seen = typical.filter(t => sel.has(t.s)).length;
    const got = hit.reduce((a, t) => a + t.w, 0), miss = sel.size - hit.length;
    let level = "weak";
    if (sel.size >= 2) level = miss === 0 && seen === typical.length ? "strong" : (seen >= Math.ceil(typical.length / 2) && miss <= 1) ? "possible" : "weak";
    out.push({ id: p.id, pest: p, hit: hit.map(t => t.s), miss, seen, of: typical.length, score: got - 0.5 * miss, level });
  }
  const lv = { strong: 0, possible: 1, weak: 2 };
  out.sort((a, b) => lv[a.level] - lv[b.level] || b.score - a.score || b.seen - a.seen || (a.pest.kind === b.pest.kind ? 0 : a.pest.kind === "disease" ? -1 : 1) || (a.id < b.id ? -1 : 1));
  return out;
}

/** What the photo model said, in the Lab's terms. `probs` = the model's softmax over ALL of its outputs (rice: 14, PlantVillage: 38).
 *  rice ("gate"):    top answer is "sure" only at GATE or above, otherwise "unsure"; the top 3 are possibilities either way.
 *  potato ("hint"):  the model is weak on potato, so it is never "sure": the crop's 3 classes, re-weighted among themselves, as possibilities.
 *  cucurbit ("single"): the model knows one cucurbit disease and has no healthy class: "sure" only for that disease at GATE or above. */
export function readout(crop, probs) {
  const cfg = PHOTO[crop];
  if (!cfg || !Array.isArray(probs)) return null;
  const classes = MODELS[cfg.model].classes;
  if (probs.length !== classes.length || probs.some(v => !Number.isFinite(v))) return null;
  const all = classes.map((cls, i) => ({ cls, p: probs[i] }));
  const byP = (a, b) => b.p - a.p || (a.cls < b.cls ? -1 : 1);
  if (cfg.mode === "gate") {
    const items = [...all].sort(byP).slice(0, 3);
    return { crop, mode: cfg.mode, status: items[0].p >= GATE ? "sure" : "unsure", items, top: items[0].cls, p: items[0].p };
  }
  if (cfg.mode === "hint") {
    const sub = all.filter(x => cfg.only.includes(x.cls)), sum = sub.reduce((a, x) => a + x.p, 0) || 1;
    const items = sub.map(x => ({ cls: x.cls, p: x.p / sum })).sort(byP);
    return { crop, mode: cfg.mode, status: "hint", items, top: items[0].cls, p: items[0].p };
  }
  const t = all.find(x => x.cls === cfg.target);
  const sure = t.p >= GATE;
  return { crop, mode: cfg.mode, status: sure ? "sure" : "unsure", items: sure ? [{ cls: t.cls, p: t.p }] : [], top: t.cls, p: t.p };
}

/** True when the sign-based ranking's first problem and the photo model's answer are the same guide entry. Only asked when the photo gave an answer. */
export function agree(localId, photo) {
  const pest = photo && photo.status !== "unsure" && photo.items.length ? CLASSES[photo.items[0].cls]?.pest : "";
  return !!(localId && pest && localId === pest);
}

const txt = (v, n) => String(v ?? "").replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, n);

/** The server's AI answer, checked again here: only problems of this crop that are in the app's list, at most three, short texts.
 *  (The server already does this; a second check costs nothing and keeps the screen safe if the answer ever changes shape.) */
export function cleanAI(res, pests, crop) {
  if (!res || typeof res !== "object") return null;
  const ok = new Map(pests.filter(p => p.crop === crop).map(p => [p.id, p]));
  const seen = new Set(), matches = [];
  for (const m of Array.isArray(res.matches) ? res.matches : []) {
    if (!m || typeof m !== "object" || !ok.has(m.id) || seen.has(m.id)) continue;
    seen.add(m.id);
    matches.push({ id: m.id, pest: ok.get(m.id), conf: CONF.includes(m.confidence) ? m.confidence : "low", why: txt(m.why, 240) });
    if (matches.length === 3) break;
  }
  return { matches, healthy: res.healthy === true && !matches.length, issue: ISSUES.includes(res.issue) ? res.issue : "", other: txt(res.other, 160), model: txt(res.model, 60), at: txt(res.generated, 25) };
}

// ------------------------------------------------------------------------------------------------ the visitor's own AI key (this device only)

export const KEY_STORE = "mw_leaf_key_v1";
/** The shape of an Anthropic API key. The server checks the same shape and refuses anything else before it calls anyone. */
export const isKey = s => typeof s === "string" && /^sk-ant-[A-Za-z0-9_-]{16,256}$/.test(s);
/** What the screen may show of a key: the start and the last four characters, never more. */
export const maskKey = s => (isKey(s) ? "sk-ant-…" + s.slice(-4) : "");
/** Pasted text cleaned up: spaces, line breaks and quote marks around the key removed. */
export const cleanKey = s => String(s ?? "").trim().replace(/^["'`\u2018\u2019\u201c\u201d]+|["'`\u2018\u2019\u201c\u201d]+$/g, "").trim();

/** True when the sign-based first problem is the AI's first answer. */
export const agreeAI = (localId, ai) => !!(localId && ai?.matches?.length && ai.matches[0].id === localId);

// ------------------------------------------------------------------------------------------------ the log of checks (this device only)

export const emptyLog = () => ({ v: 1, rows: [] });

export function addRow(log, row) {
  const rows = [...(log?.rows || []), row];
  return { v: 1, rows: rows.length > LOG_MAX ? rows.slice(rows.length - LOG_MAX) : rows };
}

/** One saved check. `top`/`level` = the sign-based first problem; `photo` = readout() or null; `ai` = cleanAI() or null. */
export function makeRow({ now, place, lat, lon, crop, picked, top, level, photo, ai, hadPhoto }) {
  const a = ai?.matches?.[0];
  return {
    at: new Date(now).toISOString(), place: place || "", p: Number.isFinite(lat) && Number.isFinite(lon) ? `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}` : "",
    crop: crop || "", sy: (picked || []).filter(s => SYMPTOM_IDS.includes(s)), top: top || "", lv: top ? level || "" : "",
    ph: photo?.top || "", ps: photo ? Math.round(photo.p * 100) : 0, pt: photo?.status || "",
    ai: a ? a.id : ai?.healthy ? "healthy" : "", ac: a ? a.conf : "", photo: hadPhoto ? 1 : 0,
  };
}

/** The log as a table (also the CSV): the newest check first. `name(id)` names a guide entry, `cls(c)` a photo-model output, `crop(id)` a crop,
 *  `lv(level)`, `st(status)` and `cf(confidence)` their labels. Dates are ISO on the clock of the place, digits are ASCII, so the file sorts and parses. */
export function logTable(log, { tz = "Asia/Yangon", name = x => x, cls = x => x, crop = x => x, lv = x => x, st = x => x, cf = x => x, T = k => k, csv = false } = {}) {
  const rows = [...(log?.rows || [])].reverse().map((r, i) => {
    const pest = r.ph ? CLASSES[r.ph]?.pest : "";
    return {
      id: r.at + i, at: isoLocal(r.at, tz) || r.at, utc: r.at, place: r.place || "", crop: crop(r.crop), signs: r.sy.join(" "), n: String(r.sy.length),
      top: r.top ? name(r.top) : "", level: r.top ? lv(r.lv) : "",
      ph: r.ph && r.pt !== "unsure" ? cls(r.ph) : r.ph ? st("unsure") : "", ps: r.ph ? (r.ps / 100).toFixed(2) : "", pst: r.pt ? st(r.pt) : "",
      agree: r.top && pest && r.pt !== "unsure" ? (r.top === pest ? "yes" : "no") : "",
      ai: r.ai === "healthy" ? st("healthy") : r.ai ? name(r.ai) : "", ac: r.ac ? cf(r.ac) : "", aiagree: r.top && r.ai && r.ai !== "healthy" ? (r.top === r.ai ? "yes" : "no") : "",
      photo: r.photo ? "yes" : "no",
    };
  });
  const base = [
    { id: "at", h: T("leaf_c_when") }, { id: "place", h: T("leaf_c_place") }, { id: "crop", h: T("leaf_c_crop") }, { id: "top", h: T("leaf_c_top") }, { id: "level", h: T("leaf_c_level") },
    { id: "ph", h: T("leaf_c_ph") }, { id: "ps", h: T("leaf_c_ps") }, { id: "ai", h: T("leaf_c_ai") }, { id: "ac", h: T("leaf_c_conf") },
  ];
  const file = [
    { id: "at", h: "checked_local" }, { id: "utc", h: "checked_utc" }, { id: "place", h: "place" }, { id: "crop", h: "crop" }, { id: "signs", h: "signs_ticked" }, { id: "n", h: "signs_count" },
    { id: "top", h: "top_match" }, { id: "level", h: "match_strength" }, { id: "ph", h: "photo_answer" }, { id: "ps", h: "photo_score" }, { id: "pst", h: "photo_status" }, { id: "agree", h: "signs_photo_agree" },
    { id: "ai", h: "ai_answer" }, { id: "ac", h: "ai_confidence" }, { id: "aiagree", h: "signs_ai_agree" }, { id: "photo", h: "photo_taken" },
  ];
  return { cols: csv ? file : base, rows };
}

/** A table as CSV text: UTF-8 with a byte-order mark (spreadsheets then read Burmese and Japanese correctly), CRLF lines, quotes doubled,
 *  and a leading apostrophe on anything a spreadsheet could take for a formula. */
export function toCSV({ cols, rows }) {
  const cell = v => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [cols.map(c => cell(c.h)).join(","), ...rows.map(r => cols.map(c => cell(r[c.id])).join(","))].join("\r\n") + "\r\n";
}

// ---- is the photo good enough to read? (a rough check on the phone, before the model looks at it) -----------------------------------
// Thresholds are cautious guesses, checked on made-up pictures only (tests/leaf_data.test.mjs), not on real field photos.
// dark / bright / far also stop the photo model from saying "fairly sure" (capByQuality); blurry only warns, because a smooth,
// sharp leaf close-up can also have few edges.
export const QUAL = { side: 160, dark: 45, bright: 215, blown: 0.3, plant: 0.12, blur: 8 };

function leafColour(r, g, b) {   // yellow-green to green-cyan, and the browns and yellows of a sick leaf: hue 20..170 degrees
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (mx < 31 || d === 0 || d / mx < 0.18) return false;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return h >= 20 && h <= 170;
}

/** px = RGBA bytes, w x h. Returns { issues: ["dark"|"bright"|"far"|"blurry"], mean, blur, plant, blown } or null when the pixels are not usable. */
export function assessPhoto(px, w, h) {
  if (!px || !(w > 2) || !(h > 2) || px.length < w * h * 4) return null;
  const k = Math.max(1, Math.max(w, h) / QUAL.side), tw = Math.max(3, Math.floor(w / k)), th = Math.max(3, Math.floor(h / k));
  const g = new Float32Array(tw * th), leaf = new Uint8Array(tw * th);
  let sum = 0, blown = 0;
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor(ty * h / th), y1 = Math.min(h, Math.max(y0 + 1, Math.floor((ty + 1) * h / th)));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor(tx * w / tw), x1 = Math.min(w, Math.max(x0 + 1, Math.floor((tx + 1) * w / tw)));
      let r = 0, gr = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; r += px[i]; gr += px[i + 1]; b += px[i + 2]; n++; }
      r /= n; gr /= n; b /= n;
      const lum = 0.299 * r + 0.587 * gr + 0.114 * b, j = ty * tw + tx;
      g[j] = lum; sum += lum; if (lum >= 250) blown++;
      leaf[j] = leafColour(r, gr, b) ? 1 : 0;
    }
  }
  const total = tw * th, mean = sum / total, blownShare = blown / total;
  let s1 = 0, s2 = 0, c = 0;
  for (let ty = 1; ty < th - 1; ty++) for (let tx = 1; tx < tw - 1; tx++) {
    const i = ty * tw + tx, l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - tw] - g[i + tw];
    s1 += l; s2 += l * l; c++;
  }
  const blur = c ? s2 / c - (s1 / c) * (s1 / c) : 0;
  let inLeaf = 0, seen = 0;
  for (let ty = Math.floor(th * 0.15); ty < Math.ceil(th * 0.85); ty++) for (let tx = Math.floor(tw * 0.15); tx < Math.ceil(tw * 0.85); tx++) { seen++; inLeaf += leaf[ty * tw + tx]; }
  const plant = seen ? inLeaf / seen : 0;
  const dark = mean < QUAL.dark, bright = mean > QUAL.bright || blownShare > QUAL.blown, issues = [];
  if (dark) issues.push("dark");
  if (bright) issues.push("bright");
  if (!dark && !bright && plant < QUAL.plant) issues.push("far");
  if (!issues.length && blur < QUAL.blur) issues.push("blurry");   // one message at a time: the first fix is the one that matters
  return { issues, mean: Math.round(mean), blur: Math.round(blur * 10) / 10, plant: Math.round(plant * 100) / 100, blown: Math.round(blownShare * 100) / 100 };
}

/** A photo that is too dark, washed out or without leaf colour never gets "fairly sure": the reading is shown as "not sure". */
export function capByQuality(res, issues) {
  if (!res || res.status !== "sure" || !Array.isArray(issues) || !issues.some(i => i === "dark" || i === "bright" || i === "far")) return res;
  return { ...res, status: "unsure", items: res.mode === "single" ? [] : res.items, capped: true };
}

// ---- problems of the same crop that look alike (from the guide's own sign tags), and causes that are not a disease ------------------------
/** Up to three other problems of the same crop that share a typical sign with this one (or two signs of any kind). */
export function lookAlikes(pests, id) {
  const me = pests.find(p => p.id === id);
  if (!me) return [];
  const mine = TAGS[id] || [], mineAll = new Set(mine.map(t => t.s)), mineTyp = new Set(mine.filter(t => t.w === 2).map(t => t.s));
  return pests.filter(p => p.crop === me.crop && p.id !== id).map(p => {
    const t = TAGS[p.id] || [], shared = t.filter(x => mineAll.has(x.s)).length, typ = t.filter(x => x.w === 2 && mineTyp.has(x.s)).length;
    return { id: p.id, shared, typ };
  }).filter(x => x.typ >= 1 || x.shared >= 2).sort((a, b) => b.typ - a.typ || b.shared - a.shared || (a.id < b.id ? -1 : 1)).slice(0, 3).map(x => x.id);
}

// Causes that make leaves look sick without being a disease or a pest. `s` = the signs they can show. Texts: leaf_oc_<id>_t / _d.
export const OTHER = [
  { id: "nitrogen", s: ["yellow", "stunt"] }, { id: "zinc", s: ["yellow", "spots", "stunt"] }, { id: "iron", s: ["spots", "dry"] },
  { id: "potassium", s: ["yellow", "dry", "spots"] }, { id: "water", s: ["wilt", "curl", "dry"] }, { id: "flood", s: ["yellow", "wilt", "stunt"] },
  { id: "heat", s: ["dry", "spots"] }, { id: "chem", s: ["curl", "spots", "yellow"] }, { id: "dust", s: ["powder", "spots"] }, { id: "age", s: ["yellow", "dry"] },
];
/** The non-disease causes that fit the ticked signs, best fit first, at most four. Needs at least one ticked sign. */
export function otherCauses(picked) {
  const sel = new Set((picked || []).filter(s => SYMPTOM_IDS.includes(s)));
  if (!sel.size) return [];
  return OTHER.map(o => ({ id: o.id, n: o.s.filter(s => sel.has(s)).length })).filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1)).slice(0, 4).map(x => x.id);
}
