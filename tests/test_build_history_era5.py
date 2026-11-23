"""tools/build_history_era5.py: planning, resumable download, rate limits, ENSO classes, build and safety checks.
Everything runs against a fake Open-Meteo archive that makes up daily numbers; nothing touches the network."""
import copy
import datetime as dt
import gzip
import importlib.util
import json
import math
from datetime import date, timedelta
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("era5", ROOT / "tools" / "build_history_era5.py")
era5 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(era5)

REAL_CLIENT = httpx.Client
OLD = json.loads((ROOT / "data" / "history.json").read_text(encoding="utf-8"))


def cls(year: int) -> str:
    return ("el_nino", "la_nina", "neutral")[year % 3]


def day_values(d: date, lat: float, hot: bool = False):
    seasonal = 3 * math.sin(2 * math.pi * (d.timetuple().tm_yday - 100) / 365)
    tmax = 33 + seasonal + 0.02 * (d.year - 1985) + (lat - 20) * 0.1 + (50 if hot else 0)
    wet = 6 <= d.month <= 9
    factor = {"el_nino": 0.7, "la_nina": 1.3, "neutral": 1.0}[cls(d.year)]
    rain = 10.0 * factor if wet else 0.3
    return round(tmax, 2), round(tmax - 8, 2), round(rain, 2)


def payload(lat: float, start: date, end: date, hot: bool = False, null_from: date | None = None) -> dict:
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    vals = [day_values(d, lat, hot) for d in days]
    if null_from:
        vals = [(None, None, None) if d >= null_from else v for d, v in zip(days, vals)]
    return {"elevation": 100, "daily": {"time": [d.isoformat() for d in days], "temperature_2m_max": [v[0] for v in vals],
                                        "temperature_2m_min": [v[1] for v in vals], "precipitation_sum": [v[2] for v in vals]}}


