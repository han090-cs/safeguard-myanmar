from fastapi.testclient import TestClient

from app.app import app

client = TestClient(app)


def test_legal_page_is_served_with_its_key_sections():
    for path in ("/legal", "/legal.html"):
        r = client.get(path)
        assert r.status_code == 200
        t = r.text
        assert "Open-Meteo" in t and "MIMU" in t and "DMH" in t
        assert "https://www.moezala.gov.mm/" in t and "legal-warn" not in t
        assert "<script>" not in t.replace('<script src="theme_init.js"></script>', "")   # CSP: no inline script


def test_app_links_to_the_legal_page():
    assert 'href="legal.html"' in client.get("/").text
