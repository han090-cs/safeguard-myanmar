"""Open-Meteo providers with a bounded TTL cache, connection reuse, timeouts and retry on transient failures.

Air quality is fetched independently: if it fails, weather-based rules still run and the AQ rules report
insufficient_data instead of failing the whole assessment.
"""
from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from .config import SETTINGS, EngineSettings
from .metrics import METRICS, timer

HOURLY_FORECAST = [
    "temperature_2m", "relative_humidity_2m", "apparent_temperature", "precipitation", "weather_code",
    "wind_speed_10m", "wind_gusts_10m", "uv_index", "visibility", "shortwave_radiation", "cape",
    "wet_bulb_temperature_2m", "soil_moisture_9_to_27cm",
]
DAILY_FORECAST = [
    "temperature_2m_max", "temperature_2m_min", "precipitation_sum", "precipitation_hours", "uv_index_max",
    "wind_speed_10m_max", "wind_gusts_10m_max", "et0_fao_evapotranspiration",
]
HOURLY_AIR = ["pm2_5", "pm10", "dust", "us_aqi", "us_aqi_pm2_5", "us_aqi_pm10"]


@dataclass
class FetchResult:
    source: str
    payload: Optional[dict]
    fetched_at: datetime
    error: Optional[str] = None


class TTLCache:
    """Fresh for `ttl` seconds, then usable for another `stale_ttl` seconds while a refresh runs
    (stale-while-revalidate); dropped after that."""

    def __init__(self, ttl: int, max_entries: int, stale_ttl: int = 0):
        self.ttl, self.max_entries, self.stale_ttl = ttl, max_entries, stale_ttl
        self._data: "OrderedDict[str, tuple[float, FetchResult]]" = OrderedDict()

    def lookup(self, key: str) -> tuple[Optional[FetchResult], bool]:
        """(value, fresh). (None, False) when missing or too old even to serve stale."""
        item = self._data.get(key)
        if not item:
            return None, False
        ts, value = item
        age = time.monotonic() - ts
        if age > self.ttl + self.stale_ttl:
            self._data.pop(key, None)
            return None, False
        self._data.move_to_end(key)
        return value, age <= self.ttl

    def get(self, key: str) -> Optional[FetchResult]:
        value, fresh = self.lookup(key)
        return value if fresh else None

    def set(self, key: str, value: FetchResult) -> None:
        self._data[key] = (time.monotonic(), value)
        self._data.move_to_end(key)
        while len(self._data) > self.max_entries:
            self._data.popitem(last=False)


class OpenMeteoClient:
    def __init__(self, settings: EngineSettings = SETTINGS, client: Optional[httpx.AsyncClient] = None):
        self.settings = settings
        self._client = client or httpx.AsyncClient(timeout=settings.http_timeout_seconds,
                                                   headers={"User-Agent": "myanmar-weather-risk-engine/1.0"})
        self.cache = TTLCache(settings.cache_ttl_seconds, settings.cache_max_entries, settings.stale_while_revalidate_seconds)
        self._inflight: dict[str, asyncio.Future] = {}
        self._background: set[asyncio.Task] = set()
        self.last_error: dict[str, str] = {}
        self.last_error_at: dict[str, datetime] = {}
        self.last_success_at: dict[str, datetime] = {}

    async def aclose(self) -> None:
        for task in list(self._background):
            task.cancel()
        await self._client.aclose()

    async def _get(self, source: str, url: str, params: dict[str, Any]) -> FetchResult:
        """TTL cache → shared in-flight request (concurrent callers for the same key wait for one upstream call)
        → upstream with retries. Failures are returned as FetchResult(payload=None), never raised, and not cached."""
        key = source + "|" + "&".join(f"{k}={params[k]}" for k in sorted(params))
        cached, fresh = self.cache.lookup(key)
        if cached and fresh:
            METRICS.inc(f"cache.hit.{_slug(source)}")
            return cached
        if cached:                                     # stale-while-revalidate: answer now, refresh in background
            METRICS.inc(f"cache.stale_served.{_slug(source)}")
            if key not in self._inflight:
                task = asyncio.create_task(self._fill(key, source, url, params))
                self._background.add(task)
                task.add_done_callback(self._background.discard)
            return cached
        return await self._fill(key, source, url, params)

    async def _fill(self, key: str, source: str, url: str, params: dict[str, Any]) -> FetchResult:
        pending = self._inflight.get(key)
        if pending is not None:
            METRICS.inc(f"cache.shared_inflight.{_slug(source)}")
            return await asyncio.shield(pending)
        METRICS.inc(f"cache.miss.{_slug(source)}")
        fut = asyncio.get_running_loop().create_future()
        self._inflight[key] = fut
        try:
            result = await self._fetch(source, url, params)
            if result.payload is not None:
                self.cache.set(key, result)
            fut.set_result(result)
            return result
        finally:
            if not fut.done():
                fut.set_result(FetchResult(source, None, datetime.now(timezone.utc), error="cancelled"))
            self._inflight.pop(key, None)

    async def _fetch(self, source: str, url: str, params: dict[str, Any]) -> FetchResult:
        last_error = None
        slug = _slug(source)
        for attempt in range(self.settings.http_retries + 1):
            try:
                with timer(f"upstream.{slug}"):
                    resp = await self._client.get(url, params=params)
                if resp.status_code in (429, 500, 502, 503, 504):
                    raise httpx.HTTPStatusError(f"transient {resp.status_code}", request=resp.request, response=resp)
                resp.raise_for_status()
                result = FetchResult(source, resp.json(), datetime.now(timezone.utc))
                self.last_success_at[source] = result.fetched_at
                return result
            except (httpx.TransportError, httpx.HTTPStatusError, ValueError) as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                METRICS.inc(f"upstream.retry_or_fail.{slug}")
                if attempt < self.settings.http_retries:
                    await asyncio.sleep(0.5 * (2 ** attempt))
        METRICS.error(f"upstream.{slug}", last_error or "unknown")
        self.last_error[source] = last_error or "unknown"
        self.last_error_at[source] = datetime.now(timezone.utc)
        return FetchResult(source, None, datetime.now(timezone.utc), error=last_error)

    async def forecast(self, lat: float, lon: float) -> FetchResult:
        params = {
            "latitude": round(lat * 50) / 50, "longitude": round(lon * 50) / 50,
            "models": self.settings.forecast_model,
            "hourly": ",".join(HOURLY_FORECAST), "daily": ",".join(DAILY_FORECAST),
            "past_days": self.settings.past_days, "forecast_days": self.settings.forecast_days,
            "timezone": "Asia/Yangon", "wind_speed_unit": "kmh",
        }
        return await self._get("Open-Meteo Forecast", self.settings.forecast_url, params)

    async def air_quality(self, lat: float, lon: float) -> FetchResult:
        params = {
            "latitude": round(lat * 50) / 50, "longitude": round(lon * 50) / 50, "hourly": ",".join(HOURLY_AIR),
            "past_days": 1, "forecast_days": 4, "timezone": "Asia/Yangon",
        }
        return await self._get("Open-Meteo Air Quality (CAMS)", self.settings.air_quality_url, params)


def _slug(source: str) -> str:
    return "air_quality" if "Air" in source else "forecast" if "Forecast" in source else source.lower().replace(" ", "_")
