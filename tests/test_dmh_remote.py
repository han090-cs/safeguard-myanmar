"""Official warnings on a serverless host: the published GitHub snapshot, the Top Announcement storm news, expiry."""
import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from risk_engine import dmh_importer as imp
from risk_engine import official, remote_official

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 11, 22, 3, 0, tzinfo=timezone.utc)

EN_PAGE = """<html><body><nav><a href="/en/cyclone-news">Cyclone News</a></nav><main><article>
<p>21-11-206 According to the observations at 06:30 hrs MST today, the depression has crossed Odisha, India, moved north and weakened into a low pressure area over Odisha.</p>
<p>This is the last news for Severe Cyclonic Storm "AKVAN".</p></article></main><footer>Cyclone Warning Cyclone Warning</footer></body></html>"""
RAIN_PAGE = "<html><body><main><p>22-11-2026 06:30 hrs MST Light rain is expected in the delta region tomorrow morning.</p></main></body></html>"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for k in ("DMH_DATA_URL", "VERCEL", "DMH_IMPORT", "DMH_STALE_AFTER_MIN"):
        monkeypatch.delenv(k, raising=False)
    remote_official.reset()
    yield
    remote_official.reset()


# ------------------------------------------------------------------------------------------- where the snapshot lives
def test_remote_is_off_by_default_and_on_for_vercel(monkeypatch):
    assert remote_official.base_url() is None and not remote_official.active()
    monkeypatch.setenv("VERCEL", "1")
    assert remote_official.base_url() == "https://github.com/han090-cs/safeguard-myanmar/releases/download/dmh-data"
    monkeypatch.setenv("VERCEL_GIT_REPO_OWNER", "someone")
    monkeypatch.setenv("VERCEL_GIT_REPO_SLUG", "fork")
    assert remote_official.base_url().startswith("https://github.com/someone/fork/")
    monkeypatch.setenv("DMH_DATA_URL", "off")
    assert remote_official.base_url() is None
    monkeypatch.setenv("DMH_DATA_URL", "http://example.com/x")      # plain http to a remote host is refused
    assert remote_official.base_url() is None
    monkeypatch.setenv("DMH_DATA_URL", "https://example.com/x/")
    assert remote_official.base_url() == "https://example.com/x"


def test_vercel_does_not_run_the_in_process_importer(monkeypatch):
    assert imp.importer_enabled() and imp.update_mode() == "local"
    monkeypatch.setenv("VERCEL", "1")
    assert not imp.importer_enabled()
    assert imp.updates_enabled() and imp.update_mode() == "remote"
    monkeypatch.setenv("DMH_DATA_URL", "off")
    assert not imp.updates_enabled() and imp.update_mode() == "off"


# ------------------------------------------------------------------------------------------------- fetching and cache
def _snapshot_transport(counter, fail=False, alerts=None):
    doc = {"updated_at": NOW.isoformat(), "alerts": alerts if alerts is not None else []}

    def handler(request):
        counter.append(request.url.path)
        if fail:
            return httpx.Response(503)
        if request.url.path.endswith("official_alerts.json"):
            return httpx.Response(200, json=doc)
        return httpx.Response(200, json={"source": {"last_success_at": NOW.isoformat()}, "nodes": {}})
    return httpx.MockTransport(handler)


def test_refresh_fetches_once_per_ttl_and_keeps_the_last_good_copy(monkeypatch):
    monkeypatch.setenv("DMH_DATA_URL", "https://example.com/dmh")
    calls: list[str] = []

    async def go():
        async with httpx.AsyncClient(transport=_snapshot_transport(calls)) as c:
            assert await remote_official.refresh(c)
            assert await remote_official.refresh(c)             # inside the TTL: no new request
            assert len(calls) == 2                               # one per file
            assert remote_official.alerts_doc()["alerts"] == []
        async with httpx.AsyncClient(transport=_snapshot_transport(calls, fail=True)) as c:
            assert await remote_official.refresh(c, force=True)  # fails, but the old copy is still usable
            assert remote_official.last_error() == "HTTPStatusError"
            assert remote_official.alerts_doc() is not None
    asyncio.run(go())


