"""Monthly this-year-vs-normal comparison (Compare tab): pure maths plus the endpoint with a stubbed baseline store."""
import gzip
import json
from datetime import date, timedelta
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from risk_engine import api as rapi
from risk_engine.baseline import Baseline, DailyRecord, _parse, monthly_comparison

CACHE = Path(__file__).resolve().parents[1] / "risk_engine" / "data" / "cache" / "baseline"


def normals():
    with gzip.open(CACHE / "era5_22.00_96.10_1991_2020.json.gz", "rt", encoding="utf-8") as f:
        return _parse(json.load(f))


def year_like(n: DailyRecord, year: int, through: date, dt=0.0, rain_factor=1.0) -> DailyRecord:
    """A synthetic year: the normals' own day-of-year values shifted by dt and scaled, ending at `through`."""
    days = (through - date(year, 1, 1)).days + 1
    src = {(d.month, d.day): i for i, d in enumerate(n.dates) if d.year == 2000}
    tmax, tmin, pr = [], [], []
    for k in range(days):
        d = date(year, 1, 1) + timedelta(days=k)
        i = src[(d.month, d.day)] if (d.month, d.day) in src else src[(2, 28)]
        tmax.append(n.tmax[i] + dt); tmin.append(n.tmin[i] + dt); pr.append(n.pr[i] * rain_factor)
    return DailyRecord(start=date(year, 1, 1), tmax=tmax, tmin=tmin, pr=pr)


def test_year_identical_to_one_normal_year_stays_near_zero_and_partial_month_is_flagged():
    n = normals(); today = date(2026, 10, 13)
    r = monthly_comparison(n, year_like(n, 2026, date(2026, 10, 12)), today)
    m = {x["month"]: x for x in r["months"]}
    assert r["data_through"] == "2026-10-12" and r["year"] == 2026
    assert m[9]["status"] == "ok" and not m[9]["partial"] and m[9]["days"] == 30
    assert m[10]["partial"] and m[10]["days"] == 12 and m[10]["status"] == "ok"
    assert m[11]["status"] == "future" and m[12]["status"] == "future"
    assert abs(m[7]["temp_diff"]) < 1.5                      # one real year vs a 30-year mean: small, not huge


def test_partial_month_uses_same_days_of_normal_not_the_whole_month():
    n = normals(); today = date(2026, 10, 13)
    r = monthly_comparison(n, year_like(n, 2026, date(2026, 10, 12), rain_factor=1.0), today)
    oct_ = [x for x in r["months"] if x["month"] == 10][0]
    full = [x for x in monthly_comparison(n, year_like(n, 2026, date(2026, 10, 31)), date(2026, 11, 1))["months"] if x["month"] == 10][0]
    assert oct_["rain_normal"] < full["rain_normal"] * 0.7   # 12 days of normal rain, not 31
    assert abs(oct_["rain_diff"]) < 80                       # and the difference is not a fake -140 mm drought


def test_shift_and_scale_show_up_in_the_diffs():
    n = normals(); today = date(2026, 10, 13)
    base = {x["month"]: x for x in monthly_comparison(n, year_like(n, 2026, date(2026, 10, 12)), today)["months"]}
    hot = {x["month"]: x for x in monthly_comparison(n, year_like(n, 2026, date(2026, 10, 12), dt=2.0, rain_factor=2.0), today)["months"]}
    for m in (3, 6, 8):
        assert abs((hot[m]["temp_diff"] - base[m]["temp_diff"]) - 2.0) < 0.15
        assert hot[m]["rain_diff"] > base[m]["rain_diff"]


def test_too_few_days_and_missing_values():
    n = normals(); today = date(2026, 10, 3)
    r = monthly_comparison(n, year_like(n, 2026, date(2026, 10, 2)), today)
    assert [x for x in r["months"] if x["month"] == 10][0]["status"] == "too_few_days"
    y = year_like(n, 2026, date(2026, 3, 31)); y.pr[10] = None
    m = [x for x in monthly_comparison(n, y, date(2026, 4, 1))["months"] if x["month"] == 1][0]
    assert m["days"] == 30 and m["status"] == "ok"


class StubStore:
    def __init__(self, n, y): self.n, self.y = n, y
    async def get(self, lat, lon, today): return Baseline(lat=lat, lon=lon, normals=self.n, recent=None)
    async def year_to_date(self, lat, lon, today): return self.y


class StubEngine:
    def __init__(self, store): self.baseline = store


def client_with(store):
    rapi._engine = StubEngine(store)
    app = FastAPI(); app.include_router(rapi.router)
    return TestClient(app)


def test_endpoint_returns_months_and_handles_unavailable_data():
    n = normals(); today = date.today()
    ok = client_with(StubStore(n, year_like(n, today.year, today - timedelta(days=1)))) if today.month > 1 or today.day > 2 else None
    if ok:
        j = ok.get("/api/v1/monthly-compare", params={"lat": 21.98, "lon": 96.08}).json()
        assert j["available"] is True and len(j["months"]) == 12 and j["period"] == "1991–2020"
    none = client_with(StubStore(n, None)).get("/api/v1/monthly-compare", params={"lat": 21.98, "lon": 96.08}).json()
    assert none["available"] is False and none["reason"] == "year_unavailable"
    assert client_with(StubStore(n, None)).get("/api/v1/monthly-compare", params={"lat": 51, "lon": 0}).status_code in (400, 422)
    rapi._engine = None


def test_summary_and_region_param():
    n = normals(); today = date(2026, 10, 13)
    s0 = monthly_comparison(n, year_like(n, 2026, date(2026, 10, 12)), today)["summary"]
    s = monthly_comparison(n, year_like(n, 2026, date(2026, 10, 12), dt=1.0), today)["summary"]
    assert s["months"] == 10 and abs((s["temp_diff"] - s0["temp_diff"]) - 1.0) < 0.15 and s["rain_pct"] is not None
    c = client_with(StubStore(n, year_like(n, today.year, today - timedelta(days=1))))
    j = c.get("/api/v1/monthly-compare", params={"lat": 16.8, "lon": 96.1, "region": "MM-04"}).json()
    assert j["region_id"] == "MM-04" and j["region"]["en"].startswith("Mandalay") and len(j["regions"]) == 15
    assert j["location"]["lat"] == 21.98
    assert c.get("/api/v1/monthly-compare", params={"lat": 16.8, "lon": 96.1, "region": "MM-99"}).status_code == 404
    assert c.get("/api/v1/monthly-compare", params={"lat": 16.8, "lon": 96.1, "region": "bad"}).status_code == 422
    rapi._engine = None
