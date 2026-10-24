"""Offline tests: English place search and DMH alert matching (no network)."""
import pytest
from fastapi.testclient import TestClient

import main
from gazetteer import search_places

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def _reset():
    main.rate_limit_buckets.clear()


@pytest.mark.parametrize("query,burmese,region", [
    ("Mandalay", "မန္တလေး", "Mandalay"),
    ("mandal", "မန္တလေး", "Mandalay"),
    ("Naypyitaw", "နေပြည်တော်", "Naypyitaw"),
    ("Rangoon", "ရန်ကုန်", "Yangon"),
    ("Pathein", "ပုသိမ်", "Ayeyarwady"),
])
def test_english_names_resolve_locally(query, burmese, region):
    first = search_places(query, limit=5)[0]
    assert (first["name"], first["region"], first["type"]) == (burmese, region, "Town")


def test_burmese_search_still_ranks_the_town_first():
    assert search_places("မန္တလေး", limit=3)[0]["type"] == "Town"


def test_unknown_place_returns_nothing_quickly():
    assert search_places("qqqzzz", limit=5) == []


def test_alerts_match_by_coordinates_alone(monkeypatch, tmp_path):
    """The Flood tab used to send only lat/lon, and state-wide warnings (no station points) never matched."""
    import json
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    alert = {"id": "T-1", "source": "dmh", "issuer": "DMH", "type": "heavy_rain", "regions": ["Yangon"],
             "valid_from": (now - timedelta(hours=2)).isoformat(), "valid_to": (now + timedelta(hours=20)).isoformat(),
             "title": {"my": "မိုးကြီး", "en": "Heavy Rainfall Warning"}}
    f = tmp_path / "official_alerts.json"
    f.write_text(json.dumps({"alerts": [alert]}), encoding="utf-8")
    monkeypatch.setattr(main, "official_store", main.OfficialAlertStore(f))

    by_point = client.get("/api/dmh/alerts", params={"lat": 16.84, "lon": 96.17}).json()
    assert [a["id"] for a in by_point["alerts"]] == ["T-1"] and by_point["region"] == "Yangon"
    by_burmese = client.get("/api/dmh/alerts", params={"lat": 16.84, "lon": 96.17, "region": "ရန်ကုန်တိုင်းဒေသကြီး"}).json()
    assert [a["id"] for a in by_burmese["alerts"]] == ["T-1"] and by_burmese["alerts"][0]["active"] is True
    elsewhere = client.get("/api/dmh/alerts", params={"lat": 21.95, "lon": 96.09}).json()
    assert elsewhere["alerts"] == []


def test_hospital_database_and_endpoint_are_wired():
    r = client.get("/api/hospitals/nearest", params={"lat": 21.9588, "lon": 96.0891, "limit": 3})
    assert r.status_code == 200
    body = r.json()
    assert body["total_available"] >= 1000
    assert "MIMU / CDE-Myanmar" in body["source"]
    assert len(body["results"]) == 3
    assert all("distance_km" in x and "latitude" in x and "longitude" in x for x in body["results"])


def test_ui_does_not_render_removed_decision_cards():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    html = (root / "weather.html").read_text(encoding="utf-8")
    js = (root / "weather_script.js").read_text(encoding="utf-8")
    assert 'id="smartPanel"' not in html
    assert 'id="comfortWindow"' not in html
    assert 'function renderSmartSignals' not in js
    assert 'renderSmartSignals(h)' not in js
