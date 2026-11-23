"""Offline tests for the hazard feeds: sample payloads in the shape each service documents, no network."""
from fastapi.testclient import TestClient

import main
from risk_engine import feeds

USGS = {"features": [
    {"id": "us1", "properties": {"mag": 5.8, "place": "30 km N of Mandalay", "time": 1759400000000, "alert": None, "tsunami": 0,
                                 "title": "M 5.8 - 30 km N of Mandalay", "url": "https://earthquake.usgs.gov/x"},
     "geometry": {"type": "Point", "coordinates": [96.1, 22.2, 10]}},
    {"id": "us2", "properties": {"mag": 4.2, "place": "far away", "time": 1759300000000, "title": "M 4.2"},
     "geometry": {"type": "Point", "coordinates": [101.0, 10.0, 30]}},
    {"id": "bad", "properties": {"mag": None}, "geometry": {"type": "Point", "coordinates": [96, 20]}}]}

GDACS = {"features": [
    {"geometry": {"type": "Point", "coordinates": [90.5, 15.0]},
     "properties": {"eventtype": "TC", "eventid": 1001, "name": "SAMPLE", "alertlevel": "Orange", "fromdate": "2026-10-02T00:00:00",
                    "iscurrent": "true", "country": "India", "severitydata": {"severity": 111.0, "severitytext": "Tropical Storm"},
                    "url": {"report": "https://www.gdacs.org/report.aspx?eventid=1001"}}},
    {"geometry": {"type": "Polygon", "coordinates": []}, "properties": {"eventtype": "TC", "eventid": 1001, "alertlevel": "Orange"}},
    {"geometry": {"type": "Point", "coordinates": [10.0, 50.0]}, "properties": {"eventtype": "FL", "eventid": 7, "alertlevel": "Red"}}]}

