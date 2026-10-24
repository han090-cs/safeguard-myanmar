"""Optional Google Flood Forecasting API adapter.

The public Flood Hub website is free to use. The Forecasting API is currently
pilot-only and requires a server-side API key. This adapter is therefore
strictly optional: when no key is configured, it reports `not_configured` and
never fabricates flood data.
"""
from __future__ import annotations

import math
import os
from datetime import datetime, timezone
from typing import Any

import httpx

BASE = "https://floodforecasting.googleapis.com"
API_KEY = os.getenv("GOOGLE_FLOOD_HUB_API_KEY", "").strip()
TIMEOUT = float(os.getenv("FLOOD_HUB_TIMEOUT", "10"))


def _loop(lat: float, lon: float, delta: float = 0.20) -> dict[str, list[dict[str, float]]]:
    # A small closed polygon around the selected location. The API accepts an
    # S2 loop made of LatLng points; this is intentionally only a nearby search,
    # not a claim that a gauge affects the exact user location.
    return {"point": [
        {"latitude": lat - delta, "longitude": lon - delta},
        {"latitude": lat - delta, "longitude": lon + delta},
        {"latitude": lat + delta, "longitude": lon + delta},
        {"latitude": lat + delta, "longitude": lon - delta},
        {"latitude": lat - delta, "longitude": lon - delta},
    ]}


def _distance_km(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = math.radians(b_lat - a_lat)
    dl = math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


class FloodHubClient:
    def __init__(self, client: httpx.AsyncClient | None = None):
        self.client = client
        self.last_success_at: str | None = None
        self.last_error: str | None = None

    @property
    def configured(self) -> bool:
        return bool(API_KEY)

    async def nearby_status(self, lat: float, lon: float) -> dict[str, Any]:
        if not self.configured:
            return {"status": "not_configured", "source": "Google Flood Forecasting API",
                    "public_url": "https://sites.research.google/floods/"}
        own = self.client is None
        c = self.client or httpx.AsyncClient(timeout=TIMEOUT)
        try:
            url = f"{BASE}/v1/floodStatus:searchLatestFloodStatusByArea"
            payload = {"loop": _loop(lat, lon), "pageSize": 100, "includeNonQualityVerified": False}
            r = await c.post(url, params={"key": API_KEY}, json=payload)
            r.raise_for_status()
            data = r.json()
            statuses = data.get("floodStatuses", [])
            normalized = []
            for item in statuses:
                gl = item.get("gaugeLocation") or {}
                glat, glon = gl.get("latitude"), gl.get("longitude")
                if glat is None or glon is None:
                    continue
                normalized.append({
                    "gauge_id": item.get("gaugeId"),
                    "quality_verified": bool(item.get("qualityVerified", False)),
                    "distance_km": round(_distance_km(lat, lon, float(glat), float(glon)), 1),
                    "gauge_location": {"latitude": glat, "longitude": glon},
                    "issued_time": item.get("issuedTime"),
                    "forecast_time_range": item.get("forecastTimeRange"),
                    "forecast_trend": item.get("forecastTrend"),
                    "severity": item.get("severity"),
                    "source": item.get("source"),
                    "serialized_notification_polygon_id": item.get("serializedNotificationPolygonId"),
                })
            normalized.sort(key=lambda x: x["distance_km"])
            self.last_success_at = datetime.now(timezone.utc).isoformat()
            self.last_error = None
            return {"status": "available", "source": "Google Flood Forecasting API",
                    "public_url": "https://sites.research.google/floods/", "location": {"lat": lat, "lon": lon},
                    "gauges": normalized[:10], "quality_note": "quality_verified=false requires additional caution."}
        except (httpx.HTTPError, ValueError) as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            return {"status": "temporarily_unavailable", "source": "Google Flood Forecasting API",
                    "public_url": "https://sites.research.google/floods/", "error": "provider_unavailable"}
        finally:
            if own:
                await c.aclose()
