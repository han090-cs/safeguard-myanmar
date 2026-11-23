// Leaf photo check: turning a photo into the numbers the models were trained on. Pure functions, no DOM, so they can be tested against Python.
// The models were measured in the SafeGuard Lab with Pillow's resize, so the same arithmetic is used here (Pillow's BILINEAR with its
// fixed-point 8-bit weights, horizontal pass first). A browser canvas resize gives slightly different pixels, and these models are
// sensitive enough to notice.
//   "imagenet224": straight 224x224 resize, (x/255 - mean) / std            (rice)
//   "pv":          short edge to 256, centre crop 224, x/127.5 - 1            (PlantVillage MobileNetV2)

const PRECISION_BITS = 22;                       // Pillow: 32 - 8 - 2
const ONE = 2 ** PRECISION_BITS;
const MEAN = [0.485, 0.456, 0.406].map(Math.fround);
const STD = [0.229, 0.224, 0.225].map(Math.fround);

/** Python's round(): halves go to the even number. */
export function pyRound(x) {
  const f = Math.floor(x), d = x - f;
  return d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
}

/** Pillow's weights for one axis (bilinear filter, widened when shrinking so the result is anti-aliased). */
function coeffs(inSize, outSize) {
  const scale = inSize / outSize, filterScale = Math.max(scale, 1), support = 1 * filterScale, ss = 1 / filterScale;
  const out = [];
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    let xmin = Math.trunc(center - support + 0.5); if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5); if (xmax > inSize) xmax = inSize;
    const n = xmax - xmin, k = new Array(n);
    let ww = 0;
    for (let x = 0; x < n; x++) { const d = Math.abs((x + xmin - center + 0.5) * ss); const w = d < 1 ? 1 - d : 0; k[x] = w; ww += w; }
    for (let x = 0; x < n; x++) {
      const w = ww !== 0 ? k[x] / ww : k[x];
      k[x] = w < 0 ? Math.trunc(-0.5 + w * ONE) : Math.trunc(0.5 + w * ONE);
    }
    out.push({ xmin, k });
  }
  return out;
}

const clip8 = v => { const s = Math.floor(v / ONE); return s < 0 ? 0 : s > 255 ? 255 : s; };

/** Resize an interleaved image (`ch` bytes per pixel, only the first 3 are used) to dw x dh. Returns an RGB Uint8Array. */
export function resizeRGB(src, sw, sh, ch, dw, dh) {
  let cur = src, cw = sw, cch = ch;
  if (dw !== sw) {                                                             // horizontal pass first, like Pillow
    const cf = coeffs(sw, dw), out = new Uint8Array(dw * sh * 3);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < dw; x++) {
        const { xmin, k } = cf[x];
        for (let c = 0; c < 3; c++) {
          let s = ONE / 2;
          for (let i = 0; i < k.length; i++) s += cur[(y * cw + xmin + i) * cch + c] * k[i];
          out[(y * dw + x) * 3 + c] = clip8(s);
        }
      }
    }
    cur = out; cw = dw; cch = 3;
  }
  if (dh !== sh) {
    const cf = coeffs(sh, dh), out = new Uint8Array(cw * dh * 3);
    for (let y = 0; y < dh; y++) {
      const { xmin, k } = cf[y];
      for (let x = 0; x < cw; x++) {
        for (let c = 0; c < 3; c++) {
          let s = ONE / 2;
          for (let i = 0; i < k.length; i++) s += cur[((xmin + i) * cw + x) * cch + c] * k[i];
          out[(y * cw + x) * 3 + c] = clip8(s);
        }
      }
    }
    cur = out; cch = 3;
  }
  if (cur === src || cch !== 3) {                                              // nothing was resized, or only 4-channel input: pack to RGB
    const out = new Uint8Array(dw * dh * 3);
    for (let i = 0; i < dw * dh; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = cur[i * cch + c];
    return out;
  }
  return cur;
}

/** The float tensor (1x3x224x224, channels first) for a model. `rgba` is what canvas getImageData returns (or any interleaved RGB with ch=3). */
export function prepare(kind, rgba, w, h, ch = 4) {
  const S = 224, out = new Float32Array(3 * S * S);
  if (kind === "imagenet224") {
    const px = resizeRGB(rgba, w, h, ch, S, S);
    for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) out[c * S * S + i] = Math.fround(Math.fround(Math.fround(px[i * 3 + c] / 255) - MEAN[c]) / STD[c]);
    return out;
  }
  if (kind === "pv") {
    const s = 256 / Math.min(w, h), nw = pyRound(w * s), nh = pyRound(h * s);
    const px = resizeRGB(rgba, w, h, ch, nw, nh), x0 = Math.floor((nw - S) / 2), y0 = Math.floor((nh - S) / 2);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) for (let c = 0; c < 3; c++) out[c * S * S + y * S + x] = Math.fround(Math.fround(px[((y0 + y) * nw + x0 + x) * 3 + c] / 127.5) - 1);
    return out;
  }
  throw new Error("unknown prep " + kind);
}

/** Probabilities from logits (float64, numerically stable). */
export function softmax(z) {
  let m = -Infinity; for (const v of z) if (v > m) m = v;
  const e = Array.from(z, v => Math.exp(v - m)); let s = 0; for (const v of e) s += v;
  return e.map(v => v / s);
}
