// Loads each ES module of the weather page in Node with stubbed browser globals. It fails only on LINK errors
// (missing export, bad import path, import cycle, use before initialisation), which ESLint cannot see and which blank the page.
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mk = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "length" ? 0 : mk()), apply: () => mk(), set: () => true, construct: () => mk() });
globalThis.document = new Proxy({}, { get: (t, k) => (k === "readyState" ? "complete" : mk()) });
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
Object.defineProperty(globalThis, "navigator", { value: { connection: null, language: "my" }, configurable: true });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.MutationObserver = class { observe() {} };
globalThis.addEventListener = () => {};
globalThis.dispatchEvent = () => true;
globalThis.CustomEvent = class {};
globalThis.setInterval = () => 0;
globalThis.setTimeout = () => 0;
globalThis.requestAnimationFrame = () => 0;
globalThis.fetch = async (u) => {
  const s = String(u);
  if (s.startsWith("file:")) { const b = fs.readFileSync(fileURLToPath(s), "utf8"); return { ok: true, json: async () => JSON.parse(b) }; }
  return { ok: false, status: 503, json: async () => ({}) };
};

const modules = fs.readdirSync(ROOT).filter((f) => f.endsWith(".js") && !f.endsWith(".config.js") && /^(import|export)\s/m.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
let failed = 0;
for (const m of modules) {
  try { await import(pathToFileURL(path.join(ROOT, m)).href); console.log("OK  ", m); }
  catch (e) {
    const link = /does not provide an export|Cannot find module|Cannot find package|circular|before initialization|Unexpected token|Invalid or unexpected/.test(String(e));
    console.log(link ? "FAIL" : "ok* ", m, link ? String(e).slice(0, 200) : "(runs; stub limit: " + String(e).slice(0, 60) + ")");
    if (link) failed++;
  }
}
process.exit(failed ? 1 : 0);
