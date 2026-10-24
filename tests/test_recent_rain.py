"""/api/recent-rain with a stubbed provider (offline)."""
from fastapi.testclient import TestClient
import main
from app import providers

client = TestClient(main.app)


def test_recent_rain_maps_days(monkeypatch):
    async def fake(url, params, **k):
        return {"daily": {"time": ["2026-10-05", "2026-10-06"], "precipitation_sum": [0.0, 4.2]}}, 200
    monkeypatch.setattr(providers, "fetch_json", fake)
    j = client.get("/api/recent-rain", params={"lat": 11.11, "lon": 96.11}).json()
    assert j["days"] == {"2026-10-05": 0.0, "2026-10-06": 4.2} and "not a rain gauge" in j["source"]


def test_recent_rain_unavailable(monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("down")
    monkeypatch.setattr(providers, "fetch_json", boom)
    assert client.get("/api/recent-rain", params={"lat": 12.12, "lon": 97.12}).status_code == 503