FLOOD = {"daily": {"time": ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"], "river_discharge": [100.0, 140.0, 220.0, 180.0]}}


def test_parse_usgs_levels_and_skips_bad_rows():
    out = feeds.parse_usgs(USGS)
    assert [a["id"] for a in out] == ["usgs:us1", "usgs:us2"]
    assert out[0]["level"] == "watch" and out[1]["level"] == "info"
    assert out[0]["time"].startswith("2025-10-02")


def test_parse_gdacs_ignores_polygons_and_maps_alert_levels():
    out = feeds.parse_gdacs(GDACS)
    assert {a["id"] for a in out} == {"gdacs:TC:1001", "gdacs:FL:7"}
    tc = next(a for a in out if a["kind"] == "cyclone")
    assert tc["level"] == "watch" and tc["current"] is True


def test_parse_glofas_trend_is_rising_and_needs_enough_data():
    r = feeds.parse_glofas(FLOOD)
    assert r["trend"] == "rising" and r["peak"] == 220.0 and r["peak_date"] == "2026-10-06"
    assert feeds.parse_glofas({"daily": {"time": ["a"], "river_discharge": [1]}}) is None


def test_alerts_near_uses_distance_and_keeps_far_ones_out():
    alerts = feeds.parse_usgs(USGS) + [a for a in feeds.parse_gdacs(GDACS) if a["id"] == "gdacs:TC:1001"]
    near, elsewhere = feeds.alerts_near(alerts, 21.96, 96.09)  # Mandalay
    assert [a["id"] for a in near] == ["usgs:us1"] and elsewhere == 2
    assert near[0]["distance_km"] < 60


def test_endpoint_degrades_gracefully(monkeypatch):
    async def fake_regional():
        return {"alerts": feeds.parse_usgs(USGS), "errors": {"gdacs": "TimeoutError"}, "fetched_at": "2026-10-04T00:00:00+00:00"}

    async def river_fails(lat, lon):
        raise RuntimeError("down")
    monkeypatch.setattr(feeds, "pull_regional", fake_regional)
    monkeypatch.setattr(feeds, "pull_river", river_fails)
    main._feed_cache.update(at=0.0, data=None)
    main._river_cache.clear()
    j = TestClient(main.app).get("/api/hazard-feed", params={"lat": 21.96, "lon": 96.09}).json()
    assert j["alerts"][0]["id"] == "usgs:us1" and j["river"] is None
    assert "gdacs" in j["errors"] and "glofas" in j["errors"]
    main._feed_cache.update(at=0.0, data=None)


MARINE = {"daily": {"time": ["2026-10-04", "2026-10-05", "2026-10-06"], "wave_height_max": [0.9, 1.8, 1.2], "wave_period_max": [6.0, 8.5, 7.0]}}
WATER = {"daily": {"precipitation_sum": [0, 2, 0, 1, 0, 0, 3], "et0_fao_evapotranspiration": [4, 4.5, 5, 4, 4.5, 4, 4]},
         "hourly": {"soil_moisture_0_to_7cm": [0.30] * 24 + [0.28] * 96 + [0.22] * 24}}


def test_parse_marine_peak_and_inland_none():
    r = feeds.parse_marine(MARINE)
    assert r["peak"] == 1.8 and r["peak_date"] == "2026-10-05" and r["peak_period_s"] == 8.5
    assert feeds.parse_marine({"daily": {"time": [], "wave_height_max": []}}) is None
    assert feeds.parse_marine({}) is None


def test_parse_field_water_balance_and_soil_trend():
    r = feeds.parse_field_water(WATER)
    assert r["rain_mm"] == 6.0 and r["et0_mm"] == 30.0 and r["balance_mm"] == -24.0
    assert r["soil_trend"] == "drying" and r["soil_now_pct"] == 30.0 and r["soil_end_pct"] == 22.0
    assert feeds.parse_field_water({"daily": {"precipitation_sum": [1], "et0_fao_evapotranspiration": [1]}}) is None
    short = feeds.parse_field_water({"daily": WATER["daily"], "hourly": {"soil_moisture_0_to_7cm": [0.3] * 10}})
    assert short["soil_trend"] is None


def test_local_extras_endpoint_and_no_caching_of_total_failure(monkeypatch):
    calls = {"n": 0}

    async def fake(lat, lon):
        calls["n"] += 1
        return {"sea": None, "water": feeds.parse_field_water(WATER), "errors": {}} if calls["n"] > 1 else {"sea": None, "water": None, "errors": {"water": "X", "marine": "Y"}}
    monkeypatch.setattr(feeds, "pull_extras", fake)
    main._extras_cache.clear()
    c = TestClient(main.app)
    assert c.get("/api/local-extras", params={"lat": 20.0, "lon": 96.0}).json()["water"] is None   # failure not cached
    assert c.get("/api/local-extras", params={"lat": 20.0, "lon": 96.0}).json()["water"]["balance_mm"] == -24.0
    assert c.get("/api/local-extras", params={"lat": 20.0, "lon": 96.0}).json()["water"]["balance_mm"] == -24.0
    assert calls["n"] == 2
    main._extras_cache.clear()


EONET = {"events": [
    {"id": "EONET_1", "title": "Wildfire A", "closed": None, "categories": [{"id": "wildfires"}],
     "sources": [{"url": "https://example.org/a"}], "geometry": [{"date": "2026-11-01T00:00:00Z", "type": "Point", "coordinates": [-120.5, 38.2]}]},
    {"id": "EONET_2", "title": "Storm B", "closed": None, "categories": [{"id": "severeStorms"}],
     "geometry": [{"date": "2026-11-02T00:00:00Z", "magnitudeValue": 85, "magnitudeUnit": "kts", "coordinates": [140.1, 18.0]}]},
    {"id": "EONET_3", "title": "Closed", "closed": "2026-10-30T00:00:00Z", "categories": [{"id": "wildfires"}],
     "geometry": [{"date": "2026-10-20T00:00:00Z", "coordinates": [1, 2]}]},
    {"id": "EONET_4", "title": "Sea ice", "closed": None, "categories": [{"id": "seaLakeIce"}],
     "geometry": [{"date": "2026-10-20T00:00:00Z", "coordinates": [1, 2]}]},
    {"id": "EONET_5", "title": "Polygon", "closed": None, "categories": [{"id": "floods"}],
     "geometry": [{"date": "2026-10-20T00:00:00Z", "coordinates": [[[10.0, 20.0], [11.0, 20.0], [10.0, 21.0]]]}]}]}


def test_parse_eonet_keeps_open_known_events_with_a_point():
    out = feeds.parse_eonet(EONET)
    assert [a["id"] for a in out] == ["eonet:EONET_1", "eonet:EONET_2", "eonet:EONET_5"]
    assert out[0]["kind"] == "wildfire" and out[0]["url"] == "https://example.org/a" and out[0]["lat"] == 38.2
    assert out[1]["kind"] == "storm" and out[1]["magnitude"] == 85
    assert (out[2]["lat"], out[2]["lon"]) == (20.0, 10.0)


def test_merge_world_dedupes_quakes_and_sorts_by_severity():
    q1 = {"id": "usgs:1", "source": "USGS", "kind": "earthquake", "level": "warning", "lat": 10.0, "lon": 120.0, "time": "2026-11-01T10:00:00+00:00"}
    q2 = {"id": "gdacs:EQ:1", "source": "GDACS", "kind": "earthquake", "level": "watch", "lat": 10.2, "lon": 120.1, "time": "2026-11-01T10:30:00"}
    f = {"id": "eonet:1", "source": "NASA EONET", "kind": "wildfire", "level": "info", "lat": 0.0, "lon": 0.0, "time": "2026-11-03T00:00:00Z"}
    out = feeds.merge_world([f, q2, q1])
    assert [a["id"] for a in out] == ["usgs:1", "eonet:1"]


def test_world_hazards_endpoint_caches_and_survives_a_total_failure(monkeypatch):
    import app.api as api
    calls = {"n": 0}

    async def fake():
        calls["n"] += 1
        return {"alerts": [{"id": "x", "kind": "storm", "level": "info", "lat": 1, "lon": 2}] if calls["n"] == 1 else [],
                "errors": {"usgs": "ReadTimeout"} if calls["n"] > 1 else {}, "fetched_at": "t"}
    monkeypatch.setattr(feeds, "pull_world", fake)
    api._world_cache.update(at=0.0, data=None)
    c = TestClient(main.app)
    j = c.get("/api/world-hazards").json()
    assert len(j["alerts"]) == 1 and j["stale"] is False
    assert c.get("/api/world-hazards").json()["alerts"] and calls["n"] == 1      # cached
    api._world_cache["at"] = 0.0
    j = c.get("/api/world-hazards").json()                                        # all sources failed -> last good copy
    assert len(j["alerts"]) == 1 and j["stale"] is True
    api._world_cache.update(at=0.0, data=None)
    assert c.get("/api/world-hazards").status_code == 503                         # nothing to show: error, not an empty "all clear"
    assert api._world_cache["data"] is None
    api._world_cache.update(at=0.0, data=None)


def test_drop_expired_keeps_only_what_is_still_going_on():
    from datetime import datetime, timedelta, timezone
    from risk_engine import feeds
    now = datetime(2026, 11, 21, 6, tzinfo=timezone.utc)
    ago = lambda **k: (now - timedelta(**k)).isoformat()  # noqa: E731
    rows = [
        {"id": "q-new", "kind": "earthquake", "time": ago(hours=20)},
        {"id": "q-old", "kind": "earthquake", "time": ago(days=4)},
        {"id": "q-gdacs-old", "kind": "earthquake", "time": ago(days=5), "current": True},   # a quake is judged by its age
        {"id": "tc-over", "kind": "cyclone", "time": ago(days=6), "current": False},
        {"id": "tc-live", "kind": "cyclone", "time": ago(days=6), "current": True},
        {"id": "fl-over", "kind": "flood", "time": ago(days=2), "current": False},
        {"id": "eonet-storm", "kind": "storm", "time": ago(days=9)},                         # no "ended" flag: kept (the source lists open events only)
        {"id": "q-no-time", "kind": "earthquake", "time": None},
    ]
    kept = {a["id"] for a in feeds.drop_expired(rows, now)}
    assert kept == {"q-new", "tc-live", "eonet-storm", "q-no-time"}


def test_world_and_regional_pulls_apply_the_expiry(monkeypatch):
    import asyncio
    from datetime import datetime, timedelta, timezone
    from risk_engine import feeds
    old = (datetime.now(timezone.utc) - timedelta(days=6)).isoformat()
    over = {"id": "gdacs:TC:1", "source": "GDACS", "kind": "cyclone", "level": "watch", "title": "over", "time": old, "lat": 15, "lon": 90, "current": False}
    live = {**over, "id": "gdacs:TC:2", "title": "live", "current": True}

    async def fake(_client):
        return [over, live]

    monkeypatch.setattr(feeds, "SOURCES", {"x": fake})
    monkeypatch.setattr(feeds, "WORLD_SOURCES", {"x": fake})
    assert [a["id"] for a in asyncio.run(feeds.pull_regional())["alerts"]] == ["gdacs:TC:2"]
    assert [a["id"] for a in asyncio.run(feeds.pull_world())["alerts"]] == ["gdacs:TC:2"]
