const [my, en, SCALES, WEATHER_CODES] = await Promise.all([
  fetch(new URL("./i18n/my.json", import.meta.url)).then(r => r.json()),
  fetch(new URL("./i18n/en.json", import.meta.url)).then(r => r.json()),
  fetch(new URL("./i18n/scales.json", import.meta.url)).then(r => r.json()),
  fetch(new URL("./i18n/weather_codes.json", import.meta.url)).then(r => r.json())
]);

export const I18N = { my, en };
export { SCALES, WEATHER_CODES };
export function t(lang, key, fallback) {
  const v = I18N[lang]?.[key] ?? I18N.en?.[key] ?? I18N.my?.[key];
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
