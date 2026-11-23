/* Anonymous crash note. When a script error happens on the page, ONE short note (what failed, which file and line, language, tab,
   error kind) goes to /api/client-error so the developer can see it in the server log. It carries no place, no coordinates, no saved data
   and no account; the server does not store the IP address. Nothing is sent when the browser says Do Not Track / Global Privacy Control,
   when the device is offline, or for errors from browser extensions and other sites' scripts. At most three notes per page visit. */
(function () {
  "use strict";
  var nav = navigator;
  if (nav.doNotTrack === "1" || window.doNotTrack === "1" || nav.globalPrivacyControl === true) { window.mwReportError = function () {}; return; }
  var MAX = 3, sent = 0, seen = {};
  // keep only what helps to find the bug: no URLs with query strings, no coordinate-like numbers
  function clean(s, n) {
    return String(s == null ? "" : s)
      .replace(/https?:\/\/[^\s)'"]+/g, function (u) { return u.split(/[?#]/)[0].replace(/^https?:\/\/[^/]+/, ""); })
      .replace(/-?\d{1,3}\.\d{3,}/g, "#").replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, n);
  }
  function fileOf(u) {
    try { var x = new URL(u, location.href); return x.origin === location.origin ? x.pathname.split("/").pop() : null; } catch (e) { return null; }
  }
  function tabNow() { var m = /[#&]tab=([a-z]{1,16})/.exec(location.hash); return m ? m[1] : ""; }
  function langNow() { try { var l = localStorage.getItem("lang"), j = localStorage.getItem("lang_ja"); return l === "my" ? "my" : (j === "1" ? "ja" : (j === "2" ? "ja_easy" : "en")); } catch (e) { return ""; } }
  function send(kind, msg, file, line, col) {
    if (sent >= MAX || nav.onLine === false) return;
    msg = clean(msg, 200); if (!msg || msg === "Script error.") return;
    var key = kind + "|" + msg + "|" + file;   // the same error again, even from another line, is the same bug
    if (seen[key]) return; seen[key] = 1; sent++;
    var q = "t=" + kind + "&m=" + encodeURIComponent(msg) + "&f=" + encodeURIComponent(file || "") + "&l=" + (line | 0) + "&c=" + (col | 0) +
            "&lang=" + langNow() + "&tab=" + tabNow();
    try { fetch("/api/client-error?" + q, { keepalive: true, credentials: "omit", cache: "no-store" }).catch(function () {}); } catch (e) { /* reporting must never break the page */ }
  }
  window.addEventListener("error", function (e) {
    if (e.target && e.target !== window) return;                   // a failed <img>/<script> tag is not a code error
    var f = e.filename ? fileOf(e.filename) : "";
    if (f === null || /^ResizeObserver loop/.test(e.message || "")) return;   // other origin / extension / harmless browser notice
    send("error", e.message, f, e.lineno, e.colno);
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason; send("promise", (r && r.message) || r, "", 0, 0);
  });
  window.mwReportError = function (kind, what) { send(kind === "section" ? "section" : "error", what, "", 0, 0); };
})();
