"""Self-computed warnings from the Open-Meteo forecast. NOT official: they only say that the forecast crosses a threshold.

Thresholds (all documented here so they can be challenged):
  rain, mm per day   IMD 24 h categories: heavy 64.5, very heavy 115.6, extremely heavy 204.5
  gusts, km/h        Beaufort: gale (force 8) 62, storm (force 10) 89, hurricane force (12) 118
  waves, m           WMO sea state: rough 2.5, very rough 4, high 6
Only the next DAYS days are looked at. One alert per kind (the worst day)."""
from __future__ import annotations

from typing import Any, Optional

DAYS = 3
LEVELS = ("watch", "high", "severe")
RAIN = (64.5, 115.6, 204.5)
GUST = (62.0, 89.0, 118.0)
WAVE = (2.5, 4.0, 6.0)

_TEXT = {
    "rain": ("မိုးသည်းထန်နိုင်", "Heavy rain possible", "mm", "တစ်ရက်စာ မိုးရေချိန်", "Daily rainfall"),
    "wind": ("လေပြင်းတိုက်နိုင်", "Strong gusts possible", "km/h", "လေပြင်း အမြင့်ဆုံး", "Peak gust"),
    "waves": ("ပင်လယ်လှိုင်းကြီးနိုင်", "High waves possible", "m", "လှိုင်းအမြင့်", "Wave height"),
}


def _num(v: Any) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def _level(value: float, cuts: tuple[float, float, float]) -> Optional[str]:
    lvl = None
    for name, cut in zip(LEVELS, cuts, strict=True):
        if value >= cut:
            lvl = name
    return lvl


def _worst(dates: list, values: list, cuts, days: int = DAYS):
    best = None
    for d, v in list(zip(dates, values, strict=False))[:days]:
        v = _num(v)
        if v is not None and (best is None or v > best[1]):
            best = (d, v)
    if best is None:
        return None
    lvl = _level(best[1], cuts)
    return (best[0], best[1], lvl) if lvl else None


def compute(daily: Optional[dict], sea: Optional[dict]) -> list[dict]:
    daily = daily or {}
    dates = daily.get("time") or []
    found = []
    for kind, values, cuts in (("rain", daily.get("precipitation_sum") or [], RAIN),
                               ("wind", daily.get("wind_gusts_10m_max") or [], GUST)):
        w = _worst(dates, values, cuts)
        if w:
            found.append((kind, *w))
    if sea and sea.get("series"):
        w = _worst(sea.get("dates") or [], sea["series"], WAVE)
        if w:
            found.append(("waves", *w))
    out = []
    for kind, date, value, lvl in found:
        my, en, unit, vmy, ven = _TEXT[kind]
        out.append({"kind": kind, "level": lvl, "date": date, "value": round(value, 1), "unit": unit,
                    "title": {"my": my, "en": en}, "detail": {"my": vmy, "en": ven},
                    "official": False, "source": "Open-Meteo forecast"})
    out.sort(key=lambda a: (-LEVELS.index(a["level"]), a["date"]))
    return out
