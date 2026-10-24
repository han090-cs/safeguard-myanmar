"""Historical baseline ("normal") for a location: ERA5 reanalysis for 1991–2020 (the WMO standard normal
period), via the Open-Meteo historical weather API with `models=era5`.

Used only for descriptive comparisons ("warmer than usual for late September", "more rain than usual in the
last 30 days"). Never a health threshold; never triggers a notice by itself.

Why ERA5: the dashboard uses ERA5 reanalysis for descriptive climate normals and trend context. It is the single historical baseline used by the Climate tab and the risk engine; it is not a health threshold.

Season window: all days within ±7 calendar days of the target date in each year (~450 values).
Rainfall categories: terciles (below / near / above normal; WMO convention). Temperature: percentile rank;
10th/90th percentiles as in the ETCCDI cool/warm day and night indices (TX10p, TX90p, TN10p, TN90p).
"""
from __future__ import annotations

import asyncio
import gzip
import json
import logging
import os
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import httpx

from .config import DATA_DIR

log = logging.getLogger("risk_engine.baseline")

ARCHIVE_URL = os.getenv("OPEN_METEO_ARCHIVE_URL", "https://archive-api.open-meteo.com/v1/archive")
PERIOD = (1991, 2020)
WINDOW_DAYS = 7
RAIN_DAYS = 30
RECENT_DAYS = 45                 # ERA5 days fetched for the rainfall anomaly and the bias estimate
MIN_OVERLAP_DAYS = 14            # fewer overlapping days → no bias correction → no temperature category
RECENT_TTL_S = 6 * 3600
FAILURE_TTL_S = 180              # after a failed request, wait this long before asking the archive again
                                 # (the archive's limits are per minute; a 30-year request weighs a lot)
MAX_CONCURRENT_FETCHES = 2       # be polite to the archive API; a 30-year request is heavy
SOURCE = "ERA5 reanalysis (ECMWF/Copernicus) via Open-Meteo, 1991–2020"
CACHE_DIR = Path(os.getenv("BASELINE_CACHE_DIR", str(DATA_DIR / "cache" / "baseline")))
VARS = "temperature_2m_max,temperature_2m_min,precipitation_sum"


def point_key(lat: float, lon: float) -> tuple[float, float]:
    """Requests and caches use coordinates rounded to 0.05° (~5 km)."""
    return round(round(lat * 20) / 20, 2), round(round(lon * 20) / 20, 2)


def _season_pos(d: date) -> float:
    """Position in the year on a 365-day circle (leap years compressed) so Feb 29 does not shift windows."""
    yday = d.timetuple().tm_yday - 1
    leap = d.year % 4 == 0 and (d.year % 100 != 0 or d.year % 400 == 0)
    return yday * 365.0 / 366.0 if leap else float(yday)


def _circ(a: float, b: float) -> float:
    d = abs(a - b) % 365.0
    return min(d, 365.0 - d)


