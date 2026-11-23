"""The DMH importer end to end against a fake DMH site (synthetic pages): discovery -> fetch -> classify -> supersede -> files.
Regression: write_outputs used to crash on the first published warning (zip(..., strict=True) over unequal lists)."""
import asyncio
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from risk_engine import dmh_importer as imp
from risk_engine.official import OfficialAlertStore

NOW = datetime(2026, 11, 22, 12, 0, tzinfo=timezone.utc)
HEAVY_EN = "Heavy falls are likely to be in Rakhine State and Ayeyarwady Region during the next 24 hours."
HEAVY_MY = "ရခိုင်ပြည်နယ်နှင့် ဧရာဝတီတိုင်းဒေသကြီးတို့တွင် နောက် ၂၄ နာရီအတွင်း မိုးသည်းထန်စွာ ရွာသွန်းမည်။"
WIND_EN, WIND_MY = "Strong winds are expected in Mandalay Region.", "မန္တလေးတိုင်းဒေသကြီးတွင် လေပြင်းတိုက်ခတ်မည်။"


def page(title, body, issued):
    t = issued.strftime("%Y-%m-%dT%H:%M:%SZ")
    return (f'<html><body><h1>{title}</h1><article class="node node--type-warning"><time datetime="{t}">{t}</time>'
            f'<div class="node__content"><p>{title}</p><p>{body}</p></div></article></body></html>')


def site(warnings):
    """warnings: {nid: (title_en, body_en, title_my, body_my, issued)}"""
    def handler(request):
        p = request.url.path
        if p == "/en/heavy-rainfall-warning":
            rows = "".join(f'<div class="views-row"><a href="/en/warning/{n}">{w[0]}</a></div>' for n, w in warnings.items())
            return httpx.Response(200, text=f"<html>{rows}</html>")
        for lang, i in (("en", 0), ("my", 2)):
            for n, w in warnings.items():
                if p == f"/{lang}/warning/{n}":
                    return httpx.Response(200, text=page(w[i], w[i + 1], w[4]))
        return httpx.Response(404 if p.count("/") > 1 else 200, text="<html></html>")
    return httpx.MockTransport(handler)


def run(tmp_path, warnings, now=NOW):
    async def go():
        async with httpx.AsyncClient(transport=site(warnings)) as c:
            return await imp.run_once(c, tmp_path, now=now)
    return asyncio.run(go())


@pytest.fixture(autouse=True)
def _fast(monkeypatch):
    monkeypatch.setattr(imp, "REQUEST_GAP_S", 0)


def test_a_published_warning_is_written_and_read_back_for_the_places_it_names(tmp_path):
    w = {"9001": ("Heavy Rainfall Warning", HEAVY_EN, "မိုးသည်းထန်စွာရွာသွန်းမှု သတိပေးချက်", HEAVY_MY, NOW - timedelta(hours=2))}
    summary = run(tmp_path, w)
    assert summary["nodes_by_status"] == {"published": 1}
    doc = json.loads((tmp_path / "official_alerts.json").read_text(encoding="utf-8"))
    a = doc["alerts"][0]
    assert a["id"] == "DMH-9001" and a["type"] == "heavy_rain" and a["regions"] == ["Ayeyarwady", "Rakhine"] and a["source"] == "dmh"
    assert a["valid_to"] == (NOW - timedelta(hours=2) + timedelta(hours=24)).isoformat()
    store = OfficialAlertStore(tmp_path / "official_alerts.json")
    assert [x.alert_id for x in store.for_region("Rakhine", NOW)] == ["DMH-9001"]
    assert store.for_region("Yangon", NOW) == []                                   # not named
    assert store.for_region("Rakhine", NOW + timedelta(hours=21)) != []            # issued 2 h ago, valid 24 h: 1 h left
    assert store.for_region("Rakhine", NOW + timedelta(hours=23)) == []            # over: gone


def test_a_newer_warning_of_the_same_kind_ends_the_older_one_at_its_issue_time(tmp_path):
    older, newer = NOW - timedelta(hours=10), NOW - timedelta(hours=1)
    w = {"1": ("Heavy Rainfall Warning", HEAVY_EN, "မိုးသည်းထန်စွာရွာသွန်းမှု သတိပေးချက်", HEAVY_MY, older),
         "2": ("Heavy Rainfall Warning", HEAVY_EN, "မိုးသည်းထန်စွာရွာသွန်းမှု သတိပေးချက်", HEAVY_MY, newer)}
    run(tmp_path, w)
    by = {a["id"]: a for a in json.loads((tmp_path / "official_alerts.json").read_text(encoding="utf-8"))["alerts"]}
    assert by["DMH-1"]["valid_to"] == newer.isoformat()                            # ended early
    assert by["DMH-2"]["valid_to"] == (newer + timedelta(hours=24)).isoformat()


def test_different_kinds_do_not_end_each_other(tmp_path):
    w = {"1": ("Heavy Rainfall Warning", HEAVY_EN, "မိုးသည်းထန်စွာရွာသွန်းမှု သတိပေးချက်", HEAVY_MY, NOW - timedelta(hours=3)),
         "2": ("Strong Wind Warning", WIND_EN, "လေပြင်းတိုက်ခတ်မှု သတိပေးချက်", WIND_MY, NOW - timedelta(hours=1))}
    run(tmp_path, w)
    by = {a["id"]: a for a in json.loads((tmp_path / "official_alerts.json").read_text(encoding="utf-8"))["alerts"]}
    assert by["DMH-1"]["valid_to"] == (NOW - timedelta(hours=3) + timedelta(hours=24)).isoformat()
    assert by["DMH-2"]["type"] == "strong_wind"


def test_an_expired_warning_stays_in_the_file_but_is_never_shown(tmp_path):
    w = {"7": ("Strong Wind Warning", WIND_EN, "လေပြင်းတိုက်ခတ်မှု သတိပေးချက်", WIND_MY, NOW - timedelta(hours=80))}
    run(tmp_path, w)
    store = OfficialAlertStore(tmp_path / "official_alerts.json")
    assert [a.alert_id for a in store.all()] == ["DMH-7"]
    assert store.for_region("Mandalay", NOW) == []


def test_a_second_run_changes_nothing_and_manual_entries_survive(tmp_path):
    w = {"9001": ("Heavy Rainfall Warning", HEAVY_EN, "မိုးသည်းထန်စွာရွာသွန်းမှု သတိပေးချက်", HEAVY_MY, NOW - timedelta(hours=2))}
    run(tmp_path, w)
    f = tmp_path / "official_alerts.json"
    doc = json.loads(f.read_text(encoding="utf-8"))
    doc["alerts"].append({"id": "MANUAL-1", "issuer": "DMH", "type": "heavy_rain", "regions": ["Yangon"], "valid_from": NOW.isoformat(),
                          "valid_to": (NOW + timedelta(hours=5)).isoformat(), "title": {"my": "x", "en": "x"}})
    f.write_text(json.dumps(doc), encoding="utf-8")
    run(tmp_path, w, now=NOW + timedelta(minutes=20))
    ids = sorted(a["id"] for a in json.loads(f.read_text(encoding="utf-8"))["alerts"])
    assert ids == ["DMH-9001", "MANUAL-1"]
