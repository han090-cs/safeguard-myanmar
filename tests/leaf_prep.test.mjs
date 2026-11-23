// Photo preparation in leaf_prep.js against Pillow (fixtures from tools/make_leaf_prep_fixture.py). Run: node tests/leaf_prep.test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pyRound, resizeRGB, prepare, softmax } from "../leaf_prep.js";

const fx = JSON.parse(readFileSync(new URL("./fixtures/leaf_prep.json", import.meta.url), "utf8"));

// The same pixel formula as the Python generator (32-bit integer arithmetic).
function pixels(w, h) {
  const b = new Uint8Array(w * h * 4);
  for (let i = 0; i < b.length; i++) b[i] = (((Math.imul(i, 1103515245) + 12345) >>> 16) & 255);
  for (let i = 3; i < b.length; i += 4) b[i] = 255;
  for (let i = 0; i < w * h; i++) b[i * 4] = ((b[i * 4] + Math.floor(((i % w) * 255) / Math.max(1, w - 1))) >> 1) & 255;
  return b;
}
const sha = u8 => createHash("sha256").update(u8).digest("hex");

let n = 0;
for (const c of fx.cases) {
  const rgba = pixels(c.w, c.h);
  // resized pixels are exactly Pillow's
  const s = c.kind === "pv" ? 256 / Math.min(c.w, c.h) : null;
  const [rw, rh] = c.resized;
  assert.deepEqual(c.kind === "pv" ? [pyRound(c.w * s), pyRound(c.h * s)] : [224, 224], [rw, rh], `${c.kind} ${c.w}x${c.h} target size`);
  const rgb = resizeRGB(rgba, c.w, c.h, 4, rw, rh);
  assert.equal(sha(rgb), c.resized_sha, `${c.kind} ${c.w}x${c.h} resized pixels differ from Pillow`);
  // the tensor is Pillow's within float32 rounding
  const t = prepare(c.kind, rgba, c.w, c.h, 4);
  assert.equal(t.length, 3 * 224 * 224);
  c.idx.forEach((i, k) => assert.ok(Math.abs(t[i] - c.vals[k]) < 1e-6, `${c.kind} ${c.w}x${c.h} value ${i}: ${t[i]} vs ${c.vals[k]}`));
  const sum = Array.from(t).reduce((a, v) => a + v, 0);
  assert.ok(Math.abs(sum - c.sum) < 0.05, `${c.kind} ${c.w}x${c.h} sum ${sum} vs ${c.sum}`);
  n++;
}

// 3 channels or 4 channels in gives the same tensor
{
  const w = 40, h = 30, rgba = pixels(w, h), rgb3 = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) for (let k = 0; k < 3; k++) rgb3[i * 3 + k] = rgba[i * 4 + k];
  assert.deepEqual(Array.from(prepare("pv", rgb3, w, h, 3).slice(0, 500)), Array.from(prepare("pv", rgba, w, h, 4).slice(0, 500)));
}
assert.throws(() => prepare("nope", new Uint8Array(16), 2, 2, 4), /unknown prep/);

// Python's round() goes to the even number on halves
assert.deepEqual([0.5, 1.5, 2.5, 3.5, -0.5, 255.5, 341.33].map(pyRound), [0, 2, 2, 4, 0, 256, 341]);

// softmax: sums to 1, stable for large logits, ordered
{
  const p = softmax([1000, 1001, 999]);
  assert.ok(Math.abs(p.reduce((a, v) => a + v, 0) - 1) < 1e-12 && p[1] > p[0] && p[0] > p[2]);
  assert.ok(Math.abs(softmax([0, 0, 0, 0])[2] - 0.25) < 1e-12);
}
console.log(`leaf_prep: ${n} images match Pillow (${fx.pillow}); rounding and softmax ok`);
