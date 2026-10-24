import { L } from "./i18n.js";
// Small external bootstrap so the dashboard can use a strict CSP without inline script/style exceptions.
window.MW_API_BASE = "";

(() => {
  const updateStatus = (message) => {
    const el = document.getElementById("status");
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
    el.classList.remove("status-action");
    const button=document.createElement("button");button.type="button";button.className="ghost-btn";button.textContent=L("ux_reload");
    button.onclick=()=>location.reload();el.append(" ",button);
  };

  // isSecureContext is true for https, localhost AND 127.0.0.1 (the old hostname check missed 127.0.0.1)
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type !== "MW_APP_UPDATED") return;
      updateStatus(L("app_updated"));
    });
  }


  // Large-text control for older users. The setting is local-only and works offline.
  const FONT_STEPS = [100, 112, 125];
  const fontLabel = document.getElementById("fontReset");
  const applyFont = (value) => {
    const n = FONT_STEPS.includes(Number(value)) ? Number(value) : 100;
    document.documentElement.style.setProperty("--mw-root-font", n + "%");
    document.documentElement.dataset.fontScale = String(n);
    const down=document.getElementById("fontDown"),up=document.getElementById("fontUp");
    if(down)down.disabled=n===FONT_STEPS[0];if(up)up.disabled=n===FONT_STEPS.at(-1);
    if (fontLabel) { fontLabel.textContent = n + "%"; fontLabel.setAttribute("aria-label", L("app_font_label", {n})); }
    try { localStorage.setItem("mw_font_scale", String(n)); } catch {}
  };
  let savedFont = 100;
  try { savedFont = Number(localStorage.getItem("mw_font_scale")) || 100; } catch {}
  applyFont(savedFont);
  window.addEventListener("mw-lang",()=>applyFont(Number(document.documentElement.dataset.fontScale)||100));
  document.getElementById("fontDown")?.addEventListener("click", () => {
    const cur = Number(document.documentElement.dataset.fontScale) || 100;
    applyFont(FONT_STEPS[Math.max(0, FONT_STEPS.indexOf(cur) - 1)]);
  });
  document.getElementById("fontUp")?.addEventListener("click", () => {
    const cur = Number(document.documentElement.dataset.fontScale) || 100;
    applyFont(FONT_STEPS[Math.min(FONT_STEPS.length - 1, FONT_STEPS.indexOf(cur) + 1)]);
  });
  document.getElementById("fontReset")?.addEventListener("click", () => applyFont(100));

  const offlineBanner = document.getElementById("offlineBanner");
  const updateOffline = () => {
    if (!offlineBanner) return;
    const off = !navigator.onLine;
    offlineBanner.hidden = !off;
    document.body.classList.toggle("offline-mode", off);
  };
  window.addEventListener("online", updateOffline);
  window.addEventListener("offline", updateOffline);
  updateOffline();

  window.addEventListener("online", () => document.body.classList.remove("offline-mode"));
  window.addEventListener("offline", () => document.body.classList.add("offline-mode"));

})();

// Dynamic bar widths/heights/colours are set through the CSSOM (allowed by the strict CSP), not inline style attributes.
(() => {
  const MAP = [["w", "width", v => v + "%"], ["h", "height", v => v + "px"], ["op", "opacity", v => v], ["bg", "background", v => v], ["bc", "borderLeftColor", v => v]];
  const apply = (root) => {
    if (!root || root.nodeType !== 1) return;
    const nodes = [root, ...root.querySelectorAll("[data-w],[data-h],[data-op],[data-bg],[data-bc]")];
    for (const el of nodes) {
      if (!el.dataset) continue;
      for (const [k, prop, fmt] of MAP) {
        if (el.dataset[k] !== undefined && el.dataset[k] !== "") el.style[prop] = fmt(el.dataset[k]);
      }
    }
  };
  const start = () => {
    apply(document.body);
    new MutationObserver(list => { for (const m of list) m.addedNodes.forEach(apply); }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();


// Dark mode: follows the phone's own setting until the person taps the moon button; after that their choice is remembered.
(() => {
  const btn = document.getElementById("themeToggle");
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const applyDark = (on, remember) => {
    document.body.classList.toggle("sg-dark", !!on);
    document.documentElement.classList.toggle("sg-dark", !!on);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", on ? "#07170e" : "#0b5328");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", on ? "dark" : "light");
    if (btn) {
      btn.textContent = on ? "☀️" : "🌙";
      btn.setAttribute("aria-pressed", String(!!on));
    }
    if (remember) { try { localStorage.setItem("mw_dark_mode", on ? "1" : "0"); } catch {} }
  };
  let saved = null;
  try { saved = localStorage.getItem("mw_dark_mode"); } catch {}
  const initial = () => saved === "1" || (saved === null && !!mq?.matches);
  if (document.body) applyDark(initial(), false);
  else document.addEventListener("DOMContentLoaded", () => applyDark(initial(), false));
  mq?.addEventListener?.("change", e => { if (saved === null) applyDark(e.matches, false); });
  document.addEventListener("click", (e) => {
    if (e.target.closest?.("#themeToggle")) {
      saved = document.body.classList.contains("sg-dark") ? "0" : "1";
      applyDark(saved === "1", true);
    }
  });
})();
