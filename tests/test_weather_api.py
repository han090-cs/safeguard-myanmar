"""Offline tests for /api/weather: no network needed, providers are stubbed."""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main

client = TestClient(main.app)
OK = {"weather": {"current": {"temperature_2m": 31.2}, "daily": {"uv_index_max": [9]}},
      "air_quality": {"current": {"us_aqi": 42}},
      "meta": {"provider": "Open-Meteo", "fallback": False, "air_quality": True}}


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    main.weather_cache.clear()
    main.rate_limit_buckets.clear()

    async def unavailable(*_a, **_k):
        raise RuntimeError("down")
    for name in ("_fetch_weatherapi", "_fetch_openweather"):
        monkeypatch.setattr(main, name, unavailable)


def _stub_open_meteo(monkeypatch, *, fail=False):
    calls = {"n": 0}

    async def fake(_lat, _lon):
        calls["n"] += 1
        if fail:
            raise HTTPException(502, "Weather provider is temporarily unavailable")
        return {**OK, "meta": dict(OK["meta"])}
    monkeypatch.setattr(main, "_fetch_open_meteo", fake)
    return calls


def test_open_meteo_is_primary_and_cached(monkeypatch):
    calls = _stub_open_meteo(monkeypatch)
    r1 = client.get("/api/weather", params={"lat": 16.78, "lon": 96.16}).json()
    r2 = client.get("/api/weather", params={"lat": 16.78, "lon": 96.16}).json()
    assert r1["meta"]["provider"] == "Open-Meteo" and not r1["meta"]["fallback"]
    assert r2["meta"]["cached"] is True and calls["n"] == 1
    assert r1["weather"]["current"]["temperature_2m"] == 31.2  # untouched, never averaged


def test_falls_back_only_when_open_meteo_fails(monkeypatch):
    _stub_open_meteo(monkeypatch, fail=True)

    async def weatherapi(_lat, _lon):
        return {"name": "WeatherAPI", "uv": 8, "raw": {"location": {"tz_id": "Asia/Yangon"}, "current": {
            "temp_c": 29.0, "humidity": 70, "feelslike_c": 32.0, "pressure_mb": 1008, "vis_km": 10, "wind_kph": 12,
            "wind_degree": 200, "is_day": 1}}}
    monkeypatch.setattr(main, "_fetch_weatherapi", weatherapi)
    r = client.get("/api/weather", params={"lat": 20, "lon": 96}).json()
    assert r["meta"]["fallback"] is True and r["meta"]["provider"] == "WeatherAPI"
    assert r["failed_providers"][0]["provider"] == "Open-Meteo"


def test_serves_stale_copy_when_everything_fails(monkeypatch):
    _stub_open_meteo(monkeypatch)
    client.get("/api/weather", params={"lat": 21, "lon": 96})
    key = next(iter(main.weather_cache))
    main.weather_cache[key][1]["meta"]["fetched_at"] -= main.CACHE_TTL + 5  # expire freshness, keep stale copy
    _stub_open_meteo(monkeypatch, fail=True)
    r = client.get("/api/weather", params={"lat": 21, "lon": 96}).json()
    assert r["meta"]["stale"] is True


def test_502_when_nothing_available(monkeypatch):
    _stub_open_meteo(monkeypatch, fail=True)
    assert client.get("/api/weather", params={"lat": 22, "lon": 96}).status_code == 502


def test_api_csp_is_strict():
    api = client.get("/health").headers["content-security-policy"]
    assert api.startswith("default-src 'none'")


def test_search_finds_townships_in_burmese_and_english():
    for q, expect in (("Pathein", "ပုသိမ်"), ("ဖားကန့်", "ဖားကန့်"), ("Mingaladon", "မင်္ဂလာဒုံ")):
        names = [x["name"] for x in client.get("/api/mimu-search", params={"q": q}).json()["results"]]
        assert expect in names, (q, names)


def test_mimu_search_exposes_exact_township_when_verified():
    r = client.get("/api/mimu-search", params={"q": "Mingaladon"}).json()["results"]
    assert r and r[0]["type"] == "Township"
    assert r[0]["name"] == "မင်္ဂလာဒုံ"
    assert r[0]["region"] == "Yangon"


def test_mimu_town_result_does_not_invent_township():
    r = client.get("/api/mimu-search", params={"q": "Mandalay"}).json()["results"]
    assert r and r[0]["name"] == "မန္တလေး"
    # A city/town record is not silently relabelled as a township.
    assert r[0]["type"] == "Town"


def test_weather_response_declares_schema_version(monkeypatch):
    _stub_open_meteo(monkeypatch)
    r = client.get("/api/weather", params={"lat": 16.78, "lon": 96.16})
    assert r.status_code == 200
    assert r.json()["meta"]["schema_version"] == "1.0"


def test_health_reports_version_and_cache_counts():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == main.APP_VERSION
    assert set(body["cache"]) == {"weather", "climate", "geocode", "dmh"}


def test_rimes_is_preferred_when_configured(monkeypatch):
    _stub_open_meteo(monkeypatch)
    monkeypatch.setattr(main.rimes, "configured", lambda: True)

    async def rimes_fetch(_lat, _lon, _client):
        return {
            "weather": {"current": {"temperature_2m": 28.5}, "daily": {"uv_index_max": [7]}},
            "air_quality": {},
            "meta": {"provider": "RIMES", "fallback": False, "rimes": True},
        }

    monkeypatch.setattr(main.rimes, "fetch", rimes_fetch)
    r = client.get("/api/weather", params={"lat": 16.78, "lon": 96.16})
    assert r.status_code == 200
    body = r.json()
    assert body["meta"]["provider"] == "RIMES"
    assert body["weather"]["current"]["temperature_2m"] == 28.5


def test_rimes_failure_falls_back_to_open_meteo(monkeypatch):
    calls = _stub_open_meteo(monkeypatch)
    monkeypatch.setattr(main.rimes, "configured", lambda: True)

    async def broken(_lat, _lon, _client):
        raise RuntimeError("RIMES unavailable")

    monkeypatch.setattr(main.rimes, "fetch", broken)
    r = client.get("/api/weather", params={"lat": 16.78, "lon": 96.16})
    assert r.status_code == 200
    body = r.json()
    assert body["meta"]["provider"] == "Open-Meteo"
    assert body["failed_providers"][0]["provider"] == "RIMES"
    assert calls["n"] == 1
