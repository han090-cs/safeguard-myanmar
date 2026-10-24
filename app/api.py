"""HTTP API routes for the dashboard."""
from __future__ import annotations

import asyncio
import os
import time
from datetime import date
from typing import Any

from fastapi import APIRouter, HTTPException, Query
import httpx

from app import state, providers
ROOT = state.ROOT
from gazetteer import search_places, place_count, nearest_hospitals, search_hospitals, list_regions, list_towns
from risk_engine.dmh_importer import source_status
from risk_engine import rimes
from risk_engine.agri_zones import resolve as resolve_agri_zone

router = APIRouter()

weather_cache = state.weather_cache
climate_cache = state.climate_cache
geocode_cache = state.geocode_cache
dmh_cache = state.dmh_cache
mimu_response_cache = state.mimu_response_cache
hospital_response_cache = state.hospital_response_cache
flood_hub_client = state.flood_hub_client
official_store = state.official_store
cache_get = state.cache_get
cache_set = state.cache_set

_feed_cache: dict[str, Any] = {"at": 0.0, "data": None}
_river_cache: dict[str, tuple[float, Any]] = {}
FEED_TTL = float(os.getenv("HAZARD_FEED_TTL", "600"))
RIVER_TTL = float(os.getenv("RIVER_FEED_TTL", "10800"))

@router.get("/api/hazard-feed")
async def hazard_feed(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)):
    """International hazard feeds (USGS quakes, GDACS cyclone/flood/quake) near a place, plus a GloFAS river trend."""
    import time as _t
    from risk_engine import feeds
    now = _t.time()
    stale = False
    if _feed_cache["data"] is None or now - _feed_cache["at"] > FEED_TTL:
        fresh = await feeds.pull_regional()
        if fresh["alerts"] or not _feed_cache["data"]:
            _feed_cache.update(at=now, data=fresh)
        else:                                     # every source failed: keep the last good copy and say so
            stale = True
    data = _feed_cache["data"] or {"alerts": [], "errors": {}, "fetched_at": None}
    near, elsewhere = feeds.alerts_near(data["alerts"], lat, lon)
    key = f"{round(lat, 2)},{round(lon, 2)}"
    hit = _river_cache.get(key)
    river, river_error = None, None
    if hit and now - hit[0] < RIVER_TTL:
        river = hit[1]
    else:
        try:
            river = await feeds.pull_river(lat, lon)
            if len(_river_cache) > 500:
                _river_cache.clear()
            _river_cache[key] = (now, river)
        except Exception as exc:                  # the river forecast is optional; never fail the whole response
            river_error = f"{type(exc).__name__}"
            river = hit[1] if hit else None
    return {"alerts": near, "elsewhere_count": elsewhere, "river": river, "errors": {**data["errors"], **({"glofas": river_error} if river_error else {})},
            "fetched_at": data["fetched_at"], "stale": stale}


_extras_cache: dict[str, tuple[float, Any]] = {}
EXTRAS_TTL = float(os.getenv("EXTRAS_TTL", "10800"))


@router.get("/api/local-extras")
async def local_extras(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)):
    """Coastal wave outlook and farming water balance for a place (Open-Meteo Marine + forecast), cached 3 h."""
    import time as _t
    from risk_engine import feeds
    key, now = f"{round(lat, 2)},{round(lon, 2)}", _t.time()
    hit = _extras_cache.get(key)
    if hit and now - hit[0] < EXTRAS_TTL:
        return hit[1]
    data = await feeds.pull_extras(lat, lon)
    if len(_extras_cache) > 500:
        _extras_cache.clear()
    if data["sea"] or data["water"] or not data["errors"]:   # do not cache a total failure
        _extras_cache[key] = (now, data)
    return data


@router.get("/api/region-at")
def region_at(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)):
    """Which state/region a GPS point is in (nearest MIMU place within 120 km, else null)."""
    from risk_engine.geo import region_at as exact_region_at
    return {"region": exact_region_at(lat, lon)}


