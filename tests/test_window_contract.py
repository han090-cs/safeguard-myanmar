"""Scripts that load as separate modules (brief.js, rainlog.js, about.js) and a few late hooks talk through `window`.
Every hook that is read must be assigned somewhere, and every assigned hook must be read somewhere."""
import re
from pathlib import Path
from _src import source_js

ROOT = Path(__file__).resolve().parent.parent
FILES = {p.name: p.read_text(encoding="utf-8") for p in source_js() if not p.name.endswith(".config.js") and p.name not in ("sw.js", "sw-version.js")}
BUILTIN = {"location", "scrollTo", "scrollY", "innerWidth", "innerHeight", "addEventListener", "removeEventListener", "matchMedia", "open",
           "dispatchEvent", "getComputedStyle", "history", "navigator", "localStorage", "document", "setTimeout", "clearTimeout", "requestAnimationFrame",
           "print", "alert", "confirm", "CustomEvent", "Notification", "isSecureContext", "performance", "devicePixelRatio", "screen", "visualViewport", "scrollX", "self", "top", "focus"}


def _assigned():
    out = {}
    for f, t in FILES.items():
        for n in re.findall(r"(?<![\w.])(?:window|global)\.([A-Za-z_]\w*)\s*=(?!=)", t):
            out.setdefault(n, set()).add(f)
    return out


def test_every_window_hook_that_is_read_is_assigned_somewhere():
    assigned = _assigned()
    for f, t in FILES.items():
        for n in set(re.findall(r"(?<![\w.])window\.([A-Za-z_]\w*)", t)):
            assert n in assigned or n in BUILTIN, f"{f} reads window.{n} but nothing assigns it"


def test_every_assigned_window_hook_is_read_somewhere():
    for n, owners in _assigned().items():
        uses = sum(len(re.findall(r"\b" + n + r"\b", t)) for t in FILES.values())
        assigns = sum(len(re.findall(r"(?<![\w.])(?:window|global)\." + n + r"\s*=(?!=)", t)) for t in FILES.values())
        assert uses > assigns, f"window.{n} is assigned in {sorted(owners)} but never read"
