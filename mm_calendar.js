// Myanmar (Burmese) calendar: Gregorian date -> Myanmar year, month, waxing/waning day. Pure functions, no DOM.
// Algorithm: Yan Naing Aye's Myanmar calendar (https://github.com/yan9a/mmcal, MIT), via the TypeScript port mm-cal-js (MIT).
// Only the modern era (Myanmar Era 1316 and later, i.e. Gregorian 1954 onward) is implemented; earlier years return null.
// Verified in tests/mm_calendar.test.mjs against mm-cal-js and known full-moon days (Thadingyut 2023-2025, Tabaung 2025, Waso 2024).

const SY = 365.2587564814815;   // solar year (days)
const LM = 29.53058794607172;   // lunar month (days)
const MO = 1954168.050623;      // start of Myanmar Era 0 (Myanmar time)
const TA_UNIT = 0.9076417607184055; // SY/12 - LM

/** Julian day number of a Gregorian calendar day (as of noon). */
export function jdnOf(year, month, day) {
  const a = Math.floor((14 - month) / 12), y = year + 4800 - a, m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

// Era 3 constants (ME 1313+; years before 1316 also need their predecessors, so they are rejected). ME 1377 has a +1 day full-moon correction; ME 1344/1345 are watat exceptions.
function watatOf(my) {
  const wo = -0.5 + (my === 1377 ? 1 : 0), nm = 8, exception = (my === 1344 || my === 1345) ? 1 : 0;
  let ed = (SY * (my + 3739)) % LM;
  if (ed < TA_UNIT * (12 - nm)) ed += LM;
  const fullMoon = Math.round(SY * my + MO - ed + 4.5 * LM + wo);
  const watat = (ed >= LM - TA_UNIT * nm ? 1 : 0) ^ exception;
  return { fullMoon, watat };
}

function yearInfo(my) {
  const cur = watatOf(my);
  let yd = 0, prev;
  do { yd++; prev = watatOf(my - yd); } while (prev.watat === 0 && yd < 3);
  let type = 0, fullMoon;
  if (cur.watat) { type = Math.floor(((cur.fullMoon - prev.fullMoon) % 354) / 31) + 1; fullMoon = cur.fullMoon; }
  else fullMoon = prev.fullMoon + 354 * yd;
  return { type, tagu1: prev.fullMoon + 354 * yd - 102, fullMoon }; // type: 0 common, 1 little watat, 2 big watat
}

/** Myanmar date for a Julian day number. month: Tagu 1 ... Tabaung 12, Waso 4 (1st Waso = 0 in a watat year), late Tagu 13, late Kason 14.
 *  monthDay 1-30 counts from the start of the waxing moon: 1-14 waxing, 15 full moon, 16+ waning, last day = new moon. */
export function myanmarFromJdn(jdn) {
  const my = Math.floor((jdn - 0.5 - MO) / SY);
  if (my < 1316) return null; // earlier years need the older-era constants
  const yo = yearInfo(my);
  let dd = jdn - yo.tagu1 + 1;
  const b = Math.floor(yo.type / 2), c = Math.floor(1 / (yo.type + 1));
  const yearLength = 354 + 30 * (1 - c) + b;
  const monthType = Math.floor((dd - 1) / yearLength); // late Tagu / late Kason belong to the year before
  dd -= monthType * yearLength;
  const m1 = Math.floor((dd + 423) / 512);
  let mm = Math.floor((dd - b * m1 + c * m1 * 30 + 29.26) / 29.544);
  const e = Math.floor((mm + 12) / 16), f = Math.floor((mm + 11) / 16);
  const monthDay = dd - Math.floor(29.544 * mm - 29.26) - b * e + c * f * 30;
  mm += 3 * f - 4 * e + 12 * monthType;
  const monthLength = 30 - (mm % 2) + (mm === 3 ? b : 0);
  return { year: my, yearType: yo.type, month: mm, monthDay, monthLength, jdn };
}

/** Myanmar date for a JS Date, using the device's local calendar day. */
export function myanmarDate(date = new Date()) {
  return myanmarFromJdn(jdnOf(date.getFullYear(), date.getMonth() + 1, date.getDate()));
}

/** Moon day in Myanmar terms: "waxing" (လဆန်း) 1-14, "full" (လပြည့်) 15, "waning" (လဆုတ်) 1-14, "new" (လကွယ်). */
export function moonDay(md) {
  if (!md) return null;
  if (md.monthDay === md.monthLength) return { kind: "new", n: 0 };
  if (md.monthDay === 15) return { kind: "full", n: 15 };
  if (md.monthDay < 15) return { kind: "waxing", n: md.monthDay };
  return { kind: "waning", n: md.monthDay - 15 };
}

export const MONTHS_MY = { 0: "ပဝါဆို", 1: "တန်ခူး", 2: "ကဆုန်", 3: "နယုန်", 4: "ဝါဆို", 5: "ဝါခေါင်", 6: "တော်သလင်း", 7: "သီတင်းကျွတ်", 8: "တန်ဆောင်မုန်း", 9: "နတ်တော်", 10: "ပြာသို", 11: "တပို့တွဲ", 12: "တပေါင်း", 13: "နှောင်းတန်ခူး", 14: "နှောင်းကဆုန်" };
export const MONTHS_EN = { 0: "1st Waso", 1: "Tagu", 2: "Kason", 3: "Nayon", 4: "Waso", 5: "Wagaung", 6: "Tawthalin", 7: "Thadingyut", 8: "Tazaungmon", 9: "Nadaw", 10: "Pyatho", 11: "Tabodwe", 12: "Tabaung", 13: "Late Tagu", 14: "Late Kason" };

/** Month name; a watat (leap) year has two Wasos: month 0 = first, month 4 = second. */
export function monthName(md, lang = "my") {
  const T = lang === "my" ? MONTHS_MY : MONTHS_EN;
  if (md.month === 4 && md.yearType > 0) return lang === "my" ? "ဒုဝါဆို" : "2nd Waso";
  return T[md.month];
}

/** The next full-moon day (လပြည့်) and new-moon day (လကွယ်) strictly after `from`, with their Myanmar dates. */
export function nextMoonDays(from = new Date()) {
  const base = jdnOf(from.getFullYear(), from.getMonth() + 1, from.getDate());
  let full = null, newMoon = null;
  for (let i = 1; i <= 32 && !(full && newMoon); i++) {
    const md = myanmarFromJdn(base + i); if (!md) break;
    const k = moonDay(md).kind;
    if (k === "full" && !full) full = { days: i, md };
    if (k === "new" && !newMoon) newMoon = { days: i, md };
  }
  return { full, newMoon };
}

/** Myanmar date for a "YYYY-MM-DD" string (a place's own calendar day). */
export function myanmarDateOf(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? myanmarFromJdn(jdnOf(+m[1], +m[2], +m[3])) : null;
}

/** Buddhist observance (ဥပုသ်) days: 8th waxing, full moon, 8th waning, new moon. Returns "full" | "new" | "half" | null. */
export function uposatha(md) {
  const d = moonDay(md); if (!d) return null;
  if (d.kind === "full" || d.kind === "new") return d.kind;
  return d.n === 8 && (d.kind === "waxing" || d.kind === "waning") ? "half" : null;
}