def server(log: list, fail_after: int | None = None, hot: bool = False, null_from: date | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        q = request.url.params
        if fail_after is not None and len(log) >= fail_after:
            return httpx.Response(429, json={"error": True, "reason": "Hourly API request limit exceeded."})
        start, end = date.fromisoformat(q["start_date"]), date.fromisoformat(q["end_date"])
        log.append((float(q["latitude"]), float(q["longitude"]), start, end))
        assert q["models"] == "era5" and q["timezone"] == "Asia/Yangon" and "precipitation_sum" in q["daily"]
        return httpx.Response(200, json=payload(float(q["latitude"]), start, end, hot, null_from if end >= (null_from or date.max) else None))
    return httpx.MockTransport(handler)


def oni_text() -> str:
    rows = ["SEAS  YR  TOTAL  ANOM"]
    for y in range(1985, 2101):
        a = {"el_nino": 1.0, "la_nina": -1.0, "neutral": 0.0}[cls(y)]
        rows += [f"{s} {y} 27.00 {a:.2f}" for s in era5.SEASONS]
    return "\n".join(rows)


@pytest.fixture
def box(tmp_path, monkeypatch):
    """Paths for one run, a copy of the real history file, and an httpx.Client that talks to the fake server."""
    hist = tmp_path / "history.json"
    hist.write_text(json.dumps(OLD, ensure_ascii=False), encoding="utf-8")
    oni = tmp_path / "oni.txt"
    oni.write_text(oni_text(), encoding="utf-8")
    log: list = []
    now = {"day": date(2026, 11, 22)}

    class FakeDateTime(dt.datetime):                      # the tool asks for "now"; tests fix it so they never age
        @classmethod
        def now(cls, tz=None):
            return dt.datetime(now["day"].year, now["day"].month, now["day"].day, 12, tzinfo=tz)
    monkeypatch.setattr(era5, "datetime", FakeDateTime)

    def use(transport):
        monkeypatch.setattr(era5.httpx, "Client", lambda **kw: REAL_CLIENT(transport=transport, **kw))
    use(server(log))
    argv = ["--history", str(hist), "--cache-dir", str(tmp_path / "cache"), "--normals-dir", str(tmp_path / "normals"),
            "--oni", str(oni), "--pause", "0", "--perm", "300", "--boot", "300", "--max-weight", "1000000"]
    return type("Box", (), {"hist": hist, "log": log, "argv": argv, "use": staticmethod(use), "tmp": tmp_path, "now": now})


# ------------------------------------------------------------------------------------------------- planning
def test_chunks_are_contiguous_and_only_the_running_year_is_uncached():
    today = date(2026, 11, 22)
    ch = era5.plan_chunks(today)
    assert ch[0][0] == date(1985, 1, 1) and ch[-1][1] == today - timedelta(days=6)
    for a, b in zip(ch, ch[1:]):
        assert b[0] == a[1] + timedelta(days=1)
    assert [c[2] for c in ch] == [True] * (len(ch) - 1) + [False]
    assert all((c[1] - c[0]).days <= 3660 for c in ch)
    total = sum(era5.units(c[0], c[1]) for c in ch)
    assert 1050 < total < 1150                                    # about 1,100 request units for one region


def test_units_follow_the_two_week_rule():
    assert era5.units(date(2026, 1, 1), date(2026, 1, 10)) == 1.0
    assert era5.units(date(2026, 1, 1), date(2026, 1, 28)) == 2.0


def test_year_boundaries_with_a_run_in_january():
    ch = era5.plan_chunks(date(2027, 1, 3))
    assert ch[-1][0] == date(2026, 1, 1) and ch[-1][1] == date(2026, 12, 28) and ch[-2][1] == date(2025, 12, 31)


# ------------------------------------------------------------------------------------- download and resume
def test_full_run_writes_a_file_with_the_same_shape_as_before(box):
    assert era5.main(box.argv) == 0
    new = json.loads(box.hist.read_text(encoding="utf-8"))
    assert set(new) == set(OLD) and new["kind"] == "modelled" and new["baseline"] == "1991-2020" and "ERA5" in new["source"]
    assert new["events"] == OLD["events"]
    assert len(new["regions"]) == 15
    for rid, r in new["regions"].items():
        o = OLD["regions"][rid]
        assert set(r) == set(o)
        assert (r["en"], r["my"], r["zone"], r["lat"], r["lon"]) == (o["en"], o["my"], o["zone"], o["lat"], o["lon"])
        assert r["years"][0] == 1985 and r["years"] == list(range(1985, r["years"][-1] + 1))
        assert len(r["temp"]) == len(r["rain"]) == len(r["years"]) and len(r["clim_temp"]) == len(r["clim_rain"]) == 12
        assert r["years"].index(1991) >= 0 and r["years"].index(2020) >= 0       # the client looks these up
        assert set(r["enso_by_year"]) == {str(y) for y in r["years"]}
        assert r["temp_trend_ci95"][0] <= r["temp_trend_per_decade"] <= r["temp_trend_ci95"][1]


def test_the_numbers_are_computed_the_way_the_live_views_do(box):
    assert era5.main(box.argv) == 0
    r = json.loads(box.hist.read_text(encoding="utf-8"))["regions"]["MM-06"]
    lat = era5.point_key(r["lat"], r["lon"])[0]
    # July normal: every July day of 1991-2020; temperature is (max + min) / 2
    assert r["clim_temp"][6] == pytest.approx(
        sum(day_values(date(y, 7, k), lat)[0] / 2 + day_values(date(y, 7, k), lat)[1] / 2 for y in range(1991, 2021) for k in range(1, 32)) / (30 * 31), abs=0.06)
    wet = {"el_nino": 7, "la_nina": 13, "neutral": 10}
    assert r["clim_rain"][6] == pytest.approx(sum(wet[cls(y)] * 31 for y in range(1991, 2021)) / 30, abs=1)
    assert abs(r["clim_rain"][0] - 0.3 * 31) <= 0.5                                  # a dry January
    assert r["temp_trend_per_decade"] == pytest.approx(0.2, abs=0.03)             # the made-up warming of 0.02 C a year
    g = r["jjas_by_enso"]
    assert g["el_nino"]["years"] + g["la_nina"]["years"] + g["neutral"]["years"] == len(r["years"])
    assert r["enso_vs_neutral"]["el_nino"]["pct"] == -30 and r["enso_vs_neutral"]["la_nina"]["pct"] == 30
    assert r["enso_vs_neutral"]["el_nino"]["p"] < 0.01


def test_a_rate_limit_stops_the_run_keeps_what_was_fetched_and_the_next_run_resumes(box, capsys):
    box.use(server(box.log, fail_after=7))
    before = box.hist.read_text(encoding="utf-8")
    assert era5.main(box.argv) == 2
    out = capsys.readouterr().out
    assert "Hourly API request limit exceeded" in out and "Nothing was written" in out
    assert box.hist.read_text(encoding="utf-8") == before                     # the old file is untouched
    assert len(box.log) == 7
    box.use(server(box.log))
    assert era5.main(box.argv) == 0
    fetched = list(box.log)
    # a closed chunk is never downloaded twice; only the running year of the first region (fetched before the stop) is
    assert len(fetched) - len(set(fetched)) == 1
    assert len(box.log) == 7 + (15 * 6 - 6)                                    # 6 closed chunks were already stored


def test_the_running_year_is_refetched_and_only_the_newest_copy_is_kept(box):
    assert era5.main(box.argv) == 0
    n = len(box.log)
    box.now["day"] = date(2026, 11, 23)
    assert era5.main(box.argv) == 0
    assert len(box.log) - n == 15                                              # only the 15 running-year chunks
    for region_dir in (box.tmp / "cache").iterdir():
        assert [f.name for f in region_dir.glob("2026-01-01_*")] == ["2026-01-01_2026-11-17.json.gz"]


def test_the_request_budget_stops_before_it_is_exceeded(box, capsys):
    assert era5.main(box.argv + ["--max-weight", "300"]) == 2
    assert "budget" in capsys.readouterr().out
    spent = sum(era5.units(s, e) for _, _, s, e in box.log)
    assert 0 < spent <= 300


def test_stored_1991_2020_normals_are_reused_instead_of_downloaded(box):
    key = era5.point_key(OLD["regions"]["MM-06"]["lat"], OLD["regions"]["MM-06"]["lon"])
    p = era5.normals_file(box.tmp / "normals", key)
    p.parent.mkdir(parents=True)
    with gzip.open(p, "wt", encoding="utf-8") as f:
        json.dump({"elevation": 1, "daily": payload(key[0], date(1991, 1, 1), date(2020, 12, 31))["daily"], "source": "x"}, f)
    assert era5.main(box.argv) == 0
    mm06 = [x for x in box.log if (x[0], x[1]) == key]
    assert mm06 and all(x[2].year not in (1991, 2001, 2011) for x in mm06)          # 1985-90, 2021-25 and this year only


def test_build_only_never_downloads(box):
    assert era5.main(box.argv + ["--build-only"]) == 2                          # nothing on disk yet
    assert box.log == []
    assert era5.main(box.argv) == 0
    n = len(box.log)
    assert era5.main(box.argv + ["--build-only"]) == 0
    assert len(box.log) == n


def test_loop_waits_through_a_limit_and_finishes_by_itself(box, monkeypatch, capsys):
    waits = []
    monkeypatch.setattr(era5.time, "sleep", lambda s: waits.append(s))
    state = {"n": 0}

    def flaky(request):
        state["n"] += 1
        if state["n"] in (5, 6, 40):          # three separate limit hits, one of them twice in a row
            return httpx.Response(429, json={"error": True, "reason": "Daily API request limit exceeded."})
        q = request.url.params
        return httpx.Response(200, json=payload(float(q["latitude"]), date.fromisoformat(q["start_date"]), date.fromisoformat(q["end_date"])))
    box.use(httpx.MockTransport(flaky))
    assert era5.main(box.argv + ["--loop", "--wait-seconds", "60"]) == 0
    assert waits.count(60) == 3 and "waiting 1 minutes" in capsys.readouterr().out
    assert "ERA5" in json.loads(box.hist.read_text(encoding="utf-8"))["source"]


def test_the_apps_own_normals_files_are_made_from_the_downloaded_chunks(box):
    assert era5.main(box.argv) == 0
    files = sorted((box.tmp / "normals").glob("era5_*_1991_2020.json.gz"))
    assert len(files) == len({era5.point_key(r["lat"], r["lon"]) for r in OLD["regions"].values()})
    from risk_engine.baseline import _parse
    rec = _parse(json.load(gzip.open(files[0], "rt")))               # the app's own reader accepts it
    assert rec.dates[0] == date(1991, 1, 1) and rec.dates[-1] == date(2020, 12, 31) and len(rec.dates) == 10958


def test_dry_run_prints_but_does_not_write(box, capsys):
    before = box.hist.read_text(encoding="utf-8")
    assert era5.main(box.argv + ["--dry-run"]) == 0
    assert box.hist.read_text(encoding="utf-8") == before and "nothing written" in capsys.readouterr().out


# ----------------------------------------------------------------------------------------------- safety checks
def test_impossible_values_are_refused_and_the_old_file_stays(box, capsys):
    box.use(server(box.log, hot=True))
    before = box.hist.read_text(encoding="utf-8")
    assert era5.main(box.argv) == 1
    assert "Not written" in capsys.readouterr().out and box.hist.read_text(encoding="utf-8") == before


def test_a_gap_in_the_years_is_refused(box, capsys):
    assert era5.main(box.argv + ["--dry-run"]) == 0
    first = next(iter(OLD["regions"].values()))
    key = era5.point_key(first["lat"], first["lon"])
    p = era5.chunk_path(box.tmp / "cache", key, date(1985, 1, 1), date(1990, 12, 31))
    d = json.load(gzip.open(p, "rt"))
    i = d["daily"]["time"].index("1988-03-10")
    d["daily"]["precipitation_sum"][i] = None                                   # one missing day
    era5._write_gz(p, d)
    assert era5.main(box.argv + ["--build-only", "--dry-run"]) == 1
    assert "full years are missing" in capsys.readouterr().out


def test_months_without_every_day_do_not_count():
    s = era5.daily_series([payload(20.0, date(2024, 1, 1), date(2024, 3, 31))])
    s[date(2024, 2, 10)] = (None, None, None)
    m = era5.monthly(s)
    assert m[(2024, 1)]["ok"] and m[(2024, 3)]["ok"] and not m[(2024, 2)]["ok"]
    partial = era5.monthly(era5.daily_series([payload(20.0, date(2026, 11, 1), date(2026, 11, 16))]))
    assert not partial[(2026, 11)]["ok"]


# ------------------------------------------------------------------------------------------------------ ENSO
SAMPLE_ONI = """SEAS  YR   TOTAL  ANOM
DJF 2023  26.0  -0.6
MJJ 2023  27.0   0.6
JJA 2023  27.1   0.9
JAS 2023  27.3   1.3
ASO 2023  27.5   1.6
MJJ 2024  27.0   0.1
JJA 2024  27.1  -0.1
JAS 2024  27.2  -0.2
ASO 2024  27.0  -0.3
MJJ 2025  27.0   0.6
JJA 2025  27.0   0.6
JAS 2025  27.0  -0.6
ASO 2025  27.0  -0.6
MJJ 2022  27.0  -0.9
JJA 2022  27.0  -1.0
JAS 2022  27.0  -1.0
ASO 2022  27.0  -0.5
JJA 2026  27.0   0.0
not a data line
"""


def test_oni_classes_use_the_four_seasons_centred_on_june_to_september():
    c = era5.parse_oni(SAMPLE_ONI)
    assert c == {2023: "el_nino", 2024: "neutral", 2025: "mixed", 2022: "la_nina"}     # 2026 has one season: not classed
    assert era5.phase(0.5) == "el_nino" and era5.phase(-0.5) == "la_nina" and era5.phase(0.49) == "neutral"
    assert era5.parse_oni("garbage") == {}


def test_oni_can_come_from_a_url_and_a_failure_means_fall_back(tmp_path):
    ok = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, text=SAMPLE_ONI)))
    bad = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(503)))
    assert era5.load_oni(None, ok)[2023] == "el_nino"
    assert era5.load_oni(None, bad) is None
    assert era5.load_oni(str(tmp_path / "missing.txt"), bad) is None


