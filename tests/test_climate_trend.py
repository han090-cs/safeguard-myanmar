"""30-year seasonal trend analysis (risk_engine/baseline.py DailyRecord.trend + conditions._climate_trend)."""
import random
from datetime import date, timezone

from risk_engine.baseline import Baseline, DailyRecord
from risk_engine import conditions


def _record(slope_per_year: float, noise: float = 0.4, seed: int = 7) -> DailyRecord:
    rnd = random.Random(seed)
    start, end = date(1991, 1, 1), date(2020, 12, 31)
    n = (end - start).days + 1
    tmax = [33 + slope_per_year * (start.toordinal() + i - start.toordinal()) / 365.25 + rnd.gauss(0, noise) for i in range(n)]
    return DailyRecord(start=start, tmax=tmax, tmin=[v - 9 for v in tmax], pr=[1.0] * n)


def test_warming_series_is_detected():
    tr = _record(0.04).trend("tmax", date(2026, 9, 20))
    assert tr and tr["clear"] and 0.3 < tr["slope_per_decade"] < 0.5
    assert tr["recent_minus_all"] > 0.2 and tr["n_years"] == 30


def test_flat_series_is_not_called_a_trend():
    tr = _record(0.0, noise=1.5, seed=3).trend("tmax", date(2026, 9, 20))
    assert tr and not tr["clear"]


def test_too_few_years_gives_none():
    rec = _record(0.02)
    rec.tmax[: 365 * 10] = [None] * (365 * 10)
    assert rec.trend("tmax", date(2026, 9, 20)) is None


def test_condition_has_expected_shape_and_text_is_informational():
    from types import SimpleNamespace
    bl = Baseline(lat=16.8, lon=96.2, normals=_record(0.04), recent=None)
    nw = SimpleNamespace(lat=16.8, lon=96.2, tz=timezone.utc)   # only these three attributes are used
    c = conditions._climate_trend(nw, bl, date(2026, 9, 20))
    assert c.kind == "climate_trend" and c.official_warning is False and c.signal_type == "informational"
    assert {m.key for m in c.metrics} >= {"slope_per_decade", "recent_minus_all"}
    assert "°C" in c.headline.my and "per decade" in c.headline.en
    assert "နှင့်" not in c.headline.my and "ပါသည်" not in c.headline.my
