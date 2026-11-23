from risk_engine.forecast_alerts import compute

D = {"time": ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"],
     "precipitation_sum": [10, 70, 130, 300], "wind_gusts_10m_max": [20, 30, 95, 10]}


def test_thresholds_levels_and_horizon():
    out = {a["kind"]: a for a in compute(D, None)}
    assert out["rain"]["level"] == "high" and out["rain"]["date"] == "2026-11-02"   # day 4 (300 mm) is beyond 3 days
    assert out["wind"]["level"] == "high" and out["wind"]["value"] == 95
    assert all(a["official"] is False for a in out.values())


def test_waves_and_quiet_days():
    sea = {"series": [1.0, 2.6, 4.2], "dates": ["a", "b", "c"]}
    assert [a["level"] for a in compute(None, sea)] == ["high"]
    assert compute({"time": ["x"], "precipitation_sum": [5], "wind_gusts_10m_max": [30]}, {"series": [1.0], "dates": ["x"]}) == []
    assert compute(None, None) == []
