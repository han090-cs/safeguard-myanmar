// Rules of the leaf check (leaf_data.js / leaf_models.js): sign ranking, what the photo model's numbers may be called, the AI answer check,
// the log and its CSV. Run: node tests/leaf_data.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as D from "../leaf_data.js";
import { GATE, MODELS, PHOTO, CLASSES, FACTS, ENGINE } from "../leaf_models.js";
import { PESTS } from "../pests.js";

const json = n => JSON.parse(readFileSync(new URL(`../i18n/${n}.json`, import.meta.url), "utf8"));

// ---- the tables agree with each other ----
assert.equal(PESTS.length, 61);
for (const p of PESTS) assert.ok(D.TAGS[p.id]?.length, `no signs for ${p.id}`);
for (const [id, tags] of Object.entries(D.TAGS)) {
  assert.ok(PESTS.some(p => p.id === id), `signs for unknown problem ${id}`);
  for (const t of tags) assert.ok(D.SYMPTOM_IDS.includes(t.s), `${id}: unknown sign ${t.s}`);
  assert.ok(tags.some(t => t.w === 2), `${id}: needs one typical sign`);
}
for (const [cls, c] of Object.entries(CLASSES)) { if (c.pest) assert.ok(PESTS.some(p => p.id === c.pest), `${cls} -> ${c.pest}`); }
for (const cfg of Object.values(PHOTO)) { for (const k of [...(cfg.only || []), cfg.target].filter(Boolean)) assert.ok(MODELS[cfg.model].classes.includes(k), k); }
for (const m of Object.values(MODELS)) for (const c of m.classes) if (Object.values(PHOTO).some(f => f.model && MODELS[f.model] === m && (f.only || []).includes(c))) assert.ok(CLASSES[c], `no name for ${c}`);
for (const c of MODELS.rice.classes) assert.ok(CLASSES[c], `rice class ${c} has no name`);
assert.equal(ENGINE.parts, 4); assert.equal(ENGINE.bytes, 4 * 2811508);
assert.equal(GATE, 0.7);
assert.deepEqual(Object.keys(PHOTO).sort(), Object.keys(FACTS).sort());

// ---- every text the screen asks for exists in all four languages ----
const need = ["tabLab", "leaf_title", "leaf_sub", "leaf_foot", "leaf_s1", "leaf_s2", "leaf_s3", ...D.SYMPTOM_IDS.map(s => "leaf_sy_" + s), ...D.SYMPTOMS.map(g => "leaf_g_" + g.g),
  ...["strong", "possible", "weak"].map(l => "leaf_lv_" + l), ...["low", "medium", "high"].map(c => "leaf_ai_conf_" + c), ...D.ISSUES.map(i => "leaf_issue_" + i),
  ...["sure", "unsure", "hint", "healthy"].map(s => "leaf_st_" + s), ...Object.keys(FACTS).map(c => "leaf_ph_facts_" + c), ...["wasm", "dl", "bad", "run"].map(e => "leaf_ph_err_" + e),
  ...["busy", "off", "net", "photo"].map(e => "leaf_ai_err_" + e), "leaf_ai_limit_visitor", "leaf_ai_limit_day"];
for (const lang of ["my", "en", "ja", "ja_easy"]) { const t = json(lang); for (const k of need) assert.ok(t[k] && String(t[k]).trim(), `${lang}: missing ${k}`); }

// ---- rank ----
{
  assert.deepEqual(D.rank(PESTS, "rice", []), []);
  assert.deepEqual(D.rank(PESTS, "", ["spots"]), []);
  assert.deepEqual(D.rank(PESTS, "rice", ["not-a-sign"]), []);
  const one = D.rank(PESTS, "rice", ["spots"]);
  assert.ok(one.length && one.every(r => r.level === "weak"), "one sign alone is never better than weak");
  const two = D.rank(PESTS, "rice", ["spots", "dry"]);
  assert.equal(two[0].id, "rice_blast"); assert.equal(two[0].level, "strong");
  assert.ok(two.every(r => PESTS.find(p => p.id === r.id).crop === "rice"), "only the crop's own problems");
  const cu = D.rank(PESTS, "cucurbit", ["powder", "yellow"]);
  assert.equal(cu[0].id, "cucurbit_powdery_mildew");
  assert.deepEqual(D.rank(PESTS, "rice", ["spots", "dry"]).map(r => r.id), D.rank(PESTS, "rice", ["dry", "spots"]).map(r => r.id), "order of ticking does not matter");
}

