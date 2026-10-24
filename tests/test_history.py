"""/api/history: nearest-region lookup and data integrity (offline)."""
import json
from pathlib import Path
from fastapi.testclient import TestClient
import main

client = TestClient(main.app)
DOC = json.loads((Path(__file__).resolve().parent.parent / "data" / "history.json").read_text(encoding="utf-8"))


def test_yangon_maps_to_yangon_region():
    j = client.get("/api/history", params={"lat": 16.8, "lon": 96.15}).json()
    assert j["region_id"] == "MM-06" and j["kind"] == "modelled" and j["region"]["years"][0] == 1985


def test_data_is_clean_and_future_free():
    assert len(DOC["regions"]) == 15
    for r in DOC["regions"].values():
        assert len(r["years"]) == len(r["temp"]) == len(r["rain"]) and r["years"][-1] == DOC["last_full_year"]
        assert len(r["clim_temp"]) == 12 and 10 < r["temp"][0] < 32
    assert any(e["year"] == 2025 and e["type"] == "Earthquake" for e in DOC["events"])


def test_bad_coordinates_rejected():
    assert client.get("/api/history", params={"lat": 99, "lon": 96}).status_code == 422