@router.get("/api/agri")
def agri_data(lat: float | None = Query(None, ge=-90, le=90), lon: float | None = Query(None, ge=-180, le=180)):
    """Crop calendar plus an honest location-aware agricultural-zone resolution."""
    import json as _json
    try:
        data = _json.loads((ROOT / "data" / "agri.json").read_text(encoding="utf-8"))
        if lat is not None and lon is not None:
            data["location_zone"] = resolve_agri_zone(lat, lon)
        return data
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Agriculture data unavailable") from exc


@router.get("/api/agri/research")
def agri_research(region: str | None = Query(None, pattern=r"^R\d{2}$")):
    """Region-level agriculture/soil research data (data/agri_research.json, built from the CSV bundle).
    Unknown values stay unknown; nothing is resolved from a place name."""
    import json as _json
    try:
        data = _json.loads((ROOT / "data" / "agri_research.json").read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Agriculture research data unavailable") from exc
    if region:
        if region not in {r["id"] for r in data["regions"]}:
            raise HTTPException(status_code=404, detail="Unknown region")
        data["regions"] = [r for r in data["regions"] if r["id"] == region]
        data["crops"] = [c for c in data["crops"] if c["region_id"] in (region, None)]
    return data


@router.get("/api/enso")
def enso_status():
    """El Niño status kept in data/enso_status.json (update monthly after NOAA's diagnostic discussion)."""
    import json as _json, datetime as _dt
    try:
        d = _json.loads((ROOT / "data" / "enso_status.json").read_text(encoding="utf-8"))
        age = (_dt.date.today() - _dt.date.fromisoformat(d["updated"])).days
    except Exception as exc:
        raise HTTPException(status_code=503, detail="ENSO status unavailable") from exc
    d["age_days"] = age
    try:
        overdue = (_dt.date.today() - _dt.date.fromisoformat(d["next_update"])).days > 7
    except Exception:
        overdue = False
    d["stale"] = age > 45 or overdue
    return d


@router.get("/api/status")
async def app_status() -> dict[str, Any]:
    """Public, location-independent service status for deployment monitoring."""
    return {
        "service": "myanmar-weather",
        "version": state.APP_VERSION,
        "dmh": "https://www.moezala.gov.mm/",
        "rimes": rimes.public_info(),
        "flood_hub": "https://sites.research.google/floods/",
        "forecast_provider": "RIMES" if rimes.configured() else "Open-Meteo",
        "forecast_priority": ["RIMES", "Open-Meteo", "WeatherAPI", "OpenWeatherMap"],
        "forecast_model": state.WEATHER_MODEL,
        "fallback_providers": ["Open-Meteo"] + (["WeatherAPI"] if state.WEATHERAPI_API_KEY else []) + (["OpenWeatherMap"] if state.OPENWEATHER_API_KEY else []),
        "offline_cache": True,
    }


@router.get("/health")
async def health() -> dict[str, Any]:
    # Keep this endpoint cheap and dependency-light for load balancers.
    # /api/status contains the richer provider/degraded-state information.
    return {"ok": True, "service": "myanmar-weather", "version": state.APP_VERSION,
            "cache": {"weather": len(weather_cache), "climate": len(climate_cache),
                      "geocode": len(geocode_cache), "dmh": len(dmh_cache)}}


@router.get("/api/hospitals/nearest")
async def hospitals_nearest(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    limit: int = Query(8, ge=1, le=30),
) -> dict[str, Any]:
    """Nearest public hospitals, from the 2020 MIMU/CDE-Myanmar dataset
    (~1,130 facilities, CC BY 4.0). Coordinates are satellite-derived
    approximations — each result carries the source's own confidence
    rating (high confidence / probably accurate / bestGuess / probably
    inaccurate), which the frontend should surface, not hide.
    """
    key=f"{round(lat,3)}:{round(lon,3)}:{limit}"
    cached=cache_get(hospital_response_cache,key,state.LOCAL_LOOKUP_CACHE_TTL)
    if cached is not None: return cached
    results = await asyncio.to_thread(nearest_hospitals, lat, lon, limit)
    from gazetteer import hospital_count
    payload={"results": results, "total_available": hospital_count(), "source": "MIMU / CDE-Myanmar, Public Hospitals in Myanmar as of 2020 (CC BY 4.0)"}
    cache_set(hospital_response_cache,key,payload)
    return payload


@router.get("/api/hospitals/search")
async def hospitals_search(
    q: str = Query(..., min_length=1, max_length=80),
    limit: int = Query(10, ge=1, le=30),
) -> dict[str, Any]:
    return {"results": await asyncio.to_thread(search_hospitals, q, limit)}


@router.get("/api/regions")
async def regions():
    return {"results": list_regions(), "source": "mimu"}

@router.get("/api/regions/{admin1}/towns")
async def region_towns(admin1: str, limit: int = Query(250, ge=1, le=500)):
    return {"results": list_towns(admin1, limit=limit), "source": "mimu", "region": admin1}

@router.get("/api/mimu-search")
async def mimu_search(
    q: str = Query(..., min_length=1, max_length=80),
    limit: int = Query(8, ge=1, le=20),
) -> dict[str, Any]:
    """Local, offline place search over the full MIMU gazetteer (~56k towns
    and villages). No external API call, no rate limit, no network needed —
    this is the fast path the frontend should try before falling back to
    /api/geocode for anything not found locally (e.g. places outside Myanmar).
    """
    key=f"{q.strip().casefold()}:{limit}"
    cached=cache_get(mimu_response_cache,key,state.LOCAL_LOOKUP_CACHE_TTL)
    if cached is not None: return cached
    results=await asyncio.to_thread(search_places,q,limit)
    payload={"results":results,"source":"mimu","total_places":place_count()}
    cache_set(mimu_response_cache,key,payload)
    return payload




@router.get("/api/flood")
async def flood_status(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
) -> dict[str, Any]:
    """Optional Google Flood Forecasting API status near a location.

    If pilot API access is not configured, the endpoint returns an explicit
    `not_configured` state and the frontend keeps the public Flood Hub link.
    """
    return await flood_hub_client.nearby_status(lat, lon)


def _canonical_region(region: str | None, lat: float | None, lon: float | None) -> str | None:
    """State/region key the alert store uses (e.g. "Yangon"). The page sends Burmese names ("ရန်ကုန်တိုင်းဒေသကြီး") or
    nothing at all, and alerts are stored under English keys, so match on the name first and the coordinates second."""
    from risk_engine.api import get_engine
    from risk_engine.geo import region_at
    canon = None
    if region:
        try:
            canon = get_engine().kb.canonical_region(region)
        except Exception:  # noqa: BLE001 - never let a lookup problem hide an official warning
            canon = None
    if canon is None and lat is not None and lon is not None:
        canon = region_at(lat, lon)
    return canon


@router.get("/api/dmh/alerts")
async def dmh_alerts(
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
    region: str | None = Query(None, max_length=80),
) -> dict[str, Any]:
    """Return ingested DMH warnings as first-class app data, not navigation links.

    Independent of the forecast providers: official warnings must still show when Open-Meteo is down."""
    from datetime import datetime, timezone
    point = (lat, lon) if lat is not None and lon is not None else None
    canon = _canonical_region(region, lat, lon)
    now = datetime.now(timezone.utc)
    if point or canon:
        import main as compat
        alerts = compat.official_store.for_region(canon, now, lookback_days=2, point=point)
    else:
        import main as compat
        alerts = compat.official_store.all()
    alerts.sort(key=lambda a: a.valid_from, reverse=True)
    payload = []
    for a in alerts[:20]:
        payload.append({
            "id": a.alert_id, "type": a.type, "regions": a.regions,
            "valid_from": a.valid_from, "valid_to": a.valid_to,
            "active": a.valid_from <= now <= a.valid_to,
            "title": a.title.model_dump(), "summary": a.summary.model_dump() if a.summary else None,
            "stations": a.stations, "retrieved_at": a.retrieved_at,
            "source": "DMH", "url": a.url, "links": a.links.model_dump() if a.links else None,
        })
    status = source_status()
    return {"alerts": payload, "region": canon, "source_status": status, "source": "DMH", "updated_at": now.isoformat()}


@router.get("/api/dmh")
async def dmh_summary() -> dict[str, Any]:
    """Read the public DMH homepage and expose only navigational/source metadata.

    The official DMH site is the authoritative source for Myanmar warnings. We do
    not reinterpret its warning text here; the UI links users to the original
    bulletin/image so the latest official wording remains visible.
    """
    cached = cache_get(dmh_cache, "home", state.DMH_CACHE_TTL)
    if cached is not None:
        return cached
    if state.client is None:
        raise HTTPException(503, "HTTP state.client is not ready")
    try:
        response = await state.client.get(state.DMH_URL, headers={"Accept": "text/html"})
        response.raise_for_status()
        html = response.text
    except httpx.HTTPError:
        # Keep the app usable when the DMH site is temporarily unreachable from
        # the hosting network. Never invent bulletin content; expose only the
        # verified official homepage as a fallback source.
        fallback = {
            "title": "DMH Myanmar official website",
            "url": state.DMH_URL,
        }
        groups = {k: [fallback] for k in (
            "radar", "satellite", "flood", "storm", "rainfall",
            "earthquake", "tsunami", "climate", "uv", "forecast"
        )}
        result = {"source": "DMH Myanmar", "source_url": state.DMH_URL,
                  "fetched_at": time.time(), "degraded": True, "groups": groups}
        stale = dmh_cache.get("home")
        if stale:
            return stale[1] | {"degraded": True}
        return result

    import re
    from html import unescape
    links = []
    for m in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, re.I|re.S):
        href, label = m.group(1), re.sub(r'<[^>]+>', ' ', m.group(2))
        label = re.sub(r'\s+', ' ', unescape(label)).strip()
        if not label or len(label) < 2:
            continue
        if href.startswith("/"):
            href = "https://www.moezala.gov.mm" + href
        elif href.startswith("index.php"):
            href = "https://www.moezala.gov.mm/" + href
        if href.startswith("http") and href not in {x["url"] for x in links}:
            links.append({"title": label[:160], "url": href})

    keywords = {
        "radar": ["radar", "ရေဒါ"], "satellite": ["himawari", "ဂြိုဟ်တု"],
        "flood": ["flood", "ရေကြီး", "လျှပ်တပြက်"], "storm": ["cyclone", "မုန်တိုင်း"],
        "rainfall": ["rainfall", "မိုးရေချိန်"], "earthquake": ["earthquake", "မြေငလျင်"],
        "tsunami": ["tsunami", "ဆူနာမီ"], "climate": ["el-nino", "el niño", "လာနီညာ", "အယ်နီညို"],
        "uv": ["uv index", "uv"], "forecast": ["daily weather", "10-day", "monthly", "ခန့်မှန်းချက်"],
    }
    groups = {}
    for key, words in keywords.items():
        groups[key] = [x for x in links if any(w.lower() in x["title"].lower() or w.lower() in x["url"].lower() for w in words)][:8]

    result = {"source": "DMH Myanmar", "source_url": state.DMH_URL, "fetched_at": time.time(), "groups": groups}
    try:
        now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
        result["official_alerts"] = [a.model_dump(mode="json") for a in __import__("main").official_store.for_region(None, now, lookback_days=2)]
        result["official_source_status"] = source_status()
    except Exception:
        result["official_alerts"] = []
    cache_set(dmh_cache, "home", result)
    return result