// ---- readout ----
const onehot = (n, i, p) => Array.from({ length: n }, (_, k) => (k === i ? p : (1 - p) / (n - 1)));
{
  const rice = MODELS.rice.classes, bi = rice.indexOf("Blast");
  let r = D.readout("rice", onehot(14, bi, 0.9));
  assert.equal(r.status, "sure"); assert.equal(r.top, "Blast"); assert.equal(r.items.length, 3);
  r = D.readout("rice", onehot(14, bi, 0.69));
  assert.equal(r.status, "unsure", "just below the gate is not sure"); assert.equal(r.items.length, 3, "still shows the top three as possibilities");
  r = D.readout("rice", onehot(14, bi, 0.7));
  assert.equal(r.status, "sure", "the gate itself counts");
  assert.equal(D.readout("rice", onehot(13, 0, 0.9)), null, "wrong output size");
  assert.equal(D.readout("rice", onehot(14, 0, 0.9).map((v, i) => (i === 3 ? NaN : v))), null, "NaN is refused");
  assert.equal(D.readout("rice", "x"), null); assert.equal(D.readout("tomato", onehot(38, 0, 0.9)), null, "no photo model for tomato");

  const pv = MODELS.pv.classes, lb = pv.indexOf("Potato___Late_blight");
  r = D.readout("potato", onehot(38, lb, 0.99));
  assert.equal(r.status, "hint", "potato is never 'sure'"); assert.equal(r.items.length, 3);
  assert.ok(Math.abs(r.items.reduce((a, x) => a + x.p, 0) - 1) < 1e-9, "re-weighted among the three potato classes");
  assert.ok(r.items.every(x => x.cls.startsWith("Potato___")));
  const tomato = onehot(38, pv.indexOf("Tomato___Late_blight"), 0.95);          // the potato crop must not be answered with another crop's class
  assert.ok(D.readout("potato", tomato).items.every(x => x.cls.startsWith("Potato___")));

  const sq = pv.indexOf("Squash___Powdery_mildew");
  r = D.readout("cucurbit", onehot(38, sq, 0.8));
  assert.equal(r.status, "sure"); assert.deepEqual(r.items.map(x => x.cls), ["Squash___Powdery_mildew"]);
  r = D.readout("cucurbit", onehot(38, sq, 0.5));
  assert.equal(r.status, "unsure"); assert.deepEqual(r.items, [], "no possibilities and never 'healthy' for cucurbit");
}

// ---- agree ----
{
  const sure = { status: "sure", items: [{ cls: "Blast", p: 0.9 }] };
  assert.equal(D.agree("rice_blast", sure), true);
  assert.equal(D.agree("tungro", sure), false);
  assert.equal(D.agree("rice_blast", { status: "unsure", items: [{ cls: "Blast", p: 0.5 }] }), false, "an unsure photo never agrees");
  assert.equal(D.agree("rice_blast", { status: "sure", items: [{ cls: "Healthy", p: 0.9 }] }), false);
  assert.equal(D.agree("", sure), false); assert.equal(D.agree("rice_blast", null), false);
  assert.equal(D.agreeAI("rice_blast", { matches: [{ id: "rice_blast" }] }), true);
  assert.equal(D.agreeAI("rice_blast", { matches: [{ id: "tungro" }, { id: "rice_blast" }] }), false, "only the AI's first answer counts");
  assert.equal(D.agreeAI("rice_blast", null), false);
}

// ---- the AI answer is checked again here ----
{
  const evil = { matches: [{ id: "rice_blast", confidence: "high", why: "<img src=x onerror=alert(1)>" }, { id: "potato_late_blight", confidence: "high" }, { id: "rice_blast", confidence: "low" },
    { id: "tungro", confidence: "sure!" }, null, "x", { id: "stem_borer" }, { id: "bacterial_blight" }], healthy: true, issue: "weird", other: "o".repeat(500), model: "m".repeat(200), generated: "2026-11-17T12:00:00Z" };
  const c = D.cleanAI(evil, PESTS, "rice");
  assert.deepEqual(c.matches.map(m => m.id), ["rice_blast", "tungro", "stem_borer"]);
  assert.equal(c.matches[1].conf, "low"); assert.equal(c.matches[0].pest.id, "rice_blast");
  assert.equal(c.healthy, false, "matches and healthy do not go together"); assert.equal(c.issue, "");
  assert.equal(c.other.length, 160); assert.equal(c.model.length, 60);
  assert.equal(D.cleanAI(null, PESTS, "rice"), null); assert.equal(D.cleanAI("x", PESTS, "rice"), null);
  assert.deepEqual(D.cleanAI({ healthy: true, issue: "blurry" }, PESTS, "rice").matches, []);
  assert.equal(D.cleanAI({ matches: "no" }, PESTS, "rice").matches.length, 0);
}

