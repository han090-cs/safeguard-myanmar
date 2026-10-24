// Plain-Node checks for nature.js (run: node tests/nature.test.mjs).
import assert from "node:assert/strict";
import { windName, diseaseWatch } from "../nature.js";

// wind
assert.equal(windName(0,"my"),"မြောက်လေ");
assert.equal(windName(225,"my",7),"အနောက်တောင်လေ (မုတ်သုံလေ)");
assert.equal(windName(225,"my",1),"အနောက်တောင်လေ");   // south-west wind in January is not the monsoon
assert.equal(windName(359,"my",7),"မြောက်လေ");           // wraps around
assert.equal(windName(90,"en"),"E"); assert.equal(windName(null),"—");

// disease watch
const mk=(rh,t)=>({time:Array.from({length:24},(_,h)=>`2026-10-18T${String(h).padStart(2,"0")}:00`),relative_humidity_2m:Array(24).fill(rh),temperature_2m:Array(24).fill(t),precipitation:Array(24).fill(0)});
let r=diseaseWatch(mk(95,25)); assert.deepEqual(r[0].hits.map(h=>h.id),["blast","lateBlight"]);       // humid + 25 C: blast and potato late blight, not cool-weather onion mildew
r=diseaseWatch(mk(95,20)); assert.deepEqual(r[0].hits.map(h=>h.id),["blast","lateBlight","downyMildew"]);
r=diseaseWatch(mk(60,25)); assert.equal(r[0].hits.length,0);                                       // dry air: nothing
r=diseaseWatch(mk(95,31)); assert.equal(r[0].hits.length,0);                                       // too hot for any of them
assert.deepEqual(diseaseWatch(null),[]);
console.log("nature.test.mjs ok");