@router.get("/api/geocode")
async def geocode(
    name: str = Query(..., min_length=2, max_length=80),
    language: str = Query("en", pattern="^(en|my)$"),
    count: int = Query(8, ge=1, le=10),
) -> dict[str, Any]:
    normalized = " ".join(name.split()).lower()
    key = f"{normalized}:{language}:{count}"
    cached = cache_get(geocode_cache, key, state.GEOCODE_CACHE_TTL)
    if cached is not None:
        return cached

    try:
        # The MIMU gazetteer answers Myanmar places locally; this external call is only a fallback, so it gets one
        # short attempt rather than the default retries (which could keep the search spinner going for 20+ s).
        data, _ = await asyncio.wait_for(
            providers.fetch_json(
                state.GEOCODE_URL,
                {"name": name, "count": count, "language": "my" if language == "my" else "en", "format": "json"},
                attempts=1,
            ),
            timeout=6.0,
        )
    except (asyncio.TimeoutError, HTTPException):
        return {"results": [], "degraded": True}
    results = data.get("results") or []
    # The UI is Myanmar-first, while still allowing a fallback result.
    myanmar = [x for x in results if x.get("country_code") == "MM"]
    ordered = myanmar + [x for x in results if x not in myanmar]
    result = {"results": ordered[:count]}
    cache_set(geocode_cache, key, result)
    return result