def test_without_oni_the_classes_already_in_the_file_are_kept(box):
    assert era5.main(box.argv + ["--oni", str(box.tmp / "missing.txt")]) == 0
    new = json.loads(box.hist.read_text(encoding="utf-8"))["regions"]["MM-06"]
    assert new["enso_by_year"] == OLD["regions"]["MM-06"]["enso_by_year"]


def test_without_oni_a_new_year_has_no_class_and_the_build_stops(box, capsys):
    box.now["day"] = date(2027, 2, 1)                                          # 2026 is now a full year; the old file has no class for it
    assert era5.main(box.argv + ["--oni", str(box.tmp / "missing.txt")]) == 1
    assert "El Nino / La Nina class for [2026]" in capsys.readouterr().out


def test_a_year_without_a_class_is_refused():
    series = {rid: era5.daily_series([payload(r["lat"], date(1985, 1, 1), date(2025, 12, 31))]) for rid, r in list(OLD["regions"].items())[:1]}
    old = copy.deepcopy(OLD)
    old["regions"] = {k: v for k, v in list(old["regions"].items())[:1]}
    with pytest.raises(ValueError, match="El Nino / La Nina class"):
        era5.build(old, series, {y: "neutral" for y in range(1985, 2020)}, date(2026, 6, 1), 50, 50)


# ------------------------------------------------------------------------------------------------- statistics
def test_slope_and_bootstrap_on_a_straight_line():
    xs = [float(y) for y in range(1985, 2026)]
    ys = [20 + 0.03 * (x - 1985) for x in xs]
    assert era5.slope(xs, ys) == pytest.approx(0.03)
    import random
    lo, hi = era5.trend_ci(xs, ys, random.Random(1), 200)
    assert lo == pytest.approx(0.3, abs=0.01) and hi == pytest.approx(0.3, abs=0.01)


def test_permutation_test_needs_three_years_and_finds_a_clear_gap():
    import random
    rng = random.Random(3)
    assert era5.perm_p([1.0, 2.0], [1.0, 2.0, 3.0], rng, 100) is None
    assert era5.perm_p([10.0, 11.0, 12.0, 13.0, 14.0], [1.0, 2.0, 3.0, 4.0, 5.0], rng, 2000) < 0.02
    assert era5.perm_p([1.0, 2.0, 3.0, 4.0], [1.0, 2.0, 3.0, 4.0], rng, 500) > 0.9


def test_the_real_history_file_still_passes_the_same_sanity_check():
    era5.check(OLD)
