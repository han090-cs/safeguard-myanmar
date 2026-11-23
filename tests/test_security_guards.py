from fastapi.testclient import TestClient

from app import state
from app.app import app

client = TestClient(app)


def test_non_get_methods_are_refused():
    for m in ("post", "put", "delete", "patch"):
        r = getattr(client, m)("/api/weather?lat=1&lon=1")
        assert r.status_code == 405


def test_overlong_query_is_refused():
    assert client.get("/health?x=" + "a" * 3000).status_code == 414


def test_security_headers_present():
    r = client.get("/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cross-origin-opener-policy"] == "same-origin"
    page = client.get("/")
    csp = page.headers["content-security-policy"]
    assert "object-src 'none'" in csp and "base-uri 'self'" in csp and "form-action 'self'" in csp


def test_expensive_endpoints_have_a_tighter_budget(monkeypatch):
    monkeypatch.setattr(state, "EXPENSIVE_MAX", 3)
    state.rate_limit_buckets.clear()
    codes = [client.get("/api/geocode?name=a").status_code for _ in range(5)]   # 422 (too short) still counts
    assert 429 in codes[3:] and 429 not in codes[:3]
    state.rate_limit_buckets.clear()


def test_forwarded_for_hop_count(monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr(state, "PROXY_HOPS", 2)
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "true")
    req = SimpleNamespace(client=SimpleNamespace(host="198.51.100.4"), headers={"x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.1"})
    assert state._client_ip(req) == "203.0.113.9"


def test_like_wildcards_in_search_are_literal():
    r = client.get("/api/mimu-search?q=%25%25%25&limit=5")      # "%%%" must not match everything
    assert r.status_code == 200 and len(r.json()["results"]) < 5