def test_an_expired_copy_is_fetched_again_at_once_but_a_failure_waits_a_minute(monkeypatch):
    monkeypatch.setenv("DMH_DATA_URL", "https://example.com/dmh")
    monkeypatch.setenv("DMH_DATA_TTL_S", "30")
    calls: list[str] = []

    async def go():
        async with httpx.AsyncClient(transport=_snapshot_transport(calls)) as c:
            assert await remote_official.refresh(c)
            assert len(calls) == 2
            remote_official._cache["ok_at"] -= 31                  # the 30 s TTL has passed (the first fetch was seconds ago)
            assert await remote_official.refresh(c)
            assert len(calls) == 4                                 # fetched again: a success never blocks the next refresh
        async with httpx.AsyncClient(transport=_snapshot_transport(calls, fail=True)) as c:
            remote_official._cache["ok_at"] -= 31
            await remote_official.refresh(c)                       # fails
            n = len(calls)
            await remote_official.refresh(c)                       # inside the one-minute wait after a failure: no request
            assert len(calls) == n
            remote_official._cache["fail_at"] -= 61
            await remote_official.refresh(c)
            assert len(calls) > n
        async with httpx.AsyncClient(transport=_snapshot_transport(calls)) as c:
            remote_official._cache["fail_at"] -= 61
            assert await remote_official.refresh(c)
            assert remote_official.last_error() is None            # a success clears the error
    asyncio.run(go())


def test_refresh_rejects_garbage_and_never_stores_it(monkeypatch):
    monkeypatch.setenv("DMH_DATA_URL", "https://example.com/dmh")
    t = httpx.MockTransport(lambda r: httpx.Response(200, text="<html>not json</html>"))

    async def go():
        async with httpx.AsyncClient(transport=t) as c:
            assert not await remote_official.refresh(c)
    asyncio.run(go())
    assert remote_official.alerts_doc() is None


def test_refresh_does_nothing_when_off():
    assert asyncio.run(remote_official.refresh()) is False


# ------------------------------------------------------------------------------------- the store prefers a newer snapshot
def _alert(aid, source, to):
    return {"id": aid, "issuer": "DMH", "type": "heavy_rain", "regions": ["Myanmar"], "source": source,
            "valid_from": (NOW - timedelta(hours=2)).isoformat(), "valid_to": to.isoformat(),
            "title": {"my": "x", "en": "x"}}


def _store(tmp_path, monkeypatch, local_stamp, local_alerts):
    monkeypatch.setattr(official, "DATA_DIR", tmp_path)
    f = tmp_path / "official_alerts.json"
    f.write_text(json.dumps({"updated_at": local_stamp, "alerts": local_alerts}), encoding="utf-8")
    return official.OfficialAlertStore(f)


def test_newer_snapshot_replaces_dmh_entries_but_keeps_manual_ones(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch, (NOW - timedelta(days=3)).isoformat(),
                   [_alert("old-dmh", "dmh", NOW + timedelta(hours=1)), _alert("manual", None, NOW + timedelta(days=1))])
    monkeypatch.setenv("DMH_DATA_URL", "https://example.com/dmh")
    remote_official._cache.update({"alerts": {"updated_at": NOW.isoformat(), "alerts": [
        _alert("new-dmh", "dmh", NOW + timedelta(hours=5)), _alert("sneaky", None, NOW + timedelta(hours=5))]}})
    assert sorted(a.alert_id for a in store.all()) == ["manual", "new-dmh"]


def test_local_file_wins_when_it_is_newer_or_remote_is_off(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch, NOW.isoformat(), [_alert("local-dmh", "dmh", NOW + timedelta(hours=1))])
    remote_official._cache.update({"alerts": {"updated_at": (NOW - timedelta(hours=1)).isoformat(),
                                              "alerts": [_alert("remote", "dmh", NOW + timedelta(hours=1))]}})
    monkeypatch.setenv("DMH_DATA_URL", "https://example.com/dmh")
    assert [a.alert_id for a in store.all()] == ["local-dmh"]              # local is newer
    monkeypatch.setenv("DMH_DATA_URL", "off")
    remote_official._cache["alerts"]["updated_at"] = (NOW + timedelta(hours=1)).isoformat()
    assert [a.alert_id for a in store.all()] == ["local-dmh"]              # remote off: snapshot ignored


def test_expired_official_alerts_are_not_returned_for_a_place(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch, NOW.isoformat(),
                   [_alert("live", "dmh", NOW + timedelta(hours=3)), _alert("over", "dmh", NOW - timedelta(minutes=5))])
    assert [a.alert_id for a in store.for_region("Yangon", NOW)] == ["live"]


