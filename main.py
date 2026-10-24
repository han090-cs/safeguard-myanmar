"""Myanmar Weather Dashboard application entrypoint.

Routing, middleware, provider adapters, caching and static-file handling live in ``app/``.
This module intentionally re-exports the public app/version and the provider symbols used by tests.
"""
from app.app import app
from app import state
from app import providers
from risk_engine.official import OfficialAlertStore
from risk_engine import rimes
from app.api import _feed_cache, _river_cache, _extras_cache

APP_VERSION = state.APP_VERSION
__all__ = [
    "app", "APP_VERSION", "CACHE_TTL", "CLIMATE_CACHE_TTL", "weather_cache", "climate_cache",
    "rate_limit_buckets", "_fetch_open_meteo", "_fetch_openweather", "_fetch_weatherapi",
    "official_store", "rimes", "OfficialAlertStore", "_feed_cache", "_river_cache", "_extras_cache",
]

CACHE_TTL = state.CACHE_TTL
CLIMATE_CACHE_TTL = state.CLIMATE_CACHE_TTL
weather_cache = state.weather_cache
climate_cache = state.climate_cache
rate_limit_buckets = state.rate_limit_buckets

# Compatibility exports for existing tests/tooling; new code should import app.providers directly.
_fetch_open_meteo = providers._fetch_open_meteo
_fetch_openweather = providers._fetch_openweather
_fetch_weatherapi = providers._fetch_weatherapi
official_store = state.official_store

# CSP policy is assembled in app.app; kept here as a searchable contract for release tests/tooling.
CSP_SCRIPT_STYLE_POLICY = "script-src 'self'; style-src 'self';"