// ---- time ----
assert.equal(D.isoLocal("2026-11-17T12:40:00Z", "Asia/Yangon"), "2026-11-17 19:10");
assert.equal(D.isoLocal("2026-11-17T20:00:00Z", "Asia/Tokyo"), "2026-11-18 05:00");
assert.equal(D.isoLocal("2026-11-17T12:40:00Z", "Not/AZone"), "2026-11-17 12:40", "an unknown zone falls back to UTC");
assert.equal(D.isoLocal("nonsense"), "");

// ---- log and CSV ----
{
  const now = Date.UTC(2026, 10, 17, 12, 40);
  const photo = D.readout("rice", onehot(14, MODELS.rice.classes.indexOf("Blast"), 0.8));
  const ai = D.cleanAI({ matches: [{ id: "rice_blast", confidence: "high", why: "diamond spots" }], model: "claude-x", generated: "2026-11-17T12:41:00Z" }, PESTS, "rice");
  const row = D.makeRow({ now, place: "Yangon", lat: 16.8412, lon: 96.1735, crop: "rice", picked: ["spots", "dry", "bogus"], top: "rice_blast", level: "strong", photo, ai, hadPhoto: true });
  assert.deepEqual(row, { at: "2026-11-17T12:40:00.000Z", place: "Yangon", p: "16.84,96.17", crop: "rice", sy: ["spots", "dry"], top: "rice_blast", lv: "strong", ph: "Blast", ps: 80, pt: "sure", ai: "rice_blast", ac: "high", photo: 1 });
  const bare = D.makeRow({ now, crop: "rice", picked: [], hadPhoto: false });
  assert.equal(bare.top, ""); assert.equal(bare.lv, ""); assert.equal(bare.ph, ""); assert.equal(bare.ai, ""); assert.equal(bare.p, ""); assert.equal(bare.photo, 0);
  assert.equal(D.makeRow({ now, crop: "rice", picked: [], ai: D.cleanAI({ healthy: true }, PESTS, "rice") }).ai, "healthy");

  let log = D.emptyLog();
  for (let i = 0; i < D.LOG_MAX + 5; i++) log = D.addRow(log, { ...bare, at: new Date(now + i * 1000).toISOString() });
  assert.equal(log.rows.length, D.LOG_MAX, "the log keeps the latest rows"); assert.equal(log.rows.at(-1).at, new Date(now + (D.LOG_MAX + 4) * 1000).toISOString());

  log = D.addRow(D.addRow(D.emptyLog(), bare), row);
  const t = D.logTable(log, { csv: true });
  assert.equal(t.rows[0].at, "2026-11-17 19:10", "newest first, on the place's clock"); assert.equal(t.rows[0].agree, "yes"); assert.equal(t.rows[0].aiagree, "yes"); assert.equal(t.rows[1].agree, "");
  const csv = D.toCSV(t);
  assert.ok(csv.startsWith("﻿checked_local,checked_utc,place,crop,signs_ticked,signs_count,top_match,"));
  assert.ok(csv.includes("2026-11-17 19:10,2026-11-17T12:40:00.000Z,Yangon,rice,spots dry,2,rice_blast,strong,Blast,0.80,sure,yes,rice_blast,high,yes,yes\r\n"));
  assert.ok(csv.endsWith("\r\n") && !/\P{ASCII}/u.test(csv.slice(1)) , "ASCII digits and ISO dates in the file");
  const human = D.logTable(log, { name: id => `N(${id})`, cls: c => `C(${c})`, crop: c => `K(${c})`, lv: l => `L(${l})`, st: s => `S(${s})`, cf: c => `F(${c})`, T: k => `T(${k})` });
  assert.equal(human.cols.length, 9); assert.equal(human.cols[0].h, "T(leaf_c_when)");
  assert.deepEqual([human.rows[0].top, human.rows[0].level, human.rows[0].ph, human.rows[0].ai, human.rows[0].ac], ["N(rice_blast)", "L(strong)", "C(Blast)", "N(rice_blast)", "F(high)"]);
  // an unsure photo is shown as "not sure", not as an answer; disagreement is recorded
  const unsure = D.makeRow({ now, crop: "rice", picked: ["spots", "dry"], top: "rice_blast", level: "strong", photo: D.readout("rice", onehot(14, 3, 0.4)), ai: D.cleanAI({ matches: [{ id: "tungro", confidence: "low" }] }, PESTS, "rice") });
  const u = D.logTable(D.addRow(D.emptyLog(), unsure), { st: s => `S(${s})`, csv: false }).rows[0];
  assert.equal(u.ph, "S(unsure)"); const uc = D.logTable(D.addRow(D.emptyLog(), unsure), { csv: true }).rows[0];
  assert.equal(uc.agree, ""); assert.equal(uc.aiagree, "no");

  // formulas are neutralised, quotes doubled, commas and newlines quoted
  const nasty = D.toCSV({ cols: [{ id: "a", h: "a" }, { id: "b", h: "b" }], rows: [{ a: "=HYPERLINK(\"x\")", b: "line1\nline2, \"q\"" }, { a: "-1+2", b: "+cmd" }, { a: "@SUM(1)", b: "ok" }] });
  assert.equal(nasty, "﻿a,b\r\n\"'=HYPERLINK(\"\"x\"\")\",\"line1\nline2, \"\"q\"\"\"\r\n'-1+2,'+cmd\r\n'@SUM(1),ok\r\n");
}

