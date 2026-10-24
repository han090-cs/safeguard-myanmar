"""Farming tab = region-first, data-on-file only. Guards the research data build, its Burmese text and the no-town-search rule."""
import json
import re
import subprocess
import sys
from pathlib import Path

from fastapi.testclient import TestClient

import main

ROOT = Path(__file__).resolve().parent.parent
RES = json.loads((ROOT / "data" / "agri_research.json").read_text(encoding="utf-8"))
AGRI = json.loads((ROOT / "data" / "agri.json").read_text(encoding="utf-8"))
NUM = re.compile(r"\d+(?:\.\d+)?")
MY_DIGITS = str.maketrans("၀၁၂၃၄၅၆၇၈၉", "0123456789")


def test_built_json_matches_csv_source():
    before = (ROOT / "data" / "agri_research.json").read_text(encoding="utf-8")
    subprocess.run([sys.executable, str(ROOT / "tools" / "build_agri_research.py")], check=True, capture_output=True)
    assert (ROOT / "data" / "agri_research.json").read_text(encoding="utf-8") == before, "run tools/build_agri_research.py"


def test_shifted_source_rows_are_repaired_and_logged():
    assert {r["record_id"] for r in RES["repairs"]} == {"C005", "C006"}
    byid = {c["id"]: c for c in RES["crops"]}
    assert "30 million tonnes" in byid["C005"]["fields"]["yield"]["en"] and byid["C005"]["source_ids"] == ["SRC001"]
    assert byid["C005"]["quality_class"] == "official" and byid["C008"]["quality_class"] == "general"


def test_every_record_has_sources_quality_and_known_source_ids():
    for c in RES["crops"] + RES["soils"] + RES["regions"]:
        assert c["source_ids"] and all(s in RES["sources"] for s in c["source_ids"]), c["id"]
    for c in RES["crops"] + RES["soils"]:
        assert c["quality_en"] and c["quality_my"] and c["quality_class"], c["id"]


def test_unknown_values_are_never_filled_in():
    for c in RES["crops"]:
        for k, f in c["fields"].items():
            if f["state"] != "value":
                assert f["en"] is None and f["my"] is None, (c["id"], k)
    assert all(s["has_measured_values"] is False for s in RES["soils"])  # bundle holds no measured soil values


def test_burmese_text_exists_and_keeps_every_number():
    for c in RES["crops"]:
        for k, f in c["fields"].items():
            if f["state"] == "value":
                assert f["my"], (c["id"], k)
    # the figures that matter must be identical in both languages
    byid = {c["id"]: c for c in RES["crops"]}
    for rid, nums in {"C004": ["2026", "27", "30"], "C005": ["2026", "27", "30"], "C006": ["20"], "C007": ["2026", "27", "2.1"]}.items():
        en, my = byid[rid]["fields"]["yield"]["en"], byid[rid]["fields"]["yield"]["my"].translate(MY_DIGITS)
        for n in nums:
            assert n in en and n in my, (rid, n)
    for r in RES["regions"]:
        for k in ("name", "scope", "climate", "main_crops", "constraints", "evidence"):
            assert r[f"{k}_my"], (r["id"], k)


def test_calendar_links_point_to_existing_zones_and_only_exact_matches():
    for r in RES["regions"]:
        if r["calendar_zone"]:
            assert r["calendar_zone"] in AGRI["zones"], r["id"]
    assert {r["id"]: r["calendar_zone"] for r in RES["regions"] if r["calendar_zone"]} == {"R01": "dry", "R02": "delta", "R03": "coastal", "R04": "hills", "R05": "hills", "R06": "hills"}
    assert next(r for r in RES["regions"] if r["id"] == "R08")["calendar_zone"] is None  # irrigated overlay: never generalised


def test_api_serves_research_and_filters_by_region():
    c = TestClient(main.app)
    full = c.get("/api/agri/research").json()
    assert len(full["regions"]) == 8 and full["dataset_version"]
    one = c.get("/api/agri/research", params={"region": "R01"}).json()
    assert [r["id"] for r in one["regions"]] == ["R01"] and {x["id"] for x in one["crops"]} >= {"C001", "C005"}
    assert c.get("/api/agri/research", params={"region": "R99"}).status_code == 404
    assert c.get("/api/agri/research", params={"region": "bad"}).status_code == 422


def test_farming_tab_has_no_town_search_or_guessed_zone():
    js = (ROOT / "agri.js").read_text(encoding="utf-8")
    # Optional town compatibility checks do not choose the farming region.
    assert "REGION=navigation.region" in js
    assert "zone.mixed" in js and "compatible:!!match" in js
    for banned in ("ZONE_RE", "loadForLocation", "__agriZone", "admin1"):
        assert banned not in js, banned
    assert "agriRegionSel" in js and "/api/agri/research" in js and "mw_region" in js
    assert "body[data-mode=\"farm\"] .search-hero{display:none" in (ROOT / "ux.css").read_text(encoding="utf-8")


def test_new_text_has_both_languages():
    for lang in ("my", "en"):
        j = json.loads((ROOT / "i18n" / f"{lang}.json").read_text(encoding="utf-8"))
        keys = {m for m in re.findall(r'L\("(agrx_[a-z_]*[a-z])"', (ROOT / "agri.js").read_text(encoding="utf-8"))}
        keys |= {f"agrx_f_{k}" for k in ("season", "sowing", "harvest", "irrigation", "water", "soil", "constraints", "management", "yield")}
        keys |= {f"agrx_b_{k}" for k in ("official", "general", "modelled", "inventory", "insufficient")}
        assert all(j.get(k) for k in keys), (lang, [k for k in keys if not j.get(k)])


def test_every_research_source_is_credited_in_third_party_notices():
    notices = (ROOT / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")
    for sid, s in RES["sources"].items():
        assert sid in notices and s["url"] in notices, sid
