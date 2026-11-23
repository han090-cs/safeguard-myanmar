import json
from datetime import datetime, timedelta, timezone

from risk_engine.dmh_importer import source_status


def _state(tmp, issued, status="not_a_warning", title="Low Pressure Area Condition"):
    (tmp / "official_alerts_state.json").write_text(json.dumps({"nodes": {"1": {"decision": {
        "status": status, "title_en": title, "title_my": "မြန်မာ", "issued": issued.isoformat(),
        "url_en": "https://x/en/1", "url_my": "https://x/my/1"}}}}), encoding="utf-8")


def test_recent_low_pressure_news_is_a_watch_not_an_alert(tmp_path):
    now = datetime(2026, 10, 30, 6, tzinfo=timezone.utc)
    _state(tmp_path, now - timedelta(hours=5))
    w = source_status(tmp_path, now)["watch"]
    assert len(w) == 1 and w[0]["url_en"] == "https://x/en/1"


def test_old_or_other_news_is_not_a_watch(tmp_path):
    now = datetime(2026, 10, 30, 6, tzinfo=timezone.utc)
    _state(tmp_path, now - timedelta(days=4))
    assert source_status(tmp_path, now)["watch"] == []
    _state(tmp_path, now - timedelta(hours=1), title="Weather Forecast")
    assert source_status(tmp_path, now)["watch"] == []
    _state(tmp_path, now - timedelta(hours=1), status="published")
    assert source_status(tmp_path, now)["watch"] == []
