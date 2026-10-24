"""Sanity checks for the farming data and the region lookup used by GPS places."""
import json
from pathlib import Path

from fastapi.testclient import TestClient

import main

DATA = json.loads((Path(__file__).resolve().parents[1] / "data" / "agri.json").read_text(encoding="utf-8"))


def test_crops_reference_known_zones_sources_and_valid_months():
    for c in DATA["crops"]:
        assert set(c["zones"]) <= set(DATA["zones"]), c["id"]
        assert set(c["src"]) <= set(DATA["sources"]), c["id"]
        assert c["v"] in {"v", "p", "u"}
        for key in ("plant", "harvest"):
            for a, b in c[key] or []:
                assert 1 <= a <= 12 and 1 <= b <= 12, (c["id"], key)


def test_every_zone_has_crops_and_checked_behaviours_cite_sources():
    for z, info in DATA["zones"].items():
        assert any(z in c["zones"] for c in DATA["crops"]), z
        for b in info["beh"]:
            assert b["s"] in DATA["sources"]
    assert len(DATA["monthly_general"]) == 12


def test_api_and_region_lookup():
    client = TestClient(main.app)
    assert client.get("/api/agri").json()["updated"]
    # Yangon city and Mandalay city must resolve to their own regions
    assert client.get("/api/region-at", params={"lat": 16.84, "lon": 96.17}).json()["region"] == "Yangon"
    assert client.get("/api/region-at", params={"lat": 21.96, "lon": 96.09}).json()["region"] == "Mandalay"
    # a point far outside Myanmar has no region
    assert client.get("/api/region-at", params={"lat": 48.8, "lon": 2.35}).json()["region"] is None

def test_agri_zone_resolver_is_location_aware_for_mixed_regions():
    from risk_engine.agri_zones import resolve
    bago = resolve(17.34, 96.48, "Bago")
    assert bago["zone"] == "delta"
    assert bago["confidence"] in {"medium", "low"}
    dry = resolve(21.96, 96.09, "Mandalay")
    assert dry["zone"] == "dry"
    naypyitaw = resolve(19.76, 96.08, "Naypyitaw")
    assert naypyitaw["zone"] == "dry"
    assert "hills" in naypyitaw["zones"]