// ---- v9.20.0: photo quality, look-alike problems, causes that are not a disease, health texts ----
{
  const W = 240, H = 180;
  let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const make = fn => { const px = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = fn(x, y), i = (y * W + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; } return px; };
  const leaf = make((x, y) => { const spot = ((x * 7 + y * 13) % 29) < 4 ? 1 : 0, n = (rnd() - 0.5) * 14; return spot ? [130 + n, 90, 40] : [70 + n, 140 + n, 55]; });
  const blurred = (px, r) => { const o = new Uint8ClampedArray(px.length); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) { let t = 0, n = 0; for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < H && xx >= 0 && xx < W) { t += px[(yy * W + xx) * 4 + c]; n++; } } o[(y * W + x) * 4 + c] = t / n; } return o; };
  const scaled = (px, f) => { const o = new Uint8ClampedArray(px); for (let i = 0; i < o.length; i += 4) { o[i] *= f; o[i + 1] *= f; o[i + 2] *= f; } return o; };
  const flat = (r, g, b) => make(() => [r, g, b]);
  const ok = D.assessPhoto(leaf, W, H);
  assert.deepEqual(ok.issues, [], "a sharp, evenly lit leaf photo raises nothing: " + JSON.stringify(ok));
  assert.deepEqual(D.assessPhoto(scaled(leaf, 0.15), W, H).issues, ["dark"]);
  assert.deepEqual(D.assessPhoto(flat(245, 245, 240), W, H).issues, ["bright"], "white paper in strong light");
  assert.deepEqual(D.assessPhoto(flat(110, 160, 230), W, H).issues, ["far"], "blue sky: no leaf colour, one message only");
  assert.deepEqual(D.assessPhoto(flat(140, 140, 145), W, H).issues, ["far"]);
  assert.deepEqual(D.assessPhoto(blurred(leaf, 40), W, H).issues, ["blurry"], "a very blurry leaf is flagged");
  assert.equal(D.assessPhoto(null, W, H), null); assert.equal(D.assessPhoto(new Uint8ClampedArray(8), W, H), null); assert.equal(D.assessPhoto(leaf, 1, 1), null);
  // brown and yellow leaf colour counts as leaf: a dying leaf is still a leaf
  assert.ok(!D.assessPhoto(make(() => [190, 150, 60]), W, H).issues.includes("far"));

  // a bad photo never gets "fairly sure"; "hint" and "unsure" are left alone; blur only warns
  const sure = D.readout("rice", (() => { const p = new Array(14).fill(0.01); p[3] = 1 - 0.01 * 13; return p; })());
  assert.equal(sure.status, "sure");
  for (const bad of ["dark", "bright", "far"]) { const c = D.capByQuality(sure, [bad]); assert.equal(c.status, "unsure"); assert.equal(c.capped, true); assert.equal(c.items.length, 3); }
  assert.equal(D.capByQuality(sure, ["blurry"]), sure); assert.equal(D.capByQuality(sure, []), sure); assert.equal(D.capByQuality(sure, null), sure);
  const single = { crop: "cucurbit", mode: "single", status: "sure", items: [{ cls: "x", p: 0.9 }], top: "x", p: 0.9 };
  assert.deepEqual(D.capByQuality(single, ["dark"]).items, [], "cucurbit: unsure shows no answer");
  const hint = { crop: "potato", mode: "hint", status: "hint", items: [{ cls: "a", p: 1 }], top: "a", p: 1 };
  assert.equal(D.capByQuality(hint, ["dark"]), hint);
  assert.equal(D.capByQuality(null, ["dark"]), null);
}
{
  const has = (id, other) => D.lookAlikes(PESTS, id).includes(other);
  assert.ok(has("potato_early_blight", "potato_late_blight") && has("potato_late_blight", "potato_early_blight"), "the classic potato pair");
  assert.ok(has("cucurbit_powdery_mildew", "cucurbit_downy_mildew") && has("cucurbit_downy_mildew", "cucurbit_powdery_mildew"), "the classic cucurbit pair");
  assert.ok(has("rice_blast", "sheath_blight"), "rice blast and sheath blight");
  for (const p of PESTS) { const l = D.lookAlikes(PESTS, p.id); assert.ok(l.length <= 3 && !l.includes(p.id), p.id); for (const o of l) assert.equal(PESTS.find(q => q.id === o).crop, p.crop, `${p.id}: look-alike of another crop`); }
  assert.deepEqual(D.lookAlikes(PESTS, "nope"), []);
  assert.deepEqual(D.otherCauses([]), []); assert.deepEqual(D.otherCauses(["not-a-sign"]), []);
  assert.ok(D.otherCauses(["yellow", "stunt"]).includes("nitrogen") && D.otherCauses(["yellow", "stunt"]).length <= 4);
  assert.ok(D.otherCauses(["powder"]).includes("dust"));
  for (const o of D.OTHER) for (const sg of o.s) assert.ok(D.SYMPTOM_IDS.includes(sg), `${o.id}: unknown sign ${sg}`);
  const more = ["leaf_tips_title", ...[1, 2, 3, 4, 5, 6].map(i => "leaf_tip_" + i), "leaf_q_title", "leaf_q_cap", ...["dark", "bright", "far", "blurry"].map(i => "leaf_q_" + i),
    "leaf_m_similar", "leaf_oc_title", "leaf_oc_clue", "leaf_help_title", "leaf_help", ...D.OTHER.flatMap(o => [`leaf_oc_${o.id}_t`, `leaf_oc_${o.id}_d`]),
    "leaf_hs_title", "leaf_hs_intro", "leaf_hs_src", "leaf_src_note", "wx_mosquito_title", "wx_mosquito_text", "wx_floodwater_title", "wx_floodwater_text",
    ...[["spray", 7], ["heat", 4], ["water", 6], ["snake", 5]].flatMap(([g, n]) => [`leaf_hs_${g}_t`, ...Array.from({ length: n }, (_, i) => `leaf_hs_${g}_${i + 1}`)])];
  for (const lang of ["my", "en", "ja", "ja_easy"]) { const t = json(lang); for (const k of more) assert.ok(t[k] && String(t[k]).trim(), `${lang}: missing ${k}`); }
  // the health advice must not name pesticides or give doses (the Lab never does), and must not tell people to induce vomiting or use a tourniquet
  const en = json("en");
  const hs = Object.entries(en).filter(([k]) => k.startsWith("leaf_hs_") || k.startsWith("wx_mosquito") || k.startsWith("wx_floodwater")).map(([, v]) => v).join(" ").toLowerCase();
  assert.ok(!/induce vomiting|make (them|him|her) vomit/.test(hs));
  assert.ok(/do not cut the wound, suck it, tie a tight band/.test(hs), "snakebite 'do not' list is present");
}
// ---- the visitor's own AI key: shape, masking, cleaning
{
  const good = "sk-ant-api03-" + "A".repeat(30) + "wxyz";
  assert.equal(D.isKey(good), true);
  for (const bad of ["", "sk-ant-", "sk-ant-short", "sk-test-" + "a".repeat(30), " " + good, good + " ", "sk-ant-api03-" + "a b".repeat(10), "sk-ant-" + "a".repeat(300), null, undefined, 42, {}])
    assert.equal(D.isKey(bad), false, String(bad).slice(0, 20));
  assert.equal(D.maskKey(good), "sk-ant-…wxyz");
  assert.ok(!D.maskKey(good).includes("api03") && !D.maskKey(good).includes("AAAA"));
  assert.equal(D.maskKey("nope"), "");
  for (const pasted of [good, "  " + good + "\n", `"${good}"`, `'${good}'`, `\u201c${good}\u201d`, "`" + good + "`", `\n\t ${good} \r\n`]) assert.equal(D.cleanKey(pasted), good);
  assert.equal(D.cleanKey(null), "");
  assert.equal(D.isKey(D.cleanKey("sk-ant-api03-has space inside" + "a".repeat(20))), false);
  assert.equal(D.KEY_STORE, "mw_leaf_key_v1");
  assert.notEqual(D.KEY_STORE, D.LOG_KEY);
}

console.log("leaf_data: rules, tables, texts, log and CSV ok");
