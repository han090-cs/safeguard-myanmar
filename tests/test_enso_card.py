"""El Niño card: data comes from data/enso_status.json, the warning-system link renders under it."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_enso_json_has_warning_system_link():
    d = json.loads((ROOT / "data" / "enso_status.json").read_text(encoding="utf-8"))
    assert d["warning_system_url"].startswith("https://wai-999.github.io/El-Nino-Warning-System/")
    assert d["updated"] < d["next_update"]


def test_enso_card_uses_data_and_renders_link():
    body = (ROOT / "enso_card.js").read_text(encoding="utf-8")
    view = (ROOT / "frontend" / "src" / "small_views.jsx").read_text(encoding="utf-8")  # the card itself is drawn by Preact
    assert "e.status" in view and "e.strong_chance" in view  # no hardcoded "> 90%"
    assert "&gt; 90%" not in view and "> 90%" not in view
    assert "warning_system_url" in body and 'rel="noopener noreferrer"' in view
    assert 'draw("agriEnso"' in body and 'draw("wxEnso"' in body and "s.ws" in view  # link under both El Niño cards
    page = (ROOT / "weather.html").read_text(encoding="utf-8")
    today = page.split('data-panel="today"', 1)[1].split('data-panel="compare"', 1)[0]
    assert 'id="wxEnso"' in today  # the El Niño card is on the Today tab, not hidden in Compare


def test_enso_i18n_keys_exist_in_both_languages():
    for lang in ("my", "en"):
        j = json.loads((ROOT / "i18n" / f"{lang}.json").read_text(encoding="utf-8"))
        assert j.get("enso_strong_label") and j.get("enso_warning_system"), lang


def test_enso_api_flags_overdue_update(monkeypatch):
    import datetime as dt
    from fastapi.testclient import TestClient
    import main
    d = json.loads((ROOT / "data" / "enso_status.json").read_text(encoding="utf-8"))
    r = TestClient(main.app).get("/api/enso")
    assert r.status_code == 200
    j = r.json()
    overdue = (dt.date.today() - dt.date.fromisoformat(d["next_update"])).days > 7
    assert j["stale"] == (j["age_days"] > 45 or overdue)
    assert j["warning_system_url"] == d["warning_system_url"]
