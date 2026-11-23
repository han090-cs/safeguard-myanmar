"""Every script the page loads must be served and precached; every module using L() must import it."""
import re
from pathlib import Path
from _src import source_js
from app.web import PUBLIC_FILES

ROOT = Path(__file__).resolve().parent.parent


def test_html_scripts_are_served_and_precached():
    html = (ROOT / "weather.html").read_text(encoding="utf-8")
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    for src in re.findall(r'<script[^>]+src="([^"]+\.js)"', html):
        assert src in PUBLIC_FILES, f"{src} would 404"
        assert f'"./{src}"' in sw, f"{src} missing from service-worker shell"


def test_modules_using_L_import_it():
    for p in source_js():
        t = p.read_text(encoding="utf-8")
        if p.name != "i18n.js" and re.search(r"\bL\(", t):
            assert re.search(r"import[^;]*\bL\b", t), f"{p.name} uses L() without importing it"


def test_seven_day_forecast_and_compare_tab():
    from app.providers import weather_params, uv_params
    assert weather_params(16.8, 96.1)["forecast_days"] == 7 and uv_params(16.8, 96.1)["forecast_days"] == 7
    html = (ROOT / "weather.html").read_text(encoding="utf-8")
    assert 'data-tab="compare"' in html and 'data-panel="compare"' in html
    panel = html.split('data-panel="compare"', 1)[1].split('data-panel="forecast"', 1)[0]
    assert 'id="compareCharts"' in panel
    forecast = html.split('data-panel="forecast"', 1)[1]
    assert 'data-i18n="tag_7day">၇ ရက်<' in forecast  # the forecast covers 7 days


def test_glossary_lives_in_about_not_in_tabs():
    import json
    html = (ROOT / "weather.html").read_text(encoding="utf-8")
    assert 'data-help="' not in html and 'id="aboutDialog"' in html and 'id="aboutBtn"' in html
    about = (ROOT / "about.js").read_text(encoding="utf-8")
    for needle in ("Open-Meteo", "MIMU", "Copernicus", "DMH"):
        assert needle in about, needle
    assert 'data-help="all"' in (ROOT / "frontend" / "src" / "about_view.jsx").read_text(encoding="utf-8")  # the dialog body is drawn by Preact
    js = (ROOT / "help.js").read_text(encoding="utf-8")
    ids = set(re.findall(r'"([a-z0-9]+)"', js.split("TOPICS=", 1)[1].split(";", 1)[0]))
    for lang in ("my", "en"):
        j = json.loads((ROOT / "i18n" / f"{lang}.json").read_text(encoding="utf-8"))
        for i in ids - {"today", "forecast", "compare"}:
            assert j.get(f"help_{i}_t") and j.get(f"help_{i}_b"), (lang, i)


def test_brief_and_rain_log_cards_wired():
    html = (ROOT / "weather.html").read_text(encoding="utf-8")
    # v9.24: the hourly card sits right under the current weather, above the Today panel (warnings come before it)
    assert html.index('class="current-card') < html.index('class="card glass hourly-card"') < html.index('class="metric-grid"')
    assert html.index('class="card glass hourly-card"') < html.index('data-panel="today"') < html.index('id="todayBrief"')
    assert 'id="rainLogCard"' in html.split('data-panel="compare"', 1)[1].split('data-panel="forecast"', 1)[0]
    js = "\n".join(p.read_text(encoding="utf-8") for p in source_js())  # the page code is split across modules
    assert "renderTodayBrief" in js and "rainLogSnapshot" in js and "setBriefOfficial" in js


def test_ux_layer_wired():
    html = (ROOT / "weather.html").read_text(encoding="utf-8")
    assert 'href="ux.css"' in html
    from app.web import PUBLIC_FILES as P
    assert "ux.css" in P
    assert '"./ux.css"' in (ROOT / "sw.js").read_text(encoding="utf-8")


def test_about_people_endpoint():
    from fastapi.testclient import TestClient
    import main
    r = TestClient(main.app).get("/api/about-people")
    assert r.status_code == 200 and isinstance(r.json(), list)


def test_pro_look_layer_wired_last():
    """pro.css (calmer look) loads after ux.css so it wins; deleting its <link> brings the previous look back."""
    html = (ROOT / "weather.html").read_text(encoding="utf-8")
    assert html.index('href="ux.css"') < html.index('href="pro.css"')
    from app.web import PUBLIC_FILES as P
    assert "pro.css" in P and '"./pro.css"' in (ROOT / "sw.js").read_text(encoding="utf-8")
    css = (ROOT / "pro.css").read_text(encoding="utf-8")
    assert "html.sg-dark" in css and 'html[lang="my"]' in css      # dark mode and Burmese line height are covered