def test_status_uses_the_snapshot_state_when_it_saw_dmh_more_recently(tmp_path, monkeypatch):
    monkeypatch.setattr(imp, "DATA_DIR", tmp_path)
    monkeypatch.setenv("VERCEL", "1")
    (tmp_path / "official_alerts_state.json").write_text(json.dumps(
        {"source": {"last_success_at": (NOW - timedelta(days=2)).isoformat()}, "nodes": {}}), encoding="utf-8")
    assert imp.source_status(tmp_path, NOW)["stale"] is True
    remote_official._cache.update({"alerts": {"alerts": []}, "state": {
        "source": {"last_success_at": (NOW - timedelta(minutes=30)).isoformat()}, "nodes": {},
        "announcements": {"9": {"fetched_at": NOW.isoformat(), "decision": {
            "status": "published", "issued": (NOW - timedelta(hours=2)).isoformat(), "title_en": "DMH Top Announcement: Storm",
            "title_my": "DMH Top Announcement: Storm", "url_en": "https://x/en/9", "url_my": "https://x/my/9"}}}}})
    st = imp.source_status(tmp_path, NOW)
    assert st["stale"] is False and st["importer_enabled"] is True and st["update_mode"] == "remote"
    assert [w["nid"] for w in st["watch"]] == ["ta-9"]


# ---------------------------------------------------------------------------------------------- Top Announcement
def test_discovery_finds_announcement_ids_newest_first():
    html = '<a href="/en/top-announcement/135306">Read more</a><a href="/en/top-announcement/135306">x</a><a href="/my/top-announcement/99">y</a>'
    assert imp.announcement_ids(html) == ["135306", "99"]
    assert imp.announcement_ids("<html>nothing</html>") == []


def test_parse_drops_menus_and_footers():
    lines = imp.parse_announcement(EN_PAGE)
    assert not any("Cyclone News" in x or "Cyclone Warning" in x for x in lines)
    assert any("AKVAN" in x for x in lines)


def test_issue_time_is_read_from_the_page_even_with_dmh_year_typo():
    lines = imp.parse_announcement(EN_PAGE)
    issued, basis = imp.announcement_issued(lines, NOW)                    # "21-11-206" -> day and month, current year
    assert issued == datetime(2026, 11, 21, 0, 0, tzinfo=timezone.utc) and basis == "page_day_month"   # 06:30 MST
    issued, basis = imp.announcement_issued(["၂၂-၁၁-၂၀၂၆ ၀၆:၃၀"], NOW)         # Burmese digits, full year
    assert issued == datetime(2026, 11, 22, 0, 0, tzinfo=timezone.utc) and basis == "page"       # 06:30 MST
    old_issued, old_basis = imp.announcement_issued(["10-02-2026 06:30"], NOW)   # months old: read as it is, never replaced by "now"
    assert old_issued == datetime(2026, 2, 10, 0, 0, tzinfo=timezone.utc) and old_basis == "page"
    assert imp.announcement_issued(["25-11-2026 06:30"], NOW) == (None, None)    # days in the future: not a date we can trust
    assert imp.announcement_issued(["28-12-206 06:30"], NOW)[0] == datetime(2025, 12, 28, 0, 0, tzinfo=timezone.utc)  # typo year: last year's
    assert imp.announcement_issued(["no date here"], NOW) == (None, None)
    assert imp.announcement_issued(["31-02-2026 06:30"], NOW) == (None, None)   # impossible date


def test_storm_announcement_is_published_with_dmh_words_and_expires_after_36_hours():
    lines = imp.parse_announcement(EN_PAGE)
    d = imp.classify_announcement(lines, None, NOW, NOW, "135306")
    assert d["status"] == "published"
    assert d["title_en"].startswith("DMH Top Announcement: According to the observations")
    assert "21-11-206" not in d["title_en"]
    assert d["url_en"].endswith("/en/top-announcement/135306")
    state = {"announcements": {"135306": {"fetched_at": NOW.isoformat(), "decision": d}}}
    assert [a["nid"] for a in imp.active_announcements(state, NOW)] == ["ta-135306"]
    assert imp.active_announcements(state, NOW + timedelta(hours=10)) == []         # issued 21 Nov 00:00 UTC: 37 h old
    assert imp.classify_announcement(lines, None, NOW + timedelta(hours=10), NOW, "1")["status"] == "too_old"


def test_an_old_dated_announcement_is_too_old_not_new_when_first_seen_today():
    """DMH may keep an old announcement on its home page; the first time we read it, it must not look fresh."""
    lines = ["10-11-206 Severe Cyclonic Storm is expected to cross the coast during the next 24 hours."]
    d = imp.classify_announcement(lines, None, NOW, NOW, "5")
    assert d["status"] == "too_old" and d["date_basis"] == "page_day_month"
    assert imp.active_announcements({"announcements": {"5": {"fetched_at": NOW.isoformat(), "decision": d}}}, NOW) == []


