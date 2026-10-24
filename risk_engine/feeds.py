"""Free public hazard feeds, pulled on demand (no API keys).

Sources
  usgs   USGS earthquake catalog (FDSN event service, GeoJSON)      https://earthquake.usgs.gov/fdsnws/event/1/
  gdacs  GDACS events: earthquake / tropical cyclone / flood (GeoJSON) https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH
  glofas GloFAS river discharge via Open-Meteo Flood API             https://flood-api.open-meteo.com/v1/flood
  marine Open-Meteo Marine API: wave height / period on the coast    https://marine-api.open-meteo.com/v1/marine
  water  Open-Meteo forecast: rain, ET0 and top-soil moisture (farming) https://api.open-meteo.com/v1/forecast

These are international, automatic products. They are NOT official DMH warnings and the UI says so.
Add a source: write `parse_x(payload) -> list[dict]`, an async `fetch_x(client)`, and register it in SOURCES.
"""
from __future__ import annotations

import asyncio
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

import httpx

MYANMAR_BBOX = {"minlat": 9.0, "maxlat": 29.0, "minlon": 92.0, "maxlon": 102.5}
# Bay of Bengal / Andaman Sea cyclones matter for Myanmar before they reach it
CYCLONE_BBOX = {"minlat": 5.0, "maxlat": 28.0, "minlon": 80.0, "maxlon": 102.5}
USER_AGENT = os.getenv("APP_USER_AGENT", "MyanmarWeather/9 (hazard feeds)")
USGS_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"
GDACS_URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
FLOOD_URL = "https://flood-api.open-meteo.com/v1/flood"
MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
LEVELS = {"info": 0, "watch": 1, "warning": 2}


def _iso_from_ms(ms: Any) -> str | None:
    try:
        return datetime.fromtimestamp(float(ms) / 1000.0, tz=timezone.utc).isoformat(timespec="minutes")
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def _in_box(lat: float, lon: float, box: dict[str, float]) -> bool:
    return box["minlat"] <= lat <= box["maxlat"] and box["minlon"] <= lon <= box["maxlon"]


