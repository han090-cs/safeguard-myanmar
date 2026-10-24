#!/usr/bin/env python3
"""Live check against the real Open-Meteo API. Run it on a machine with internet access:

    python tools/live_check.py

It calls the app's own /api/weather endpoint for a few places and reports whether UV, rain, temperature and air
quality actually come back (None means the provider returned nothing for that field).
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402

PLACES = [("Yangon", 16.8409, 96.1735), ("Mandalay", 21.9588, 96.0891), ("Myitkyina", 25.3833, 97.4)]


def first(values):
    return values[0] if isinstance(values, list) and values else None


def main_check() -> int:
    client = TestClient(main.app)
    bad = 0
    for name, lat, lon in PLACES:
        r = client.get("/api/weather", params={"lat": lat, "lon": lon})
        if r.status_code != 200:
            print(f"{name}: HTTP {r.status_code} {r.text[:120]}")
            bad += 1
            continue
        j = r.json()
        w = j.get("weather", {})
        cur, daily = w.get("current", {}), w.get("daily", {})
        aq = (j.get("air_quality") or {}).get("current", {})
        row = {
            "temp": cur.get("temperature_2m"),
            "rain_today_mm": first(daily.get("precipitation_sum")),
            "uv_max_today": first(daily.get("uv_index_max")),
            "aqi": aq.get("us_aqi"),
            "model": (j.get("meta") or {}).get("model_label"),
        }
        missing = [k for k, v in row.items() if v is None]
        print(f"{name}: {row}" + (f"  MISSING: {missing}" if missing else "  OK"))
        bad += bool(missing)
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main_check())
