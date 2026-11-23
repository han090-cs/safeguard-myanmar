"""Japanese is a text layer over the English slot: it must cover every English key, keep placeholders, and mirror the scale/weather tables."""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def J(name):
    return json.loads((ROOT / "i18n" / name).read_text(encoding="utf-8"))




@pytest.mark.parametrize("sfx", ["", "_easy"])
def test_ja_covers_every_english_key_with_same_shape_and_placeholders(sfx):
    en, ja = J("en.json"), J(f"ja{sfx}.json")
    assert set(en) == set(ja)
    for k, e in en.items():
        j = ja[k]
        assert type(e) is type(j), k
        if isinstance(e, str):
            assert set(re.findall(r"\{\w+\}", e)) == set(re.findall(r"\{\w+\}", j)), k
            assert j.strip() or not e.strip(), k
        elif isinstance(e, list) and e:
            assert len(e) == len(j), k
        elif isinstance(e, dict):
            assert set(e) == set(j), k


@pytest.mark.parametrize("sfx", ["", "_easy"])
def test_ja_scales_and_weather_codes_match_the_base_tables(sfx):
    sc, sj = J("scales.json"), J(f"scales_ja{sfx}.json")
    assert set(sc) == set(sj)
    for k, v in sc.items():
        assert len(v["steps"]) == len(sj[k]["steps"]), k
        assert sj[k]["title"] and sj[k]["note"]
        assert all(s["n"] and s["tip"] for s in sj[k]["steps"]), k
    assert set(J("weather_codes.json")) == set(J(f"weather_codes_ja{sfx}.json"))


def test_ja_files_are_served_and_cached_offline():
    web = (ROOT / "app" / "web.py").read_text(encoding="utf-8")
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    for f in ("i18n/ja.json", "i18n/scales_ja.json", "i18n/weather_codes_ja.json", "i18n/ja_easy.json", "i18n/scales_ja_easy.json", "i18n/weather_codes_ja_easy.json"):
        assert f'"{f}"' in web and f'"./{f}"' in sw, f
