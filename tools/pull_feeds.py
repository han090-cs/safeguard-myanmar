#!/usr/bin/env python3
"""Pull the free international hazard feeds from the command line (or cron) and save a JSON snapshot.

    python tools/pull_feeds.py                          # regional alerts (USGS + GDACS)
    python tools/pull_feeds.py --lat 21.96 --lon 96.09  # also the GloFAS river outlook and the alerts near that place
    python tools/pull_feeds.py --out data/feeds_snapshot.json

Exit code 1 when every source failed. Add new sources in risk_engine/feeds.py (see its docstring).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from risk_engine import feeds  # noqa: E402


async def run(lat: float | None, lon: float | None) -> dict:
    result = await feeds.pull_regional()
    if lat is not None and lon is not None:
        result["near"], result["elsewhere_count"] = feeds.alerts_near(result["alerts"], lat, lon)
        try:
            result["river"] = await feeds.pull_river(lat, lon)
        except Exception as exc:  # optional part
            result["river"], result["errors"]["glofas"] = None, f"{type(exc).__name__}: {str(exc)[:120]}"
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lat", type=float)
    ap.add_argument("--lon", type=float)
    ap.add_argument("--out", help="write the full result as JSON to this path")
    a = ap.parse_args()
    if (a.lat is None) != (a.lon is None):
        ap.error("--lat and --lon go together")
    res = asyncio.run(run(a.lat, a.lon))
    print(f"fetched {res['fetched_at']}: {len(res['alerts'])} alerts in the Myanmar region")
    for x in (res.get("near") or res["alerts"])[:10]:
        print(f"  [{x['level']:<7}] {x['kind']:<10} {x['title'][:70]} ({x['source']})" + (f" {x['distance_km']} km" if "distance_km" in x else ""))
    if res.get("river"):
        r = res["river"]
        print(f"river: today {r['today']} {r['unit']}, peak {r['peak']} on {r['peak_date']} ({r['trend']})")
    for name, err in res["errors"].items():
        print(f"  ! {name}: {err}")
    if a.out:
        Path(a.out).write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
        print("saved", a.out)
    return 1 if len(res["errors"]) >= 2 and not res["alerts"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
