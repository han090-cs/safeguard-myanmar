"""RIMES forecast adapter.

RIMES DataEx is the preferred Myanmar weather source when an authorised
server-side endpoint/account is configured.  The exact DataEx API contract is
institutional, so this adapter deliberately does not guess or scrape the
login-only web UI.  Instead it accepts a documented/exported JSON endpoint
through environment variables and normalises a few safe response shapes.

Environment:
  RIMES_API_URL          Base endpoint supplied by RIMES/DMH.
  RIMES_API_TOKEN        Optional bearer token supplied for that endpoint.
  RIMES_API_TIMEOUT      Request timeout in seconds.
  RIMES_ENABLED          true/false; defaults to true when URL is configured.

The endpoint may return:
  1) an Open-Meteo-compatible {weather, air_quality} wrapper;
  2) an Open-Meteo-compatible weather payload directly; or
  3) a common RIMES-style {current, hourly, daily, timezone, ...} payload.

No credentials are stored in the repository and no login-only DataEx pages are
scraped. If RIMES is unavailable/unconfigured, the caller falls back to the
normal public provider chain.
"""
from __future__ import annotations

import os
from typing import Any

import httpx

RIMES_API_URL = os.getenv("RIMES_API_URL", "").strip()
RIMES_API_TOKEN = os.getenv("RIMES_API_TOKEN", "").strip()
RIMES_TIMEOUT = float(os.getenv("RIMES_API_TIMEOUT", "10"))
RIMES_ENABLED = os.getenv("RIMES_ENABLED", "true").lower() in {"1", "true", "yes", "on"}
RIMES_DATAEX_URL = "https://dataex.rimes.int/"
RIMES_ECMWF_URL = "https://dataex.rimes.int/forecast_vis/ecmwf_hres/"
RIMES_UKMO_URL = "https://dataex.rimes.int/forecast_vis/ukmo_gl/"


def configured() -> bool:
    return bool(RIMES_ENABLED and RIMES_API_URL)


def public_info() -> dict[str, Any]:
    return {
        "configured": configured(),
        "provider": "RIMES",
        "dataex_url": RIMES_DATAEX_URL,
        "ecmwf_hres_url": RIMES_ECMWF_URL,
        "ukmo_global_url": RIMES_UKMO_URL,
        "mode": "server-side authorised endpoint" if configured() else "not configured",
    }


def _number(value: Any) -> float | None:
    try:
        x = float(value)
        return x if x == x and abs(x) != float("inf") else None
    except (TypeError, ValueError):
        return None


def _normalise(payload: dict[str, Any], lat: float, lon: float) -> dict[str, Any]:
    # Wrapper shape: {weather: {...}, air_quality: {...}}
    if isinstance(payload.get("weather"), dict):
        weather = payload["weather"]
        air = payload.get("air_quality") or {}
        return {
            "weather": weather,
            "air_quality": air,
            "meta": {"provider": "RIMES", "fallback": False, "rimes": True,
                     "source_detail": payload.get("source_detail", "RIMES authorised forecast endpoint")},
        }

    # Direct forecast payload: current/hourly/daily/timezone.
    if any(k in payload for k in ("current", "hourly", "daily")):
        return {
            "weather": payload,
            "air_quality": payload.get("air_quality") or {},
            "meta": {"provider": "RIMES", "fallback": False, "rimes": True,
                     "source_detail": payload.get("source_detail", "RIMES authorised forecast endpoint")},
        }

    # A small common mapping for APIs that expose scalar current fields.
    current_src = payload.get("current_weather") or payload.get("current") or {}
    if isinstance(current_src, dict):
        temp = _number(current_src.get("temperature_2m", current_src.get("temperature")))
        humidity = _number(current_src.get("relative_humidity_2m", current_src.get("humidity")))
        wind = _number(current_src.get("wind_speed_10m", current_src.get("wind_speed")))
        rain = _number(current_src.get("precipitation", current_src.get("rainfall")))
        code = current_src.get("weather_code", current_src.get("weathercode"))
        current = {
            "time": current_src.get("time"), "temperature_2m": temp,
            "relative_humidity_2m": humidity, "wind_speed_10m": wind,
            "precipitation": rain, "weather_code": code,
            "apparent_temperature": _number(current_src.get("apparent_temperature", current_src.get("feels_like"))),
            "wind_direction_10m": _number(current_src.get("wind_direction_10m", current_src.get("wind_direction"))),
            "pressure_msl": _number(current_src.get("pressure_msl", current_src.get("pressure"))),
            "visibility": _number(current_src.get("visibility")),
        }
        return {
            "weather": {"latitude": lat, "longitude": lon, "timezone": payload.get("timezone", "Asia/Yangon"),
                        "current": current, "hourly": payload.get("hourly", {}), "daily": payload.get("daily", {})},
            "air_quality": payload.get("air_quality") or {},
            "meta": {"provider": "RIMES", "fallback": False, "rimes": True,
                     "source_detail": "RIMES authorised forecast endpoint"},
        }

    raise ValueError("RIMES response has no supported forecast shape")


async def fetch(lat: float, lon: float, client: httpx.AsyncClient) -> dict[str, Any]:
    if not configured():
        raise RuntimeError("RIMES API endpoint is not configured")

    headers = {"Accept": "application/json", "User-Agent": "MyanmarWeather/RIMES-adapter"}
    if RIMES_API_TOKEN:
        headers["Authorization"] = f"Bearer {RIMES_API_TOKEN}"
    params = {"latitude": round(lat, 4), "longitude": round(lon, 4)}

    try:
        response = await client.get(RIMES_API_URL, params=params, headers=headers, timeout=RIMES_TIMEOUT)
        response.raise_for_status()
        data = response.json()
    except httpx.TimeoutException as exc:
        raise RuntimeError("RIMES: request timed out") from exc
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(f"RIMES: provider rejected/unavailable ({exc.response.status_code})") from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise RuntimeError("RIMES: invalid or unavailable response") from exc

    if not isinstance(data, dict):
        raise ValueError("RIMES: response is not a JSON object")
    return _normalise(data, lat, lon)