@router.get("/api/weather")
async def weather(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
) -> dict[str, Any]:
    """Open-Meteo first. Only if it fails do the optional fallbacks run (WeatherAPI, then
    OpenWeatherMap, each only when its key is set). Values from different providers are never averaged together.
    If everything fails, the last good response (up to state.WEATHER_STALE_TTL) is returned, marked stale."""
    key = f"{lat:.2f}:{lon:.2f}"  # 0.01 deg ~ 1 km: nearby lookups share one cache entry
    stored = cache_get(weather_cache, key, state.WEATHER_STALE_TTL)
    now = time.time()
    if stored is not None and now - stored["meta"]["fetched_at"] < state.CACHE_TTL:
        return {**stored, "meta": {**stored["meta"], "cached": True, "stale": False}}

    # Collapse concurrent requests for the same rounded coordinate into one
    # upstream refresh. This matters on mobile reconnects and when several UI
    # panels load at once: one location should not fan out into duplicate API calls.
    pending = state.weather_inflight.get(key)
    if pending is not None:
        try:
            result = await asyncio.shield(pending)
            return {**result, "meta": {**result.get("meta", {}), "cached": True, "shared_refresh": True}}
        except Exception:
            # The original request will report the provider failure; this waiter
            # falls through to the same stale-cache handling below.
            pass

    fut = asyncio.get_running_loop().create_future()
    state.weather_inflight[key] = fut
    failures: list[dict[str, str]] = []
    result: dict[str, Any] | None = None
    try:
        # RIMES is the preferred source when an authorised server-side endpoint
        # has been configured. We never scrape the login-only DataEx UI.
        # Keep the legacy main.py provider hooks working for downstream deployments/tests.
        import main as compat
        if compat.rimes.configured():
            try:
                result = await compat.rimes.fetch(lat, lon, state.client)
            except Exception as exc:  # noqa: BLE001 - continue to public fallback chain
                failures.append({"provider": "RIMES", "error": str(exc)[:180]})

        if result is None:
            try:
                result = await compat._fetch_open_meteo(lat, lon)
            except Exception as exc:  # noqa: BLE001 - any failure means "try the fallbacks"
                detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
                failures.append({"provider": "Open-Meteo", "error": str(detail)[:180]})

        if result is None:
            for fetcher in (compat._fetch_weatherapi, compat._fetch_openweather):
                try:
                    result = providers._fallback_weather(await fetcher(lat, lon), lat, lon)
                    result["meta"]["fallback"] = True
                    break
                except Exception as exc:  # noqa: BLE001
                    if "not configured" not in str(exc):
                        failures.append({"provider": fetcher.__name__.removeprefix("_fetch_"), "error": str(exc)[:180]})

        if result is None:
            if stored is not None:
                stale_result = {**stored, "meta": {**stored["meta"], "cached": True, "stale": True}, "failed_providers": failures}
                if not fut.done(): fut.set_result(stale_result)
                return stale_result
            error = HTTPException(502, "Weather providers are temporarily unavailable. Please try again shortly.")
            # Waiters use a normal result channel; do not store an exception in
            # an otherwise-unobserved Future (that creates noisy asyncio warnings).
            if not fut.done(): fut.set_result(None)
            raise error

        result["meta"].update({"cached": False, "stale": False, "fetched_at": now, "schema_version": "1.0"})
        result["failed_providers"] = failures
        result.setdefault("meta", {})["model"] = state.WEATHER_MODEL
        result["meta"]["model_label"] = "ECMWF IFS HRES 9 km" if state.WEATHER_MODEL == "ecmwf_ifs" else state.WEATHER_MODEL
        cache_set(weather_cache, key, result)
        if not fut.done(): fut.set_result(result)
        return result
    finally:
        state.weather_inflight.pop(key, None)


