"""Download ERA5 1991–2020 normals ahead of time for the dashboard's built-in towns, one at a time.

    python tools/prewarm_baseline.py                 # all towns in weather_script.js (MM_CITIES)
    python tools/prewarm_baseline.py --pause 90      # seconds between downloads (default 75)
    python tools/prewarm_baseline.py --regions       # also the 15 state/region centres

Why: the first visit to a new place downloads 30 years of daily ERA5 data. Open-Meteo's free API limits heavy
requests per minute, so several first visits in the same minute are refused (HTTP 429) and the "compared with
normal" cards are left out for a few minutes. Running this once, off-peak, stores the normals on disk
(BASELINE_CACHE_DIR, ~61 KB per town) so visitors never wait for them. Safe to stop and re-run: cached towns are
skipped. Stops at the first 429 and tells you to try again later.
"""
from __future__ import annotations

import argparse
import asyncio
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from risk_engine.baseline import BaselineStore, point_key  # noqa: E402

CITY = re.compile(r'\[\s*"[^"]*"\s*,\s*"([^"]+)"\s*,\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]')


def towns(script: Path) -> list[tuple[str, float, float]]:
    text = script.read_text(encoding="utf-8")
    block = text[text.index("MM_CITIES"):]
    block = block[:block.index("];")]
    seen, out = set(), []
    for name, lat, lon in CITY.findall(block):
        key = point_key(float(lat), float(lon))
        if key not in seen:
            seen.add(key)
            out.append((name, float(lat), float(lon)))
    return out


def region_centres(history: Path) -> list[tuple[str, float, float]]:
    """The 15 state/region centres used by the Compare tab's month-by-month card (data/history.json)."""
    import json
    doc = json.loads(history.read_text(encoding="utf-8"))
    return [(f"{v['en']} (centre)", v["lat"], v["lon"]) for v in doc["regions"].values()]


async def main(pause: float, script: Path, regions: bool = False) -> int:
    store = BaselineStore()
    pts = towns(script) + (region_centres(ROOT / "data" / "history.json") if regions else [])
    seen, todo = set(), []
    for t in pts:
        k = point_key(t[1], t[2])
        if k not in seen and not store.is_cached(t[1], t[2]):
            seen.add(k); todo.append(t)
    print(f"{len(todo)} town(s) without cached normals")
    try:
        for i, (name, lat, lon) in enumerate(todo):
            ok = await store.ensure_normals(lat, lon)
            print(f"  {'ok  ' if ok else 'FAIL'} {name} ({lat:.3f}, {lon:.3f})" + ("" if ok else f" – {store.last_error}"))
            if not ok and store.last_error and "429" in store.last_error:
                print("Rate limited by the archive; stopping. Run again later (cached towns are skipped).")
                return 1
            if i < len(todo) - 1:
                await asyncio.sleep(pause)
    finally:
        await store.aclose()
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pause", type=float, default=75.0)
    ap.add_argument("--script", type=Path, default=ROOT / "weather_script.js")
    ap.add_argument("--regions", action="store_true", help="also the 15 state/region centres (Compare tab, month by month)")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(main(a.pause, a.script, a.regions)))
