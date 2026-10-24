"""Coverage check: is a point inside Myanmar (Natural Earth 1:50m boundary, with a small buffer for
border and coastal towns and for boundary simplification)? And which state/region is it in (OpenStreetMap
admin_level=4 boundaries, see tools/build_myanmar_admin1.py)?"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from typing import Optional

from .config import DATA_DIR

BUFFER_KM = 15.0


@lru_cache(maxsize=1)
def _rings() -> list[list[tuple[float, float]]]:
    gj = json.loads((DATA_DIR / "myanmar_boundary.geojson").read_text(encoding="utf-8"))
    return [[(x, y) for x, y in ring] for poly in gj["geometry"]["coordinates"] for ring in poly[:1]]


def _inside(lon: float, lat: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _seg_dist_km(lon: float, lat: float, a: tuple[float, float], b: tuple[float, float]) -> float:
    kx = 111.32 * math.cos(math.radians(lat))
    ky = 110.57
    px, py = lon * kx, lat * ky
    ax, ay, bx, by = a[0] * kx, a[1] * ky, b[0] * kx, b[1] * ky
    dx, dy = bx - ax, by - ay
    t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


@lru_cache(maxsize=1)
def _admin1() -> list[tuple[str, list[tuple[float, float, float, float, list[list[tuple[float, float]]]]]]]:
    """[(region, [(min_lon, min_lat, max_lon, max_lat, [outer ring, *holes]), ...]), ...]"""
    gj = json.loads((DATA_DIR / "myanmar_admin1.geojson").read_text(encoding="utf-8"))
    units = []
    for f in gj["features"]:
        polys = []
        for poly in f["geometry"]["coordinates"]:
            rings = [[(x, y) for x, y in ring] for ring in poly]
            xs, ys = [p[0] for p in rings[0]], [p[1] for p in rings[0]]
            polys.append((min(xs), min(ys), max(xs), max(ys), rings))
        units.append((f["properties"]["region"], polys))
    return units


@lru_cache(maxsize=4096)
def _region_at(lat: float, lon: float, max_km: float) -> Optional[str]:
    units = _admin1()
    for region, polys in units:
        for x0, y0, x1, y1, rings in polys:
            if (x0 <= lon <= x1 and y0 <= lat <= y1 and _inside(lon, lat, rings[0])
                    and not any(_inside(lon, lat, hole) for hole in rings[1:])):
                return region
    # coast, islands and border strips lost to simplification: nearest state/region within max_km
    best, best_km, pad = None, max_km, max_km / 100.0
    for region, polys in units:
        for x0, y0, x1, y1, rings in polys:
            if not (x0 - pad <= lon <= x1 + pad and y0 - pad <= lat <= y1 + pad):
                continue
            ring = rings[0]
            for i in range(len(ring) - 1):
                d = _seg_dist_km(lon, lat, ring[i], ring[i + 1])
                if d < best_km:
                    best, best_km = region, d
    return best


def region_at(lat: float, lon: float, max_km: float = BUFFER_KM) -> Optional[str]:
    """Canonical state/region name for a point, or None outside Myanmar (beyond max_km)."""
    return _region_at(round(lat, 3), round(lon, 3), max_km)


@lru_cache(maxsize=1)
def region_names() -> dict[str, dict]:
    """Canonical region → {"my", "en", "iso_3166_2"} from the boundary file (OSM names)."""
    gj = json.loads((DATA_DIR / "myanmar_admin1.geojson").read_text(encoding="utf-8"))
    return {f["properties"]["region"]: {"my": f["properties"].get("name_my"), "en": f["properties"].get("name_en"),
                                         "iso_3166_2": f["properties"].get("iso_3166_2")} for f in gj["features"]}


def in_myanmar(lat: float, lon: float, buffer_km: float = BUFFER_KM) -> bool:
    if not (9.0 <= lat <= 29.0 and 92.0 <= lon <= 101.5):
        return False
    rings = _rings()
    if any(_inside(lon, lat, r) for r in rings):
        return True
    return any(_seg_dist_km(lon, lat, r[i], r[i + 1]) <= buffer_km for r in rings for i in range(len(r) - 1))
