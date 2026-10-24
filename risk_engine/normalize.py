"""Normalization: raw provider payloads → timezone-aware, unit-labelled series with explicit missing-data handling."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from .providers import FetchResult
from .schemas import SourceFreshness


def _parse_times(raw: list[str], tz: ZoneInfo) -> list[datetime]:
    return [datetime.fromisoformat(t).replace(tzinfo=tz) for t in raw]


@dataclass
class Series:
    times: list[datetime] = field(default_factory=list)
    values: dict[str, list[Optional[float]]] = field(default_factory=dict)

    def has(self, var: str) -> bool:
        vals = self.values.get(var)
        return bool(vals) and any(v is not None for v in vals)

    def window(self, var: str, start: datetime, end: datetime) -> list[tuple[datetime, float]]:
        """Non-null (time, value) pairs with start <= t < end."""
        vals = self.values.get(var) or []
        return [(t, v) for t, v in zip(self.times, vals, strict=True) if v is not None and start <= t < end]

    def rolling_mean(self, var: str, hours: int = 24) -> list[Optional[float]]:
        """Trailing mean requiring at least 75% of hours present (else None)."""
        vals = self.values.get(var) or []
        out: list[Optional[float]] = []
        for i in range(len(vals)):
            chunk = [v for v in vals[max(0, i - hours + 1): i + 1] if v is not None]
            out.append(sum(chunk) / len(chunk) if i + 1 >= hours and len(chunk) >= 0.75 * hours else None)
        return out


@dataclass
class DailySeries:
    dates: list[date] = field(default_factory=list)
    values: dict[str, list[Optional[float]]] = field(default_factory=dict)

    def get(self, var: str, day: date) -> Optional[float]:
        try:
            return (self.values.get(var) or [])[self.dates.index(day)]
        except (ValueError, IndexError):
            return None

    def items(self, var: str) -> list[tuple[date, Optional[float]]]:
        return list(zip(self.dates, self.values.get(var) or []))


@dataclass
class NormalizedWeather:
    lat: float
    lon: float
    tz: ZoneInfo
    elevation_m: Optional[float]
    hourly: Series
    daily: DailySeries
    air: Optional[Series]
    freshness: list[SourceFreshness]
    errors: dict[str, str] = field(default_factory=dict)

    def missing(self, variables: list[str], air: bool = False) -> list[str]:
        src = self.air if air else self.hourly
        if src is None:
            return list(variables)
        return [v for v in variables if not src.has(v)]


def _freshness(res: FetchResult, ttl_minutes: int, stale_after_minutes: int, now_utc: datetime) -> SourceFreshness:
    model = None
    if res.payload:
        model = res.payload.get("model") or ("CAMS global" if "Air Quality" in res.source else "best_match")
    age = (now_utc - res.fetched_at).total_seconds() / 60
    return SourceFreshness(source=res.source, fetched_at=res.fetched_at, model=model,
                           next_expected_update=res.fetched_at + timedelta(minutes=ttl_minutes),
                           stale=age > stale_after_minutes or res.payload is None)


def normalize(forecast: FetchResult, air: Optional[FetchResult], lat: float, lon: float,
              ttl_minutes: int = 10, stale_after_minutes: int = 180, now_utc: Optional[datetime] = None) -> NormalizedWeather:
    now_utc = now_utc or forecast.fetched_at
    errors: dict[str, str] = {}
    fp = forecast.payload or {}
    if forecast.payload is None:
        errors["forecast"] = forecast.error or "unavailable"
    tz = ZoneInfo(fp.get("timezone") if fp.get("timezone") not in (None, "GMT") else "Asia/Yangon")
    h = fp.get("hourly") or {}
    hourly = Series(_parse_times(h.get("time", []), tz), {k: v for k, v in h.items() if k != "time"})
    d = fp.get("daily") or {}
    daily = DailySeries([date.fromisoformat(x) for x in d.get("time", [])], {k: v for k, v in d.items() if k != "time"})

    air_series = None
    freshness = [_freshness(forecast, ttl_minutes, stale_after_minutes, now_utc)]
    if air is not None:
        freshness.append(_freshness(air, ttl_minutes, stale_after_minutes, now_utc))
        if air.payload:
            ah = air.payload.get("hourly") or {}
            atz = ZoneInfo(air.payload.get("timezone") if air.payload.get("timezone") not in (None, "GMT") else "Asia/Yangon")
            air_series = Series(_parse_times(ah.get("time", []), atz), {k: v for k, v in ah.items() if k != "time"})
        else:
            errors["air_quality"] = air.error or "unavailable"
    return NormalizedWeather(lat=fp.get("latitude", lat), lon=fp.get("longitude", lon), tz=tz,
                             elevation_m=fp.get("elevation"), hourly=hourly, daily=daily, air=air_series,
                             freshness=freshness, errors=errors)