def _quantile(sorted_vals: list[float], q: float) -> float:
    pos = (len(sorted_vals) - 1) * q
    lo, hi = int(pos), min(int(pos) + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def percentile_rank(sorted_vals: list[float], value: float) -> float:
    below = sum(1 for v in sorted_vals if v < value)
    equal = sum(1 for v in sorted_vals if v == value)
    return round(100.0 * (below + 0.5 * equal) / len(sorted_vals), 1)


def tercile(value: float, q33: float, q67: float) -> str:
    """below / near / above normal. In a dry season (q33 == q67 == 0) zero rain is 'near normal'."""
    if value < q33:
        return "below_normal"
    if value > q67:
        return "above_normal"
    return "near_normal"


def temperature_class(rank: float) -> str:
    """Percentile rank → class. 10/90 follow ETCCDI cool/warm day definitions; 33/67 are terciles."""
    if rank >= 90:
        return "much_above_normal"
    if rank > 200 / 3:
        return "above_normal"
    if rank >= 100 / 3:
        return "near_normal"
    if rank > 10:
        return "below_normal"
    return "much_below_normal"


@dataclass
class DailyRecord:
    start: date
    tmax: list[Optional[float]]
    tmin: list[Optional[float]]
    pr: list[Optional[float]]
    elevation_m: Optional[float] = None
    retrieved_at: str = ""
    dates: list[date] = field(init=False)
    pos: list[float] = field(init=False)

    def __post_init__(self) -> None:
        self.dates = [self.start + timedelta(days=i) for i in range(len(self.tmax))]
        self.pos = [_season_pos(d) for d in self.dates]

    def window(self, target: date, half: int = WINDOW_DAYS) -> list[int]:
        t = _season_pos(target)
        return [i for i, p in enumerate(self.pos) if _circ(p, t) <= half]

    def temperature_stats(self, var: str, target: date, shift: float = 0.0) -> Optional[dict]:
        vals = sorted(v + shift for v in (getattr(self, var)[i] for i in self.window(target)) if v is not None)
        if len(vals) < 100:
            return None
        return {"n": len(vals), "mean": round(sum(vals) / len(vals), 1), "p10": round(_quantile(vals, 0.10), 1),
                "p90": round(_quantile(vals, 0.90), 1), "sorted": vals}

    def yearly_means(self, var: str, target: date, min_days: int = 10) -> dict[int, float]:
        """Mean of `var` inside the season window, one value per calendar year (years with too few days skipped)."""
        vals = getattr(self, var)
        per: dict[int, list[float]] = {}
        for i in self.window(target):
            if vals[i] is not None:
                per.setdefault(self.dates[i].year, []).append(vals[i])
        return {y: sum(v) / len(v) for y, v in per.items() if len(v) >= min_days}

    def trend(self, var: str, target: date, recent_years: int = 10, min_years: int = 25) -> Optional[dict]:
        """Linear trend of the seasonal-window mean over the normal period (ordinary least squares).
        Returns slope per decade with its standard error, and the recent-years mean minus the all-years mean.
        `clear` is True only when |slope| exceeds twice its standard error (a rough 95 % screen)."""
        ym = self.yearly_means(var, target)
        if len(ym) < min_years:
            return None
        years = sorted(ym)
        n = len(years)
        xs, ys = [y - years[0] for y in years], [ym[y] for y in years]
        mx, my_ = sum(xs) / n, sum(ys) / n
        sxx = sum((x - mx) ** 2 for x in xs)
        slope = sum((x - mx) * (y - my_) for x, y in zip(xs, ys, strict=True)) / sxx
        resid = [y - (my_ + slope * (x - mx)) for x, y in zip(xs, ys, strict=True)]
        se = (sum(r * r for r in resid) / (n - 2) / sxx) ** 0.5
        recent = [ym[y] for y in years[-recent_years:]]
        return {"n_years": n, "first": years[0], "last": years[-1], "slope_per_decade": round(slope * 10, 2),
                "se_per_decade": round(se * 10, 2), "clear": abs(slope) > 2 * se,
                "recent_minus_all": round(sum(recent) / len(recent) - my_, 2), "mean": round(my_, 1)}

    def rain_totals(self, target: date, days: int = RAIN_DAYS) -> list[float]:
        """Totals of `days` consecutive days ending on each day of the season window, in every year."""
        out = []
        for i in self.window(target):
            if i - days + 1 < 0:
                continue
            chunk = self.pr[i - days + 1:i + 1]
            if all(v is not None for v in chunk):
                out.append(round(sum(chunk), 1))
        return out

    def rain_stats(self, target: date, days: int = RAIN_DAYS) -> Optional[dict]:
        totals = sorted(self.rain_totals(target, days))
        if len(totals) < 100:
            return None
        return {"n": len(totals), "median": round(_quantile(totals, 0.5), 1), "mean": round(sum(totals) / len(totals), 1),
                "q33": round(_quantile(totals, 1 / 3), 1), "q67": round(_quantile(totals, 2 / 3), 1)}

    def value(self, var: str, d: date) -> Optional[float]:
        i = (d - self.start).days
        vals = getattr(self, var)
        return vals[i] if 0 <= i < len(vals) else None

    def last_complete_day(self) -> Optional[date]:
        for d, x, n, p in zip(reversed(self.dates), reversed(self.tmax), reversed(self.tmin), reversed(self.pr), strict=True):
            if x is not None and n is not None and p is not None:
                return d
        return None


def monthly_comparison(normals: DailyRecord, ytd: DailyRecord, today: date, min_years: int = 25, min_days: int = 3) -> dict:
    """This year's monthly mean temperature and rain total against the 1991–2020 normals (same ERA5 source for both).

    Mean temperature is (daily max + daily min) / 2. A month that is not over yet is compared with the normal for the SAME
    days of the month (for example 1–12 October), so a half-finished month never looks dry or cool because it is short.
    ERA5 trails real time by several days, so the last month is usually partial. Months with fewer than `min_days` days of
    data, and future months, are left out of the comparison (`status` explains why).
    """
    year = ytd.start.year if ytd.dates else today.year
    got: dict[int, list[int]] = {}                     # month -> day numbers with a complete record
    for i, d in enumerate(ytd.dates):
        if d.year == year and ytd.tmax[i] is not None and ytd.tmin[i] is not None and ytd.pr[i] is not None:
            got.setdefault(d.month, []).append(d.day)
    by_year: dict[tuple[int, int], dict[int, tuple[float, float]]] = {}   # (year, month) -> day -> (tmean, rain)
    for i, d in enumerate(normals.dates):
        if normals.tmax[i] is None or normals.tmin[i] is None or normals.pr[i] is None:
            continue
        by_year.setdefault((d.year, d.month), {})[d.day] = ((normals.tmax[i] + normals.tmin[i]) / 2, normals.pr[i])
    months = []
    for m in range(1, 13):
        dim = (date(year + (m == 12), m % 12 + 1, 1) - date(year, m, 1)).days
        days = sorted(got.get(m, []))
        k = len(days)
        entry = {"month": m, "days": k, "days_in_month": dim, "partial": 0 < k < dim, "status": "ok"}
        if date(year, m, 1) > today or k == 0:
            entry["status"] = "future" if date(year, m, 1) > today else "no_data"
        elif k < min_days:
            entry["status"] = "too_few_days"
        else:
            use = set(days)
            t_norm, r_norm = [], []
            for (y, mm), dd in by_year.items():
                if mm != m or not use.issubset(dd):
                    continue
                t_norm.append(sum(dd[x][0] for x in use) / k)
                r_norm.append(sum(dd[x][1] for x in use))
            if len(t_norm) < min_years:
                entry["status"] = "no_normal"
            else:
                idx = {d.day: i for i, d in enumerate(ytd.dates) if d.year == year and d.month == m}
                t = sum((ytd.tmax[idx[x]] + ytd.tmin[idx[x]]) / 2 for x in use) / k
                r = sum(ytd.pr[idx[x]] for x in use)
                tn, rn = sum(t_norm) / len(t_norm), sum(r_norm) / len(r_norm)
                entry.update({"temp": round(t, 1), "temp_normal": round(tn, 1), "temp_diff": round(t - tn, 1),
                              "rain": round(r, 1), "rain_normal": round(rn, 1), "rain_diff": round(r - rn, 1)})
        months.append(entry)
    ok = [m for m in months if m["status"] == "ok"]
    summary = None
    if ok:
        rain, rain_n = sum(m["rain"] for m in ok), sum(m["rain_normal"] for m in ok)
        w = sum(m["days"] for m in ok)
        summary = {"months": len(ok), "days": w, "rain": round(rain, 1), "rain_normal": round(rain_n, 1),
                   "rain_pct": round(100 * rain / rain_n) if rain_n > 0 else None,
                   "temp_diff": round(sum(m["temp_diff"] * m["days"] for m in ok) / w, 1)}
    last = ytd.last_complete_day()
    return {"year": year, "months": months, "summary": summary, "data_through": last.isoformat() if last else None,
            "period": f"{PERIOD[0]}–{PERIOD[1]}", "normal_years": len(by_year) // 12 if by_year else 0}


@dataclass
class Baseline:
    """Normals (1991–2020) plus recent ERA5 days for one location."""
    lat: float
    lon: float
    normals: DailyRecord
    recent: Optional[DailyRecord]
    source: str = SOURCE
    period: tuple[int, int] = PERIOD


def _parse(payload: dict) -> DailyRecord:
    d = payload["daily"]
    return DailyRecord(start=date.fromisoformat(d["time"][0]), tmax=d["temperature_2m_max"], tmin=d["temperature_2m_min"],
                       pr=d["precipitation_sum"], elevation_m=payload.get("elevation"),
                       retrieved_at=datetime.now(timezone.utc).isoformat())


class RateLimited(Exception):
    pass


class BaselineStore:
    """Normals: gzip disk cache (they never change) + in-memory LRU. Recent ERA5: memory, 6 h.
    One in-flight request per key; failures return None and are recorded, never raised."""

    def __init__(self, client: Optional[httpx.AsyncClient] = None, cache_dir: Path = CACHE_DIR, max_memory: int = 64):
        self._client = client
        self.cache_dir = Path(cache_dir)
        self._normals: "OrderedDict[tuple, DailyRecord]" = OrderedDict()
        self._recent: dict[tuple, tuple[float, DailyRecord]] = {}
        self._inflight: dict[tuple, asyncio.Future] = {}
        self._failed: dict[tuple, float] = {}
        self._sem: Optional[asyncio.Semaphore] = None
        self.max_memory = max_memory
        self.fetch_count = 0
        self.last_error: Optional[str] = None
        self.last_success_at: Optional[str] = None

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()

    async def get(self, lat: float, lon: float, today: date) -> Optional[Baseline]:
        key = point_key(lat, lon)
        normals = await self._once(("n",) + key, lambda: self._normals_for(key))
        if normals is None:
            return None
        recent = await self._once(("r",) + key + (today.isoformat(),), lambda: self._recent_for(key, today))
        return Baseline(lat=key[0], lon=key[1], normals=normals, recent=recent)

    async def year_to_date(self, lat: float, lon: float, today: date) -> Optional[DailyRecord]:
        """ERA5 days from 1 January up to yesterday (fetched once per point and day; kept 6 h). None when unavailable."""
        if today.month == 1 and today.day == 1:
            return None
        key = point_key(lat, lon)
        return await self._once(("y",) + key + (today.isoformat(),), lambda: self._ytd_for(key, today))

    async def _ytd_for(self, key, today: date) -> Optional[DailyRecord]:
        rkey = ("y",) + key + (today.isoformat(),)
        hit = self._recent.get(rkey)
        if hit and time.monotonic() - hit[0] < RECENT_TTL_S:
            return hit[1]
        payload = await self._fetch(key, date(today.year, 1, 1).isoformat(), (today - timedelta(days=1)).isoformat())
        rec = _parse(payload)
        now = time.monotonic()
        for k in [k for k, (ts, _) in self._recent.items() if now - ts >= RECENT_TTL_S]:
            del self._recent[k]
        self._recent[rkey] = (now, rec)
        return rec

    def is_cached(self, lat: float, lon: float) -> bool:
        return self._path(point_key(lat, lon)).exists()

    async def ensure_normals(self, lat: float, lon: float) -> bool:
        """Download and store the 1991–2020 normals for a point if they are not on disk yet (pre-warming)."""
        key = point_key(lat, lon)
        if self._path(key).exists():
            return True
        return (await self._once(("n",) + key, lambda: self._normals_for(key))) is not None

    async def _once(self, key: tuple, make):
        """One in-flight request per key (concurrent callers share it); recent failures are not retried."""
        if key in self._inflight:
            return await asyncio.shield(self._inflight[key])
        failed_at = self._failed.get(key)
        if failed_at is not None and time.monotonic() - failed_at < FAILURE_TTL_S:
            return None
        fut = asyncio.get_running_loop().create_future()
        self._inflight[key] = fut
        try:
            value = await make()
            self._failed.pop(key, None)
            fut.set_result(value)
            return value
        except Exception as exc:                       # the baseline must never break an endpoint
            log.warning("baseline request failed for %s: %s", key, exc)
            self.last_error = f"{type(exc).__name__}: {exc}"
            self._failed[key] = time.monotonic()
            fut.set_result(None)
            return None
        finally:
            if not fut.done():                          # cancelled: release anyone waiting on this request
                fut.set_result(None)
            self._inflight.pop(key, None)

    def status(self) -> dict:
        return {"source": SOURCE, "period": f"{PERIOD[0]}–{PERIOD[1]}", "last_success_at": self.last_success_at,
                "last_error": self.last_error, "locations_in_memory": len(self._normals), "archive_requests": self.fetch_count}

    def _path(self, key) -> Path:
        return self.cache_dir / f"era5_{key[0]:.2f}_{key[1]:.2f}_{PERIOD[0]}_{PERIOD[1]}.json.gz"

    async def _normals_for(self, key) -> Optional[DailyRecord]:
        if key in self._normals:
            self._normals.move_to_end(key)
            return self._normals[key]
        p = self._path(key)
        if p.exists():
            with gzip.open(p, "rt", encoding="utf-8") as f:
                rec = _parse(json.load(f))
        else:
            payload = await self._fetch(key, f"{PERIOD[0]}-01-01", f"{PERIOD[1]}-12-31")
            rec = _parse(payload)
            try:
                self.cache_dir.mkdir(parents=True, exist_ok=True)
                tmp = p.with_suffix(".tmp")
                with gzip.open(tmp, "wt", encoding="utf-8") as f:
                    json.dump({"elevation": payload.get("elevation"), "daily": payload["daily"], "source": SOURCE},
                              f, separators=(",", ":"))
                os.replace(tmp, p)
            except OSError:
                log.warning("baseline cache not writable: %s", self.cache_dir)
        self._normals[key] = rec
        while len(self._normals) > self.max_memory:
            self._normals.popitem(last=False)
        return rec

    async def _recent_for(self, key, today: date) -> Optional[DailyRecord]:
        rkey = key + (today.isoformat(),)
        hit = self._recent.get(rkey)
        if hit and time.monotonic() - hit[0] < RECENT_TTL_S:
            return hit[1]
        payload = await self._fetch(key, (today - timedelta(days=RECENT_DAYS)).isoformat(),
                                    (today - timedelta(days=1)).isoformat())
        rec = _parse(payload)
        now = time.monotonic()
        for k in [k for k, (ts, _) in self._recent.items() if now - ts >= RECENT_TTL_S]:
            del self._recent[k]
        self._recent[rkey] = (now, rec)
        return rec

    async def _fetch(self, key, start: str, end: str) -> dict:
        if self._sem is None:
            self._sem = asyncio.Semaphore(MAX_CONCURRENT_FETCHES)
        async with self._sem:
            return await self._fetch_now(key, start, end)

    async def _fetch_now(self, key, start: str, end: str) -> dict:
        client = self._client or httpx.AsyncClient(timeout=90, headers={"User-Agent": "myanmar-weather-risk-engine/1.0"})
        self.fetch_count += 1
        try:
            last = None
            for attempt in range(3):
                try:
                    r = await client.get(ARCHIVE_URL, params={
                        "latitude": key[0], "longitude": key[1], "start_date": start, "end_date": end, "daily": VARS,
                        "timezone": "Asia/Yangon", "models": "era5"})
                    if r.status_code == 429:           # rate limited: retrying within seconds only burns quota
                        raise RateLimited(f"rate limited (429) by {ARCHIVE_URL}")
                    if r.status_code in (500, 502, 503, 504):
                        raise httpx.HTTPStatusError(f"transient {r.status_code}", request=r.request, response=r)
                    r.raise_for_status()
                    self.last_error, self.last_success_at = None, datetime.now(timezone.utc).isoformat()
                    return r.json()
                except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                    last = exc
                    await asyncio.sleep(0.5 * (2 ** attempt))
            raise last
        finally:
            if self._client is None:
                await client.aclose()
