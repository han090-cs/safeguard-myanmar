"""Public-launch guards: proxy-aware visitor IP / public URL, share image, placeholders never leak."""
import json
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

import main
from app import state

ROOT = Path(__file__).resolve().parent.parent


def _req(peer, headers=None, base="http://127.0.0.1:8000/", scheme="http"):
    return SimpleNamespace(client=SimpleNamespace(host=peer), headers=headers or {}, base_url=base, url=SimpleNamespace(scheme=scheme))


def test_visitors_behind_local_proxy_get_their_own_rate_bucket(monkeypatch):
    monkeypatch.delenv("TRUST_PROXY_HEADERS", raising=False)
    assert state._client_ip(_req("127.0.0.1", {"x-forwarded-for": "203.0.113.7"})) == "203.0.113.7"
    # a local proxy appends the real peer on the right; anything the client wrote on the left is forgeable
    assert state._client_ip(_req("::1", {"x-forwarded-for": "6.6.6.6, 203.0.113.8"})) == "203.0.113.8"


def test_remote_peers_cannot_spoof_forwarded_for(monkeypatch):
    monkeypatch.delenv("TRUST_PROXY_HEADERS", raising=False)
    assert state._client_ip(_req("198.51.100.4", {"x-forwarded-for": "1.2.3.4"})) == "198.51.100.4"
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "true")
    assert state._client_ip(_req("198.51.100.4", {"x-forwarded-for": "1.2.3.4"})) == "1.2.3.4"


def test_public_base_follows_proxy_headers(monkeypatch):
    monkeypatch.setattr(state, "PUBLIC_BASE_URL", "")
    r = _req("127.0.0.1", {"x-forwarded-host": "weather.example.com", "x-forwarded-proto": "https"})
    assert state.public_base(r) == "https://weather.example.com"
    bad = _req("127.0.0.1", {"x-forwarded-host": 'evil"><script>', "x-forwarded-proto": "https"})
    assert state.public_base(bad) == "http://127.0.0.1:8000"
    monkeypatch.setattr(state, "PUBLIC_BASE_URL", "https://mine.example")
    assert state.public_base(r) == "https://mine.example"


def test_pages_have_no_unfilled_placeholders_and_share_image():
    c = TestClient(main.app)
    for path in ("/", "/weather.html"):
        body = c.get(path).text
        assert "__PUBLIC_BASE_URL__" not in body, path
        assert 'property="og:image"' in body and "/og-image.png" in body
    img = c.get("/og-image.png")
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"
    assert json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["start_url"] == "./"
    assert "TRUST_PROXY_HEADERS=true" in (ROOT / "deploy/ubuntu/myanmar-weather.service").read_text(encoding="utf-8")
