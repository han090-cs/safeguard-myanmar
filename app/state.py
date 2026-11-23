"""Shared runtime configuration and bounded in-process state."""
from __future__ import annotations

import asyncio
import os
import re
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

from risk_engine.flood_hub import FloodHubClient
from risk_engine.official import OfficialAlertStore

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
VERSION_FILE = ROOT / "VERSION"
if not VERSION_FILE.exists():
    raise RuntimeError("VERSION file is required; it is the single source of release/cache versioning")
APP_VERSION = VERSION_FILE.read_text(encoding="utf-8").strip()
if not APP_VERSION:
    raise RuntimeError("VERSION file is empty")
CACHE_VERSION = "weather-v" + APP_VERSION

CACHE_TTL = int(os.getenv("WEATHER_CACHE_TTL", "900"))
CLIMATE_CACHE_TTL = int(os.getenv("CLIMATE_CACHE_TTL", "86400"))
GEOCODE_CACHE_TTL = int(os.getenv("GEOCODE_CACHE_TTL", "2592000"))
WEATHER_STALE_TTL = int(os.getenv("WEATHER_STALE_TTL", "21600"))
MAX_CACHE_ITEMS = 300
REQUEST_TIMEOUT = float(os.getenv("WEATHER_HTTP_TIMEOUT", "12"))
RATE_LIMIT_MAX = int(os.getenv("RATE_LIMIT_MAX", "600"))
RATE_LIMIT_WINDOW = float(os.getenv("RATE_LIMIT_WINDOW", "60"))
RATE_LIMIT_MAX_CLIENTS = 5000
# Endpoints that fan out to upstream services get their own, tighter budget per client.
EXPENSIVE_PREFIXES = ("/api/weather", "/api/climate", "/api/history", "/api/forecast-alerts", "/api/geocode",
                      "/api/local-extras", "/api/hazard-feed", "/api/recent-rain", "/api/flood", "/api/v1/")
EXPENSIVE_MAX = int(os.getenv("RATE_LIMIT_EXPENSIVE_MAX", "240"))
# Number of trusted reverse proxies in front of the app: the client IP is the Nth entry from the RIGHT of X-Forwarded-For
# (entries to the left are written by the client and can be forged).
PROXY_HOPS = int(os.getenv("TRUSTED_PROXY_HOPS", "0") or 0)   # 0 = not set
MAX_QUERY_LEN = 2048
WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
OPENWEATHER_URL = "https://api.openweathermap.org/data/3.0/onecall"
WEATHERAPI_URL = "https://api.weatherapi.com/v1/forecast.json"
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "").strip()
WEATHERAPI_API_KEY = os.getenv("WEATHERAPI_API_KEY", "").strip()
WEATHER_PROVIDER_TIMEOUT = float(os.getenv("WEATHER_PROVIDER_TIMEOUT", "8"))
DEFAULT_CITIES_DB_PATH = str(ROOT / "data" / "mimu_locations.db")
CITIES_DB_PATH = os.getenv("CITIES_DB_PATH", "").strip() or DEFAULT_CITIES_DB_PATH
GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
WEATHER_MODEL = os.getenv("WEATHER_MODEL", "ecmwf_ifs")
ERA5_URL = os.getenv("OPEN_METEO_ARCHIVE_URL", "https://archive-api.open-meteo.com/v1/archive")
DMH_URL = "https://www.moezala.gov.mm/"
DMH_CACHE_TTL = int(os.getenv("DMH_CACHE_TTL", "600"))
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")

weather_cache: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()
climate_cache: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()
geocode_cache: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()
dmh_cache: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()
mimu_response_cache: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()
hospital_response_cache: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()
LOCAL_LOOKUP_CACHE_TTL = int(os.getenv("LOCAL_LOOKUP_CACHE_TTL", "300"))

client: httpx.AsyncClient | None = None
flood_hub_client = FloodHubClient()
official_store = OfficialAlertStore()
rate_limit_buckets: OrderedDict[str, tuple[float, int]] = OrderedDict()
weather_inflight: dict[str, asyncio.Future] = {}


def _peer_is_loopback(request) -> bool:
    host = request.client.host if request.client else ""
    return host in ("127.0.0.1", "::1") or host.startswith("::ffff:127.")


def _trust_proxy(request) -> bool:
    """True when X-Forwarded-* headers can be believed: explicitly enabled, or the peer is a proxy on this same
    machine (Caddy/nginx -> uvicorn on 127.0.0.1). Without this every visitor behind such a proxy looks like
    127.0.0.1 and the whole site shares one rate-limit bucket."""
    return os.getenv("TRUST_PROXY_HEADERS", "false").lower() == "true" or _peer_is_loopback(request)


def _client_ip(request) -> str:
    if _trust_proxy(request):
        parts = [p.strip() for p in (request.headers.get("x-forwarded-for") or "").split(",") if p.strip()]
        if parts:
            hops = PROXY_HOPS if PROXY_HOPS > 0 else (1 if _peer_is_loopback(request) else 0)
            if hops <= 0:           # TRUST_PROXY_HEADERS=true without a hop count: legacy behaviour (leftmost, forgeable)
                return parts[0]
            return parts[-hops] if len(parts) >= hops else parts[0]
    return request.client.host if request.client else "unknown"


_HOST_OK = re.compile(r"^[A-Za-z0-9.\-]+(:\d{1,5})?$")


def public_base(request) -> str:
    """Public site URL for canonical/og/sitemap: PUBLIC_BASE_URL if set, else the proxy-forwarded host, else the Host header."""
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL
    if _trust_proxy(request):
        host = (request.headers.get("x-forwarded-host") or "").split(",")[0].strip()
        proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
        if host and _HOST_OK.match(host):
            return f"{proto if proto in ('http', 'https') else request.url.scheme}://{host}"
    return str(request.base_url).rstrip("/")


def cache_get(cache: OrderedDict, key: str, ttl: int):
    item = cache.get(key)
    if not item:
        return None
    created, value = item
    if time.monotonic() - created > ttl:
        cache.pop(key, None)
        return None
    cache.move_to_end(key)
    return value


def cache_set(cache: OrderedDict, key: str, value: dict[str, Any]):
    cache[key] = (time.monotonic(), value)
    cache.move_to_end(key)
    while len(cache) > MAX_CACHE_ITEMS:
        cache.popitem(last=False)
