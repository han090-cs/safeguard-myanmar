// lang_ja: "1" = Japanese, "2" = やさしい日本語 (simple words, rarer kanji in hiragana)
const wantJa = (() => { try { const v = localStorage.getItem("lang_ja"); return localStorage.getItem("lang") === "en" && (v === "1" || v === "2") ? +v : 0; } catch { return 0; } })();
const get = u => fetch(new URL(u, import.meta.url)).then(r => r.json());
const [my, en, SCALES, WEATHER_CODES, ja] = await Promise.all([
  get("./i18n/my.json"), get("./i18n/en.json"), get("./i18n/scales.json"), get("./i18n/weather_codes.json"),
  wantJa ? loadJa(wantJa) : Promise.resolve(null)
]);

// Japanese rides on top of the English slot: the app keeps state.lang = "en" (place names, dates, units) and only the
// texts come from ja.json. Scale and weather-code tables are swapped in place, so no other module needs to know.
let JA = ja, jaOn = false, jaMode = wantJa || 0;
const ORIG = { scales: null, codes: null };
async function loadJa(mode = 1) {
  const sfx = mode === 2 ? "_easy" : "";
  const [ui, scales, codes] = await Promise.all([get(`./i18n/ja${sfx}.json`), get(`./i18n/scales_ja${sfx}.json`), get(`./i18n/weather_codes_ja${sfx}.json`)]);
  return { ui, scales, codes, mode };
}
function swapTables(on) {
  if (!ORIG.scales) { ORIG.scales = JSON.parse(JSON.stringify(SCALES)); ORIG.codes = JSON.parse(JSON.stringify(WEATHER_CODES)); }
  for (const [k, sc] of Object.entries(SCALES)) {
    const o = ORIG.scales[k], j = JA?.scales?.[k];
    sc.titleEn = on && j ? j.title : o.titleEn; sc.noteEn = on && j ? j.note : o.noteEn;
    sc.steps.forEach((st, i) => { st.en = on && j?.steps?.[i] ? j.steps[i].n : o.steps[i].en; st.tipEn = on && j?.steps?.[i] ? j.steps[i].tip : o.steps[i].tipEn; });
  }
  for (const [c, v] of Object.entries(WEATHER_CODES)) v[0] = on && JA?.codes?.[c] ? JA.codes[c] : ORIG.codes[c][0];
}
// on: false | true (Japanese) | "easy" (やさしい日本語)
export async function setJapanese(on) {
  const mode = !on ? 0 : on === "easy" || on === 2 ? 2 : 1;
  if (mode && (!JA || JA.mode !== mode)) JA = await loadJa(mode);
  jaMode = mode; jaOn = !!mode; swapTables(jaOn);
}
export const isJapanese = () => jaOn;
export const japaneseMode = () => (jaOn ? jaMode : 0);
if (wantJa && JA) { jaOn = true; swapTables(true); }

export const I18N = { my, en };
export { SCALES, WEATHER_CODES };
export function t(lang, key, fallback) {
  const v = (jaOn && lang === "en" ? JA?.ui?.[key] : undefined) ?? I18N[lang]?.[key] ?? I18N.en?.[key] ?? I18N.my?.[key];
  if (v !== undefined) return v;
  if (fallback !== undefined) return fallback;
  // Internal hashed ids (s_xxxxxxxxxx) must never reach the screen.
  return /^s_[0-9a-f]{10}$/.test(key) ? "" : key;
}
export function L(key, params = {}) {
  const lang = (typeof window !== "undefined" && window.__mwLang) ? window.__mwLang() : ((typeof localStorage !== "undefined" && localStorage.getItem("lang")) || "my");
  let value = t(lang, key);
  return String(value).replace(/\{(\w+)\}/g, (_, name) => params[name] ?? `{${name}}`);
}
export function translate(lang, key, params = {}) {
  let value = t(lang, key);
  return String(value).replace(/\{(\w+)\}/g, (_, name) => params[name] ?? `{${name}}`);
}
export function htmlText(lang, key, params = {}) {
  return translate(lang, key, params);
}
