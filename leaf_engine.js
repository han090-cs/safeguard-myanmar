// Leaf photo check: the browser side of the engine. Everything is fetched from this site (nothing from a CDN, nothing sent out):
// ONNX Runtime Web (its .wasm arrives in four parts that are joined and checked), then the model for the crop. The photo itself never leaves the page.
import { ENGINE, MODELS } from "./leaf_models.js";
import { prepare, softmax } from "./leaf_prep.js";

let ORT = null, LOADING = null;
const SESSIONS = new Map(), SESSION_LOADS = new Map();

const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
async function sha256(bytes) { return globalThis.crypto?.subtle ? hex(await globalThis.crypto.subtle.digest("SHA-256", bytes)) : ""; }   // no SubtleCrypto on plain http

/** Fetch a file into `into` (a Uint8Array of the right size, or null to allocate), telling `onBytes` how many bytes just arrived. */
async function fetchInto(url, into, onBytes) {
  const r = await fetch(url, { cache: "force-cache" });
  if (!r.ok) throw new Error(`http ${r.status}`);
  if (!r.body?.getReader) { const b = new Uint8Array(await r.arrayBuffer()); if (into) into.set(b); onBytes(b.length); return into || b; }
  const reader = r.body.getReader(), chunks = [];
  let off = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (into) into.set(value, off); else chunks.push(value);
    off += value.length; onBytes(value.length);
  }
  if (into) return off === into.length ? into : into.subarray(0, off);
  const out = new Uint8Array(off); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Load ONNX Runtime Web (once). `onBytes(n)` reports downloaded bytes. Rejects when the browser cannot run WebAssembly or a file is damaged. */
export function loadEngine(onBytes = () => {}) {
  if (ORT) return Promise.resolve(ORT);
  if (typeof WebAssembly !== "object") return Promise.reject(new Error("no wasm"));
  LOADING ||= (async () => {
    const url = ENGINE.dir + ENGINE.glue;
    const mod = await import(/* @vite-ignore */ url);
    const ort = mod.InferenceSession ? mod : mod.default;
    const bin = new Uint8Array(ENGINE.bytes);
    let off = 0;
    for (let i = 1; i <= ENGINE.parts; i++) {
      const got = await fetchInto(`${ENGINE.dir}${ENGINE.wasm}.${i}`, bin.subarray(off), onBytes);
      off += got.length;
    }
    if (off !== ENGINE.bytes) throw new Error("engine size");
    const h = await sha256(bin);
    if (h && h !== ENGINE.sha256) throw new Error("engine hash");
    ort.env.wasm.wasmBinary = bin;               // the glue script still comes from wasmPaths; the binary is the one we joined and checked
    ort.env.wasm.wasmPaths = ENGINE.dir;
    ort.env.wasm.numThreads = 1;                 // threads need cross-origin isolation headers; one thread is plenty for a 3 MB model
    ort.env.wasm.proxy = false;
    ort.env.logLevel = "error";
    ORT = ort;
    return ort;
  })().catch(e => { LOADING = null; throw e; });
  return LOADING;
}

/** Load one model (once). */
export function loadModel(key, onBytes = () => {}) {
  if (SESSIONS.has(key)) return Promise.resolve(SESSIONS.get(key));
  if (!SESSION_LOADS.has(key)) {
    const m = MODELS[key];
    SESSION_LOADS.set(key, (async () => {
      const ort = await loadEngine(onBytes);
      const bytes = await fetchInto(m.file, new Uint8Array(m.bytes), onBytes);
      if (bytes.length !== m.bytes) throw new Error("model size");
      const h = await sha256(bytes);
      if (h && h !== m.sha256) throw new Error("model hash");
      const s = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      SESSIONS.set(key, s);
      return s;
    })().catch(e => { SESSION_LOADS.delete(key); throw e; }));
  }
  return SESSION_LOADS.get(key);
}

/** Run a loaded model on a photo (RGBA pixels as canvas getImageData gives them). Returns the softmax over all of the model's outputs. */
export async function classify(key, rgba, w, h) {
  const s = SESSIONS.get(key) || await loadModel(key);
  const x = new ORT.Tensor("float32", prepare(MODELS[key].prep, rgba, w, h, 4), [1, 3, 224, 224]);
  const out = await s.run({ [s.inputNames[0]]: x });
  const logits = out[s.outputNames[0]].data;
  if (logits.length !== MODELS[key].classes.length) throw new Error("model outputs");
  return softmax(Array.from(logits));
}

export const engineReady = () => !!ORT;
export const modelReady = key => SESSIONS.has(key);