@router.get("/api/climate")
async def climate(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)) -> dict[str, Any]:
    """Return 40 years of daily ERA5 reanalysis through Open-Meteo."""
    key = f"{lat:.2f}:{lon:.2f}"
    cached = cache_get(climate_cache, key, state.CLIMATE_CACHE_TTL)
    if cached is not None:
        return cached
    end = date(date.today().year - 1, 12, 31)
    start = date(end.year - 39, 1, 1)
    data = await providers.fetch_climate_era5(lat, lon, start, end)
    result = {"source": "ERA5 reanalysis (ECMWF/Copernicus) via Open-Meteo", "data": data}
    cache_set(climate_cache, key, result)
    return result


@router.get("/api/history")
def history(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180), region: str | None = Query(None, pattern=r"^MM-\d{2}$")) -> dict[str, Any]:
    """Modelled 1985-present climate history for the nearest state/region (data/history.json, built by tools/build_history.py)."""
    import json as _json
    cache = state.__dict__.setdefault("_history_doc", {})
    if "doc" not in cache:
        try:
            cache["doc"] = _json.loads((ROOT / "data" / "history.json").read_text(encoding="utf-8"))
        except Exception as exc:
            raise HTTPException(status_code=503, detail="History data unavailable") from exc
    doc = cache["doc"]
    if region and region in doc["regions"]:  # the person picked a region directly (Compare tab): use its own centre, not the selected town
        rid, reg = region, doc["regions"][region]
        lat, lon = reg["lat"], reg["lon"]
    else:
        rid, reg = min(doc["regions"].items(), key=lambda kv: (kv[1]["lat"] - lat) ** 2 + ((kv[1]["lon"] - lon) * 0.95) ** 2)
    ev = [e for e in doc["events"] if rid in e["regions"]]
    from math import hypot, cos, radians
    dist = round(hypot((reg["lat"] - lat) * 111.0, (reg["lon"] - lon) * 111.0 * cos(radians(lat))))
    regions = [{"id": k, "my": v["my"], "en": v["en"]} for k, v in doc["regions"].items()]
    return {"region_id": rid, "regions": regions, "distance_km": dist, "region_centre_only": True, "region": reg, "events": ev, "kind": doc["kind"], "source": doc["source"],
            "baseline": doc["baseline"], "last_full_year": doc["last_full_year"], "last_month": doc["last_month"]}


