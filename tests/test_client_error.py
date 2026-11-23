"""Anonymous crash notes: GET /api/client-error only logs a scrubbed line (no IP, no place) and stays inside the read-only, rate-limited API."""
import logging

from fastapi.testclient import TestClient

from app import api, state
from app.app import app

client = TestClient(app)
UA_ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36"


def _notes(caplog):
    return [r.getMessage() for r in caplog.records if r.name == "myanmar_weather.client"]


def test_note_is_logged_without_ip_and_with_browser_family_only(caplog):
    api._client_notes.update(start=0.0, n=0.0)
    with caplog.at_level(logging.WARNING, logger="myanmar_weather.client"):
        r = client.get("/api/client-error?t=error&m=x%20is%20undefined&f=brief.js&l=12&c=3&lang=my&tab=today",
                       headers={"user-agent": UA_ANDROID, "x-forwarded-for": "203.0.113.77"})
    assert r.status_code == 204 and r.content == b""
    line = _notes(caplog)[0]
    assert "x is undefined" in line and "brief.js:12:3" in line and "lang=my" in line and "tab=today" in line
    assert "browser=Chrome/Android" in line
    assert "203.0.113.77" not in line and "SM-A546B" not in line and "testclient" not in line      # no IP, no device model


def test_urls_and_coordinates_are_scrubbed_from_the_message(caplog):
    api._client_notes.update(start=0.0, n=0.0)
    msg = "Failed to parse URL https://api.example.com/api/weather?lat=16.84001&lon=96.17002 near 16.84001,96.17002"
    with caplog.at_level(logging.WARNING, logger="myanmar_weather.client"):
        assert client.get("/api/client-error", params={"m": msg, "t": "promise"}).status_code == 204
    line = _notes(caplog)[0]
    assert "16.84" not in line and "96.17" not in line and "lat=" not in line and "api.example.com" not in line
    assert "/api/weather" in line


def test_control_characters_cannot_forge_a_second_log_line(caplog):
    api._client_notes.update(start=0.0, n=0.0)
    with caplog.at_level(logging.WARNING, logger="myanmar_weather.client"):
        client.get("/api/client-error", params={"m": "ok\r\nclient-error kind=fake"})
    assert len(_notes(caplog)) == 1 and "\n" not in _notes(caplog)[0] and "\r" not in _notes(caplog)[0]


def test_bad_values_are_refused_and_nothing_is_logged(caplog):
    api._client_notes.update(start=0.0, n=0.0)
    with caplog.at_level(logging.WARNING, logger="myanmar_weather.client"):
        assert client.get("/api/client-error?t=evil").status_code == 422
        assert client.get("/api/client-error?lang=xx").status_code == 422
        assert client.get("/api/client-error?tab=../etc").status_code == 422
        assert client.get("/api/client-error", params={"m": "a" * 241}).status_code == 422
        assert client.get("/api/client-error?l=-1").status_code == 422
    assert _notes(caplog) == []


def test_log_volume_is_capped(monkeypatch, caplog):
    monkeypatch.setattr(api, "_CLIENT_NOTES_PER_WINDOW", 3)
    api._client_notes.update(start=0.0, n=0.0)
    with caplog.at_level(logging.WARNING, logger="myanmar_weather.client"):
        codes = [client.get("/api/client-error", params={"m": f"e{i}"}).status_code for i in range(8)]
    assert set(codes) == {204} and len(_notes(caplog)) == 3        # the caller is never told; the log just stops growing


def test_still_read_only_and_rate_limited(monkeypatch):
    assert client.post("/api/client-error", content=b"x").status_code == 405
    monkeypatch.setattr(state, "RATE_LIMIT_MAX", 2)
    state.rate_limit_buckets.clear()
    codes = [client.get("/api/client-error").status_code for _ in range(4)]
    assert 429 in codes[2:]
    state.rate_limit_buckets.clear()


def test_service_worker_never_caches_it_and_script_is_served():
    sw = (state.ROOT / "sw.js").read_text(encoding="utf-8")
    assert '"/api/client-error"' in sw and "./error_report.js" in sw
    js = client.get("/error_report.js")
    assert js.status_code == 200 and "doNotTrack" in js.text and "globalPrivacyControl" in js.text
    assert "error_report.js" in client.get("/").text