def _num(v: Any) -> float | None:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- parsers (pure functions, unit-tested offline)
def parse_usgs(payload: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for f in (payload or {}).get("features") or []:
        pr, geo = f.get("properties") or {}, (f.get("geometry") or {}).get("coordinates") or []
        if len(geo) < 2:
            continue
        lon, lat = _num(geo[0]), _num(geo[1])
        mag = _num(pr.get("mag"))
        if lat is None or lon is None or mag is None:
            continue
        pager = str(pr.get("alert") or "").lower()
        level = "warning" if (mag >= 6.5 or pager in ("orange", "red")) else "watch" if (mag >= 5.5 or pager == "yellow") else "info"
        out.append({
            "id": "usgs:" + str(f.get("id")), "source": "USGS", "kind": "earthquake", "level": level,
            "title": str(pr.get("title") or pr.get("place") or "Earthquake"), "magnitude": round(mag, 1),
            "depth_km": _num(geo[2]) if len(geo) > 2 else None, "time": _iso_from_ms(pr.get("time")),
            "lat": lat, "lon": lon, "url": pr.get("url"), "tsunami": bool(pr.get("tsunami")),
        })
    return out


_GDACS_KIND = {"EQ": "earthquake", "TC": "cyclone", "FL": "flood", "VO": "volcano", "DR": "drought", "WF": "wildfire"}


def parse_gdacs(payload: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for f in (payload or {}).get("features") or []:
        pr, geom = f.get("properties") or {}, f.get("geometry") or {}
        if str(geom.get("type")) != "Point":
            continue  # polygons (affected area) repeat the same event
        coords = geom.get("coordinates") or []
        if len(coords) < 2:
            continue
        lon, lat = _num(coords[0]), _num(coords[1])
        et = str(pr.get("eventtype") or "").upper()
        kind = _GDACS_KIND.get(et)
        level = {"red": "warning", "orange": "watch", "green": "info"}.get(str(pr.get("alertlevel") or "").lower())
        if lat is None or lon is None or kind is None or level is None:
            continue
        url = pr.get("url") or {}
        sev = pr.get("severitydata") or {}
        out.append({
            "id": f"gdacs:{et}:{pr.get('eventid')}", "source": "GDACS", "kind": kind, "level": level,
            "title": str(pr.get("name") or pr.get("htmldescription") or kind), "magnitude": _num(sev.get("severity")),
            "detail": sev.get("severitytext"), "time": pr.get("fromdate"), "lat": lat, "lon": lon,
            "url": (url.get("report") if isinstance(url, dict) else None),
            "current": str(pr.get("iscurrent")).lower() in ("true", "1"), "country": pr.get("country"),
        })
    return out


def parse_glofas(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Summarise the river-discharge forecast of the largest river near the point (a trend, NOT a flood warning)."""
    d = (payload or {}).get("daily") or {}
    days, vals = d.get("time") or [], d.get("river_discharge") or []
    pairs = [(t, _num(v)) for t, v in zip(days, vals, strict=True)]
    pairs = [(t, v) for t, v in pairs if v is not None]
    if len(pairs) < 3:
        return None
    first = pairs[0][1]
    peak_t, peak = max(pairs, key=lambda p: p[1])
    last = pairs[-1][1]
    if first > 0 and peak >= first * 1.5 and peak_t != pairs[0][0]:
        trend = "rising"
    elif first > 0 and last <= first * 0.67:
        trend = "falling"
    else:
        trend = "steady"
    return {"source": "GloFAS (Open-Meteo Flood API)", "unit": "m³/s", "today": round(first, 1), "peak": round(peak, 1),
            "peak_date": peak_t, "last": round(last, 1), "days": len(pairs), "trend": trend,
            "series": [round(v, 1) for _, v in pairs]}


# ---------------------------------------------------------------- fetchers
async def _get_json(client: httpx.AsyncClient, url: str, params: dict[str, Any]) -> Any:
    r = await client.get(url, params=params, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    r.raise_for_status()
    return r.json()


async def fetch_usgs(client: httpx.AsyncClient, days: int = 14, minmag: float = 4.0) -> list[dict[str, Any]]:
    start = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    box = MYANMAR_BBOX
    data = await _get_json(client, USGS_URL, {
        "format": "geojson", "starttime": start, "minmagnitude": minmag, "orderby": "time", "limit": 100,
        "minlatitude": box["minlat"], "maxlatitude": box["maxlat"], "minlongitude": box["minlon"], "maxlongitude": box["maxlon"]})
    return parse_usgs(data)


async def fetch_gdacs(client: httpx.AsyncClient, days: int = 10) -> list[dict[str, Any]]:
    today = datetime.now(timezone.utc).date()
    base = {"eventlist": "EQ;TC;FL", "fromdate": (today - timedelta(days=days)).isoformat(), "todate": today.isoformat()}
    found: dict[str, dict[str, Any]] = {}
    # The combined alertlevel filter is unreliable on GDACS, so ask one level at a time and de-duplicate.
    for level in ("Red", "Orange"):
        try:
            data = await _get_json(client, GDACS_URL, {**base, "alertlevel": level})
        except httpx.HTTPError:
            if level == "Red":
                raise
            continue
        for a in parse_gdacs(data):
            found[a["id"]] = a
    keep = []
    for a in found.values():
        box = CYCLONE_BBOX if a["kind"] == "cyclone" else MYANMAR_BBOX
        if _in_box(a["lat"], a["lon"], box) or "myanmar" in str(a.get("country") or "").lower():
            keep.append(a)
    return keep


async def fetch_glofas(client: httpx.AsyncClient, lat: float, lon: float, days: int = 10) -> dict[str, Any] | None:
    data = await _get_json(client, FLOOD_URL, {"latitude": lat, "longitude": lon, "daily": "river_discharge", "forecast_days": days})
    return parse_glofas(data)



def parse_marine(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Wave outlook for the coast. Returns None for inland points (the API has no sea data there)."""
    d = (payload or {}).get("daily") or {}
    days, hs, per = d.get("time") or [], d.get("wave_height_max") or [], d.get("wave_period_max") or []
    rows = [(t, _num(h), _num(per[i]) if i < len(per) else None) for i, (t, h) in enumerate(zip(days, hs, strict=True))]
    rows = [r for r in rows if r[1] is not None][:5]
    if not rows:
        return None
    peak = max(rows, key=lambda r: r[1])
    return {"source": "Open-Meteo Marine", "unit": "m", "today": round(rows[0][1], 1), "peak": round(peak[1], 1),
            "peak_date": peak[0], "peak_period_s": peak[2], "series": [round(r[1], 1) for r in rows],
            "dates": [r[0] for r in rows]}


def parse_field_water(payload: dict[str, Any]) -> dict[str, Any] | None:
    """7-day water balance (rain minus reference evapotranspiration) and top-soil moisture trend, for farming."""
    d, h = (payload or {}).get("daily") or {}, (payload or {}).get("hourly") or {}
    rain = [_num(v) for v in (d.get("precipitation_sum") or [])][:7]
    et0 = [_num(v) for v in (d.get("et0_fao_evapotranspiration") or [])][:7]
    pairs = [(r, e) for r, e in zip(rain, et0, strict=True) if r is not None and e is not None]
    if len(pairs) < 3:
        return None
    rain_sum, et0_sum = sum(p[0] for p in pairs), sum(p[1] for p in pairs)
    soil = [_num(v) for v in (h.get("soil_moisture_0_to_7cm") or [])]
    soil = [v for v in soil if v is not None]
    out: dict[str, Any] = {"source": "Open-Meteo forecast", "days": len(pairs), "rain_mm": round(rain_sum, 1),
                           "et0_mm": round(et0_sum, 1), "balance_mm": round(rain_sum - et0_sum, 1),
                           "soil_now_pct": None, "soil_end_pct": None, "soil_trend": None}
    if len(soil) >= 48:
        now_v, end_v = sum(soil[:24]) / 24 * 100, sum(soil[-24:]) / 24 * 100
        out.update(soil_now_pct=round(now_v, 1), soil_end_pct=round(end_v, 1),
                   soil_trend="drying" if end_v <= now_v - 3 else "wetting" if end_v >= now_v + 3 else "steady")
    return out


async def fetch_marine(client: httpx.AsyncClient, lat: float, lon: float) -> dict[str, Any] | None:
    try:
        data = await _get_json(client, MARINE_URL, {"latitude": lat, "longitude": lon, "forecast_days": 5, "timezone": "auto",
                                                    "daily": "wave_height_max,wave_period_max"})
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (400, 404, 412):   # inland / no sea data
            return None
        raise
    return parse_marine(data)


async def fetch_field_water(client: httpx.AsyncClient, lat: float, lon: float) -> dict[str, Any] | None:
    data = await _get_json(client, FORECAST_URL, {"latitude": lat, "longitude": lon, "forecast_days": 7, "timezone": "auto",
                                                  "daily": "precipitation_sum,et0_fao_evapotranspiration",
                                                  "hourly": "soil_moisture_0_to_7cm"})
    return parse_field_water(data)


async def pull_extras(lat: float, lon: float, timeout: float = 15.0) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        sea, water = await asyncio.gather(fetch_marine(client, lat, lon), fetch_field_water(client, lat, lon), return_exceptions=True)
    errors = {}
    if isinstance(sea, BaseException):
        errors["marine"], sea = type(sea).__name__, None
    if isinstance(water, BaseException):
        errors["water"], water = type(water).__name__, None
    return {"sea": sea, "water": water, "errors": errors}

SOURCES: dict[str, Callable[..., Awaitable[Any]]] = {"usgs": fetch_usgs, "gdacs": fetch_gdacs}


async def pull_regional(timeout: float = 15.0) -> dict[str, Any]:
    """Fetch every regional source concurrently; one failing source never blocks the others."""
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        names = list(SOURCES)
        results = await asyncio.gather(*(SOURCES[n](client) for n in names), return_exceptions=True)
    alerts, errors = [], {}
    for n, res in zip(names, results, strict=True):
        if isinstance(res, BaseException):
            errors[n] = f"{type(res).__name__}: {str(res)[:120]}"
        else:
            alerts.extend(res)
    return {"alerts": alerts, "errors": errors, "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}


async def pull_river(lat: float, lon: float, timeout: float = 15.0) -> dict[str, Any] | None:
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        return await fetch_glofas(client, lat, lon)


# ---------------------------------------------------------------- per-place selection
_RADIUS = {"earthquake": 300.0, "cyclone": 800.0, "flood": 400.0}


def alerts_near(alerts: list[dict[str, Any]], lat: float, lon: float) -> tuple[list[dict[str, Any]], int]:
    """(alerts that matter for this place, number of other alerts elsewhere in the region). Strong quakes reach further."""
    near, far = [], 0
    for a in alerts:
        km = haversine_km(lat, lon, a["lat"], a["lon"])
        radius = _RADIUS.get(a["kind"], 300.0)
        if a["kind"] == "earthquake" and (a.get("magnitude") or 0) >= 6.5:
            radius = 1000.0
        if km <= radius:
            near.append({**a, "distance_km": round(km)})
        else:
            far += 1
    # most severe first, then most recent first
    near.sort(key=lambda a: (LEVELS.get(a["level"], 0), _epoch(a.get("time"))), reverse=True)
    return near[:8], far


def _epoch(value: Any) -> float:
    """Seconds since epoch for an ISO string (naive times are taken as UTC); 0 when missing or unreadable."""
    try:
        dt = datetime.fromisoformat(str(value))
    except ValueError:
        return 0.0
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).timestamp()