_recent_rain_cache: dict[tuple[float, float], tuple[float, dict[str, Any]]] = {}


@router.get("/api/recent-rain")
async def recent_rain(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)) -> dict[str, Any]:
    """Rain of the last 7 days (model analysis, not a rain gauge) so saved forecasts can be checked without user input."""
    key = (round(lat, 2), round(lon, 2))
    hit = _recent_rain_cache.get(key)
    if hit and time.time() - hit[0] < 3600:
        return hit[1]
    try:
        data, _ = await providers.fetch_json("https://api.open-meteo.com/v1/forecast", {
            "latitude": lat, "longitude": lon, "daily": "precipitation_sum", "past_days": 7, "forecast_days": 1, "timezone": "auto"})
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Recent rain unavailable") from exc
    d = data.get("daily") or {}
    out = {"days": {t: v for t, v in zip(d.get("time", []), d.get("precipitation_sum", [])) if v is not None},
           "source": "Open-Meteo model analysis (not a rain gauge)"}
    if len(_recent_rain_cache) > 200:
        _recent_rain_cache.clear()
    _recent_rain_cache[key] = (time.time(), out)
    return out


@router.get("/api/about-people")
def about_people() -> list[dict[str, str]]:
    """Names to thank on the About dialog (data/about_people.json: [{"name": "...", "role": "..."}])."""
    import json as _json
    try:
        data = _json.loads((ROOT / "data" / "about_people.json").read_text(encoding="utf-8"))
    except Exception:
        return []
    return [{"name": str(x.get("name", ""))[:80], "role": str(x.get("role", ""))[:80]} for x in data if isinstance(x, dict) and x.get("name")][:50]
