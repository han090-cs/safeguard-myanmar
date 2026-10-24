"""Regressions reported from real use: Change-place button dead, 7-day forecast, data time next to the temperature."""
import json
import re
from pathlib import Path
from _src import source_js

ROOT = Path(__file__).resolve().parent.parent
JS = {p.name: p.read_text(encoding="utf-8") for p in source_js() if not p.name.endswith(".config.js")}
HTML = (ROOT / "weather.html").read_text(encoding="utf-8")
I = {lang: json.loads((ROOT / "i18n" / f"{lang}.json").read_text(encoding="utf-8")) for lang in ("my", "en")}


def test_every_data_act_button_in_the_page_has_a_handler():
    # the 6.16.0 rewrite of agri.js silently dropped the handler of the "Change place" button
    acts = set(re.findall(r'data-act="([\w-]+)"', HTML))
    assert "pick" in acts
    for act in acts:
        assert any(re.search(r'data-act=\\?"?' + act + r'\b', t) or f'"{act}"' in t for t in JS.values()), f"no handler for data-act={act}"


def test_change_place_button_opens_the_search_again():
    agri = JS["agri.js"]
    assert '[data-act=pick]' in agri and 'classList.add("show-hero")' in agri and "locationInput" in agri


def test_forecast_is_seven_days_everywhere():
    from app.providers import uv_params, weather_params
    assert weather_params(16.8, 96.1)["forecast_days"] == 7 and uv_params(16.8, 96.1)["forecast_days"] == 7
    assert "၇ ရက်</button>" in HTML and 'class="source-tag">7-day<' in HTML
    for lang, word in (("my", "၇"), ("en", "7")):
        assert word in I[lang]["sevenDay"] and word in I[lang]["tabForecast"]
    blob = json.dumps(I["my"], ensure_ascii=False) + json.dumps(I["en"]) + "".join(JS[f] for f in ("help.js", "about.js"))
    assert "၁၀ ရက်စာ ခန့်မှန်း" not in blob and "10-day forecast" not in blob and "8–10 only" not in blob


def test_time_pill_shows_data_time_and_temperature_help_exists():
    main = "".join(JS[f] for f in ("weather_script.js", "render_cards.js") if f in JS)
    assert "updated_data_time" in main and "c.time" in main  # date + hour of the data, not the moment the page was drawn
    for lang in ("my", "en"):
        assert I[lang]["updated_data_time"] and I[lang]["help_temp_t"] and I[lang]["help_temp_b"]
    assert '"temp"' in JS["help.js"]
