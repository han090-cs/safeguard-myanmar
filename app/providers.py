"""Upstream provider clients and weather response normalization."""
from __future__ import annotations

import asyncio
import math
from typing import Any

from fastapi import HTTPException

from app import state


async def fetch_json(url: str, params: dict[str, Any], *, attempts: int = 2) -> tuple[dict[str, Any], int]:
    if state.client is None:
        raise HTTPException(503, "HTTP client is not ready")
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = await state.client.get(url, params=params)
            if response.status_code == 200:
                return response.json(), response.status_code
            if response.status_code != 429 and 400 <= response.status_code < 500:
                detail = "Weather provider rejected the request"
                try:
                    detail = str(response.json().get("reason") or detail)
                except ValueError:
                    pass
                raise HTTPException(response.status_code, detail)
            last_error = RuntimeError(f"provider returned {response.status_code}")
        except HTTPException:
            raise
        except Exception as exc:
            last_error = exc
        if attempt + 1 < attempts:
            await asyncio.sleep(0.35 * (attempt + 1))
    raise HTTPException(502, "Weather provider is temporarily unavailable") from last_error


def weather_params(lat: float, lon: float) -> dict[str, Any]:
    return {"latitude": lat, "longitude": lon, "current": "temperature_2m,relative_humidity_2m,apparent_temperature,pressure_msl,visibility,wind_speed_10m,wind_direction_10m,is_day,weather_code", "hourly": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m", "daily": "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,precipitation_hours,uv_index_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant", "timezone": "auto", "forecast_days": 7, "models": state.WEATHER_MODEL}


def air_params(lat: float, lon: float) -> dict[str, Any]:
    return {"latitude": lat, "longitude": lon, "current": "us_aqi,pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone", "timezone": "auto"}


def uv_params(lat: float, lon: float) -> dict[str, Any]:
    return {"latitude": lat, "longitude": lon, "daily": "uv_index_max", "timezone": "auto", "forecast_days": 7}


def _finite(value: Any) -> float | None:
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (TypeError, ValueError):
        return None


def _max_uv(values: list[Any]) -> float | None:
    nums = [n for n in (_finite(v) for v in values) if n is not None]
    return max(nums) if nums else None


def _merge_uv(forecast: dict[str, Any], uv: dict[str, Any] | None) -> None:
    if uv and isinstance(uv.get("daily"), dict):
        forecast.setdefault("daily", {})["uv_index_max"] = uv["daily"].get("uv_index_max", [])


async def _provider_get(name: str, url: str, params: dict[str, Any], headers: dict[str, str] | None = None) -> tuple[str, dict[str, Any]]:
    if state.client is None:
        raise HTTPException(503, "HTTP client is not ready")
    response = await state.client.get(url, params=params, headers=headers)
    if response.status_code != 200:
        raise RuntimeError(f"{name} returned {response.status_code}")
    return name, response.json()


async def _fetch_open_meteo(lat: float, lon: float) -> dict[str, Any]:
    weather, _ = await fetch_json(state.WEATHER_URL, weather_params(lat, lon))
    try:
        air, _ = await fetch_json(state.AIR_URL, air_params(lat, lon), attempts=1)
    except Exception:
        air = {}
    try:
        uv, _ = await fetch_json(state.WEATHER_URL, uv_params(lat, lon), attempts=1)
        _merge_uv(weather, uv)
    except Exception:
        pass
    return {"weather": weather, "air_quality": air, "meta": {"provider": "Open-Meteo", "fallback": False, "air_quality": bool(air)}}


async def _fetch_openweather(lat: float, lon: float):
    if not state.OPENWEATHER_API_KEY:
        raise RuntimeError("OpenWeatherMap API key not configured")
    _, data = await _provider_get("OpenWeatherMap", state.OPENWEATHER_URL, {"lat": lat, "lon": lon, "appid": state.OPENWEATHER_API_KEY, "units": "metric", "exclude": "minutely,alerts"})
    current = data.get("current", {})
    daily = data.get("daily", [])
    return {"name": "OpenWeatherMap", "raw": data, "temperature": _finite(current.get("temp")), "humidity": _finite(current.get("humidity")), "uv": _max_uv([current.get("uvi")] + [x.get("uvi") for x in daily if isinstance(x, dict)])}


async def _fetch_weatherapi(lat: float, lon: float):
    if not state.WEATHERAPI_API_KEY:
        raise RuntimeError("WeatherAPI API key not configured")
    _, data = await _provider_get("WeatherAPI", state.WEATHERAPI_URL, {"key": state.WEATHERAPI_API_KEY, "q": f"{lat},{lon}", "days": 3, "aqi": "no", "alerts": "no"})
    current = data.get("current", {})
    forecast = data.get("forecast", {}).get("forecastday", [])
    uv_values = [current.get("uv")]
    for day in forecast:
        if isinstance(day, dict):
            uv_values.append(day.get("day", {}).get("uv"))
            for hour in day.get("hour", []):
                if isinstance(hour, dict): uv_values.append(hour.get("uv"))
    return {"name": "WeatherAPI", "raw": data, "temperature": _finite(current.get("temp_c")), "humidity": _finite(current.get("humidity")), "uv": _max_uv(uv_values)}


def _fallback_weather(provider: dict[str, Any], lat: float, lon: float) -> dict[str, Any]:
    name, raw = provider["name"], provider["raw"]
    if name == "OpenWeatherMap":
        c = raw.get("current", {})
        return {"weather": {"latitude": lat, "longitude": lon, "timezone": raw.get("timezone", "UTC"), "current": {"temperature_2m": c.get("temp"), "relative_humidity_2m": c.get("humidity"), "apparent_temperature": c.get("feels_like"), "pressure_msl": c.get("pressure"), "visibility": c.get("visibility"), "wind_speed_10m": (float(c.get("wind_speed", 0))*3.6 if c.get("wind_speed") is not None else None), "wind_direction_10m": c.get("wind_deg"), "is_day": 1 if c.get("dt",0) < c.get("sunset",0) else 0}, "daily": {"time": [], "uv_index_max": [provider.get("uv")]}, "hourly": {}}, "air_quality": {}, "meta": {"cached": False, "provider": name}}
    if name == "WeatherAPI":
        c = raw.get("current", {})
        return {"weather": {"latitude": lat, "longitude": lon, "timezone": raw.get("location", {}).get("tz_id", "UTC"), "current": {"temperature_2m": c.get("temp_c"), "relative_humidity_2m": c.get("humidity"), "apparent_temperature": c.get("feelslike_c"), "pressure_msl": c.get("pressure_mb"), "visibility": (float(c.get("vis_km", 0))*1000 if c.get("vis_km") is not None else None), "wind_speed_10m": c.get("wind_kph"), "wind_direction_10m": c.get("wind_degree"), "is_day": c.get("is_day", 1)}, "daily": {"time": [], "uv_index_max": [provider.get("uv")]}, "hourly": {}}, "air_quality": {}, "meta": {"cached": False, "provider": name}}
    raise ValueError(f"Unsupported fallback provider: {name}")


async def fetch_climate_era5(lat: float, lon: float, start, end) -> dict[str, Any]:
    data, _ = await fetch_json(state.ERA5_URL, {"latitude": lat, "longitude": lon, "start_date": start.isoformat(), "end_date": end.isoformat(), "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum", "timezone": "UTC", "models": "era5"})
    return data
