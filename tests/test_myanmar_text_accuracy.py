"""Burmese wording and number consistency: help text must agree with the scale tables, no wrong or literary words."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
J = lambda p: json.loads((ROOT / p).read_text(encoding="utf-8"))
MY, SCALES, WC = J("i18n/my.json"), J("i18n/scales.json"), J("i18n/weather_codes.json")
DIG = str.maketrans("0123456789", "၀၁၂၃၄၅၆၇၈၉")


def test_every_wmo_weather_code_has_a_label():
    wmo = {0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99}
    assert wmo <= {int(k) for k in WC}
    assert all(len(v) == 3 and v[1] for v in WC.values())


def test_rain_help_matches_scale_table_and_labels():
    text = MY["help_amount_b"]
    steps = SCALES["rain"]["steps"]
    for s in steps[2:]:  # light, moderate, heavy, very heavy, extreme use the same names in help and in the card
        assert s["my"] in text, s["my"]
    for edge in ("2.5", "15", "64", "115", "204"):
        assert edge.translate(DIG) in text, edge
    assert [s["max"] for s in steps] == [0.1, 2.5, 15.6, 64.5, 115.6, 204.5, None]  # IMD classes


def test_uv_and_aqi_bands_match_who_and_epa():
    assert [s["max"] for s in SCALES["uv"]["steps"]] == [3, 6, 8, 11, None]  # 0-2, 3-5, 6-7, 8-10, 11+
    assert [s["max"] for s in SCALES["aqi"]["steps"]] == [51, 101, 151, 201, 301, None]
    uv = MY["help_uv_b"]
    for s in SCALES["uv"]["steps"]:
        assert s["my"] in uv, s["my"]
    aqi = MY["help_aqi_b"]
    assert SCALES["aqi"]["steps"][5]["my"] in aqi and "ထိခိုက်လွယ်သူ" in aqi and "ထိခိုက်လွယ်သူ" in SCALES["aqi"]["steps"][2]["my"]


def test_known_wrong_or_literary_words_are_gone():
    blob = json.dumps(MY, ensure_ascii=False) + json.dumps(SCALES, ensure_ascii=False)
    for bad in ("ဘူတာ", "အထိခိုက်မခံ", "ရေချိန်ခွင်", "ပြီးခဲ့သော", "သိထားသင့်သော", "နေကာ သုံးပါ"):
        assert bad not in blob, bad


def test_no_zawgyi_style_syllable_start():
    # In Unicode order a syllable never starts with the vowel sign E (ေ); Zawgyi text does.
    for k, v in MY.items():
        if isinstance(v, str):
            assert not re.search(r"(^|[\s(])ေ", v), k


def test_rain_log_accuracy_text_is_spoken_burmese_and_gauge_term_is_one():
    rl = (ROOT / "rainlog.js").read_text(encoding="utf-8")
    for bad in ("စစ်ထားသည်", "နှင့်အထက်", "တွက်ထားသည်", "အာမမခံပါ။", "model ရဲ့"):
        assert bad not in rl, bad
    blob = json.dumps(MY, ensure_ascii=False) + (ROOT / "weather_script.js").read_text(encoding="utf-8")
    assert "မြစ်ရေမှတ်တိုင်" not in blob and "အတည်ပြုပြီး မှတ်တိုင်" not in blob  # river gauge = မြစ်ရေတိုင်းတာစခန်း everywhere
