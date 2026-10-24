// Plain-Node checks for mm_calendar.js (run: node tests/mm_calendar.test.mjs).
// Reference values come from the mm-cal-js / yan9a mmcal algorithm; they are the traditional Myanmar calendar, which can sit a day
// away from the astronomical full moon.
import assert from "node:assert/strict";
import { jdnOf, myanmarDate, myanmarFromJdn, moonDay, monthName, nextMoonDays } from "../mm_calendar.js";

assert.equal(jdnOf(2000, 1, 1), 2451545);
const d = myanmarDate(new Date(2026, 9, 18));                     // 18 Oct 2026
assert.deepEqual([d.year, d.month, d.monthDay], [1388, 7, 7]);
assert.equal(monthName(d, "my"), "သီတင်းကျွတ်"); assert.equal(monthName(d, "en"), "Thadingyut");
assert.deepEqual(moonDay(d), { kind: "waxing", n: 7 });
const full = myanmarDate(new Date(2026, 9, 26));                  // Thadingyut full moon day
assert.deepEqual(moonDay(full), { kind: "full", n: 15 });
const n = nextMoonDays(new Date(2026, 9, 18));
assert.equal(n.full.days, 8); assert.equal(n.newMoon.days, 22);
assert.equal(moonDay(n.newMoon.md).kind, "new");
// every day over 30 years: day numbers advance by one and wrap only at month end
let prev = myanmarFromJdn(jdnOf(2000, 1, 1));
for (let j = jdnOf(2000, 1, 2); j < jdnOf(2030, 1, 1); j++) {
  const c = myanmarFromJdn(j);
  if (prev.monthDay < prev.monthLength) assert.equal(c.monthDay, prev.monthDay + 1, "day " + j); else assert.equal(c.monthDay, 1, "wrap " + j);
  assert.ok(c.monthLength === 29 || c.monthLength === 30 || c.monthLength === 31);
  prev = c;
}
// watat year: month 4 is the second Waso
const w = myanmarDate(new Date(2023, 7, 15)); assert.ok(w.yearType > 0); assert.ok(["ဒုဝါဆို","ဝါခေါင်","ပဝါဆို"].includes(monthName(w, "my")));
assert.equal(myanmarFromJdn(jdnOf(1950, 1, 1)), null);
console.log("mm_calendar.test.mjs ok");
// uposatha marks
import { myanmarDateOf, uposatha } from "../mm_calendar.js";
assert.equal(uposatha(myanmarDateOf("2026-10-26")), "full");
assert.equal(uposatha(myanmarDateOf("2026-11-09")), "new");
assert.equal(uposatha(myanmarDateOf("2026-10-19")), "half");      // waxing day 8
assert.equal(uposatha(myanmarDateOf("2026-10-20")), null);
assert.equal(myanmarDateOf("nope"), null);
console.log("uposatha ok");
