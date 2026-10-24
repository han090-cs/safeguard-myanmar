"""Build risk_engine/data/myanmar_admin1.geojson (Myanmar's 15 states/regions) from OpenStreetMap.

One-off build step; the engine itself never calls OpenStreetMap. Needs shapely (pip install shapely).

    # 1. download the 15 official admin_level=4 relations (ISO 3166-2 MM-01 … MM-18) with geometry
    curl -s https://overpass-api.de/api/interpreter --data-urlencode 'data=[out:json][timeout:300];
      rel(id:5996473,5996474,5996475,5996476,5996477,5996478,5996479,5996480,5996481,5996482,5996483,
             5996484,5996485,5996486,5996487);out geom;' > osm_admin4.json
    # 2. assemble, simplify, write
    python tools/build_myanmar_admin1.py osm_admin4.json risk_engine/data/myanmar_admin1.geojson

Natural Earth's admin-1 layer was not used because it merges Naypyitaw Union Territory into Mandalay, while DMH
warnings name Naypyitaw separately. The two de facto Wa areas that OSM also tags at level 4 are excluded (they lie
inside Shan State and have no ISO code).

Data © OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0; the output file is a
derived database under the same licence.
"""
from __future__ import annotations

import json
import sys
from datetime import date

from shapely.geometry import LineString, MultiPolygon, Polygon, mapping
from shapely.ops import linemerge, polygonize, unary_union

REGION_BY_ISO = {
    "MM-01": "Sagaing", "MM-02": "Bago", "MM-03": "Magway", "MM-04": "Mandalay", "MM-05": "Tanintharyi",
    "MM-06": "Yangon", "MM-07": "Ayeyarwady", "MM-11": "Kachin", "MM-12": "Kayah", "MM-13": "Kayin",
    "MM-14": "Chin", "MM-15": "Mon", "MM-16": "Rakhine", "MM-17": "Shan", "MM-18": "Naypyitaw",
}
TOLERANCE_DEG = 0.004      # ~400 m; enough for "which state is this town in", small enough to keep towns right


def _rings(members, role):
    lines = [LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
             for m in members if m.get("type") == "way" and m.get("role", "outer") in role and len(m.get("geometry", [])) > 1]
    return list(polygonize(linemerge(lines))) if lines else []


def build(osm: dict) -> dict:
    features = []
    for rel in osm["elements"]:
        iso = rel["tags"].get("ISO3166-2")
        if iso not in REGION_BY_ISO:
            continue
        outer = unary_union(_rings(rel["members"], ("outer", "")))
        inner = unary_union(_rings(rel["members"], ("inner",))) if any(m.get("role") == "inner" for m in rel["members"]) else None
        geom = outer.difference(inner) if inner is not None and not inner.is_empty else outer
        geom = geom.simplify(TOLERANCE_DEG, preserve_topology=True)
        if isinstance(geom, Polygon):
            geom = MultiPolygon([geom])
        geom = MultiPolygon([p for p in geom.geoms if p.area > 1e-5])        # drop specks
        coords = mapping(geom)["coordinates"]
        rounded = [[[[round(x, 4), round(y, 4)] for x, y in ring] for ring in poly] for poly in coords]
        features.append({"type": "Feature", "properties": {
            "region": REGION_BY_ISO[iso], "iso_3166_2": iso, "name_en": rel["tags"].get("name:en"),
            "name_my": rel["tags"].get("name:my") or rel["tags"].get("name"), "osm_relation": rel["id"]},
            "geometry": {"type": "MultiPolygon", "coordinates": rounded}})
    missing = set(REGION_BY_ISO.values()) - {f["properties"]["region"] for f in features}
    if missing:
        raise SystemExit(f"missing units: {sorted(missing)}")
    features.sort(key=lambda f: f["properties"]["iso_3166_2"])
    return {"type": "FeatureCollection",
            "_source": f"OpenStreetMap admin_level=4 relations, retrieved {date.today().isoformat()}, simplified "
                       f"{TOLERANCE_DEG} deg. © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).",
            "features": features}


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    out = build(json.load(open(src, encoding="utf-8")))
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {dst}: {len(out['features'])} units")