def test_other_announcements_are_not_shown_as_storm_news():
    assert imp.classify_announcement(imp.parse_announcement(RAIN_PAGE), None, NOW, NOW, "2")["status"] == "not_storm"
    assert imp.classify_announcement(None, None, NOW, NOW, "3")["status"] == "no_text"


def test_unreadable_date_falls_back_to_first_seen_so_it_still_expires():
    lines = ["Severe cyclonic storm over the Bay of Bengal is expected to move north-east during the next 24 hours."]
    d = imp.classify_announcement(lines, None, NOW, NOW - timedelta(hours=40), "4")
    assert d["date_basis"] == "first_seen" and d["status"] == "too_old"


def test_long_excerpt_is_cut_at_a_word_edge():
    long = "Cyclonic storm " + "moving north " * 40
    x = imp._excerpt([long], imp.STORM_EN, 30)
    assert x.endswith("…") and len(x) <= imp.EXCERPT_CHARS + 1 and not x[:-1].endswith("mov")


def test_importer_reads_the_announcement_end_to_end(tmp_path, monkeypatch):
    monkeypatch.setattr(imp, "REQUEST_GAP_S", 0)

    def handler(request):
        p = request.url.path
        if p == "/en":
            return httpx.Response(200, text='<a href="/en/top-announcement/135306">Read more</a>')
        if p == "/en/top-announcement/135306":
            return httpx.Response(200, text=EN_PAGE)
        return httpx.Response(404)

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=imp.BASE) as c:
            return await imp.run_once(c, tmp_path, now=NOW)
    summary = asyncio.run(go())
    assert summary["announcements_by_status"] == {"published": 1}
    st = imp.source_status(tmp_path, NOW)
    assert [w["nid"] for w in st["watch"]] == ["ta-135306"] and st["last_success_at"]
    # a second run inside the re-fetch window keeps the first-seen time and does not re-read the page
    state = json.loads((tmp_path / "official_alerts_state.json").read_text())
    assert state["announcements"]["135306"]["decision"]["issued"].startswith("2026-11-21T00:00")


def test_a_failing_announcement_never_blocks_the_warnings(tmp_path, monkeypatch):
    monkeypatch.setattr(imp, "REQUEST_GAP_S", 0)

    def handler(request):
        return httpx.Response(500) if request.url.path == "/en" else httpx.Response(404)

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=imp.BASE) as c:
            return await imp.run_once(c, tmp_path, now=NOW)
    asyncio.run(go())
    assert (tmp_path / "official_alerts.json").exists()


# -------------------------------------------------------------------------------------- workflow and check script
def test_dmh_check_script(tmp_path):
    sys.path.insert(0, str(ROOT / "tools"))
    import dmh_check
    ok, msg = dmh_check.check(tmp_path, 90, NOW)
    assert not ok and "no import state" in msg
    st = tmp_path / "official_alerts_state.json"
    st.write_text(json.dumps({"source": {"last_error": "rss: ConnectTimeout"}}))
    ok, msg = dmh_check.check(tmp_path, 90, NOW)
    assert not ok and "never read" in msg and "ConnectTimeout" in msg
    st.write_text(json.dumps({"source": {"last_success_at": (NOW - timedelta(minutes=10)).isoformat()}}))
    assert dmh_check.check(tmp_path, 90, NOW)[0]
    st.write_text(json.dumps({"source": {"last_success_at": (NOW - timedelta(hours=5)).isoformat()}}))
    assert not dmh_check.check(tmp_path, 90, NOW)[0]


def test_workflow_publishes_a_release_and_commits_nothing():
    import yaml
    text = (ROOT / ".github/workflows/dmh-import.yml").read_text(encoding="utf-8")
    wf = yaml.safe_load(text)
    assert wf["permissions"] == {"contents": "write"}
    assert wf[True]["schedule"][0]["cron"] and "workflow_dispatch" in wf[True]
    assert wf["concurrency"]["cancel-in-progress"] is False
    assert "git push" not in text and "git commit" not in text            # a commit would redeploy the site on Vercel
    assert "gh release upload" in text and "--clobber" in text
    assert remote_official.RELEASE_TAG == wf["jobs"]["import"]["env"]["TAG"]
