"""Explicit data contracts for the hand-maintained data files (no extra dependency): wrong shapes fail here, not in a visitor's browser."""
import datetime as dt
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
J = lambda p: json.loads((ROOT / p).read_text(encoding="utf-8"))
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def test_enso_status_contract():
    d = J("data/enso_status.json")
    for k in ("updated", "next_update", "source", "url", "status", "dmh_url", "strong_chance", "historic_chance_ond", "warning_system_url"):
        assert d.get(k), k
    assert ISO.match(d["updated"]) and ISO.match(d["next_update"])
    assert dt.date.fromisoformat(d["updated"]) < dt.date.fromisoformat(d["next_update"])
    assert d["url"].startswith("https://") and d["warning_system_url"].startswith("https://")
    assert re.search(r"\d", d["strong_chance"]) and d["historic_chance_ond"].endswith("%")


def test_agri_calendar_contract():
    d = J("data/agri.json")
    assert ISO.match(d["updated"]) and set(d["zones"]) == {"delta", "dry", "hills", "coastal"}
    for zk, z in d["zones"].items():
        for k in ("my", "en", "states", "soil_my", "soil_en", "beh"):
            assert z.get(k), (zk, k)
        for b in z["beh"]:
            assert b["my"] and b["en"] and b["s"] in d["sources"], (zk, b)
    ids = set()
    for c in d["crops"]:
        assert c["id"] not in ids; ids.add(c["id"])
        assert c["my"] and c["en"] and c["v"] in ("v", "p", "u") and c["zones"] and set(c["zones"]) <= set(d["zones"]), c["id"]
        for key in ("plant", "harvest"):
            for a, b in c.get(key) or []:
                assert 1 <= a <= 12 and 1 <= b <= 12, (c["id"], key)
        assert set(c.get("src", [])) <= set(d["sources"]), c["id"]
    assert sorted(map(int, d["monthly_general"])) == list(range(1, 13))
    for m in d["monthly_general"].values():
        assert m["prep"] and m["care"]
    for f in d["fert"]["verified"]:
        assert f["my"] and f["en"] and f["s"] in d["sources"]
    for s in d["sources"].values():
        assert s["n"]


def test_history_contract():
    d = J("data/history.json")
    assert ISO.match(d["generated"]) and d["baseline"] == "1991-2020" and d["kind"] == "modelled"
    assert len(d["regions"]) == 15
    for rid, r in d["regions"].items():
        assert re.fullmatch(r"MM-\d{2}", rid) and r["en"] and r["my"] and -90 < r["lat"] < 90 and -180 < r["lon"] < 180
        assert r["years"] == sorted(r["years"]) and len(r["temp"]) == len(r["years"]), rid


def test_translation_keys_have_meaningful_names():
    # keys used to be content hashes (s_0b8597710f); a name should say what the text is for
    for lang in ("my", "en"):
        bad = [k for k in J(f"i18n/{lang}.json") if re.fullmatch(r"(s|html)_[0-9a-f]{10}", k)]
        assert not bad, bad[:5]
