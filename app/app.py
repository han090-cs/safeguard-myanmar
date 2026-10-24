"""FastAPI application assembly: lifecycle, middleware and routers."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app import state
from app.api import router as api_router
from app.web import router as web_router
from risk_engine.api import router as risk_router, shutdown_engine
from risk_engine.dmh_importer import start_background_import
from gazetteer import search_places, nearest_hospitals


@asynccontextmanager
async def lifespan(_: FastAPI):
    state.client = httpx.AsyncClient(
        timeout=httpx.Timeout(state.REQUEST_TIMEOUT, connect=5.0),
        limits=httpx.Limits(max_connections=30, max_keepalive_connections=10),
        headers={"User-Agent": f"MyanmarWeather/{state.APP_VERSION}"},
    )
    await asyncio.to_thread(search_places, "ရန်ကုန်", 8)
    await asyncio.to_thread(nearest_hospitals, 16.85, 96.18, 8)
    dmh_task = start_background_import()
    try:
        yield
    finally:
        if dmh_task is not None:
            dmh_task.cancel()
            try:
                await dmh_task
            except asyncio.CancelledError:
                pass
        if state.client is not None:
            await state.client.aclose()
            state.client = None
        await shutdown_engine()


app = FastAPI(
    title="Myanmar Weather Dashboard API",
    version=state.APP_VERSION,
    description="Stable same-origin proxy and cache for public weather datasets.",
    lifespan=lifespan,
)

allowed_origins = [
    origin.strip().rstrip("/")
    for origin in __import__("os").getenv("ALLOWED_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000").split(",")
    if origin.strip() and origin.strip() != "*"
]
dev_origin_regex = __import__("os").getenv("ALLOWED_ORIGIN_REGEX", "").strip() or None
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_origin_regex=dev_origin_regex, allow_credentials=False, allow_methods=["GET"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    if request.url.path == "/health" or not request.url.path.startswith("/api/"):
        return await call_next(request)
    key = state._client_ip(request)
    now = __import__("time").monotonic()
    window_start, count = state.rate_limit_buckets.get(key, (now, 0))
    if now - window_start > state.RATE_LIMIT_WINDOW:
        window_start, count = now, 0
    count += 1
    state.rate_limit_buckets[key] = (window_start, count)
    state.rate_limit_buckets.move_to_end(key)
    while len(state.rate_limit_buckets) > state.RATE_LIMIT_MAX_CLIENTS:
        state.rate_limit_buckets.popitem(last=False)
    if count > state.RATE_LIMIT_MAX:
        retry_after = max(1, int(state.RATE_LIMIT_WINDOW - (now - window_start)))
        return JSONResponse({"detail": "Too many requests. Please slow down."}, status_code=429, headers={"Retry-After": str(retry_after)})
    return await call_next(request)


# Shared (CDN) cache lifetimes in seconds for read-only GET endpoints. Anything not listed stays no-store.
EDGE_TTL = (
    ("/api/weather", 900), ("/api/v1/", 600), ("/api/local-extras", 3600), ("/api/hazard-feed", 600),
    ("/api/recent-rain", 3600), ("/api/dmh", 300), ("/api/flood", 600), ("/api/enso", 3600),
    ("/api/climate", 86400), ("/api/history", 86400), ("/api/agri", 86400), ("/api/geocode", 86400),
    ("/api/regions", 86400), ("/api/mimu-search", 86400), ("/api/region-at", 86400),
    ("/api/hospitals", 3600), ("/api/about-people", 86400),
)


def _edge_ttl(request: Request) -> int:
    if request.method != "GET" or __import__("os").getenv("EDGE_CACHE", "on").lower() in ("0", "off", "false"):
        return 0
    path = request.url.path
    return next((ttl for prefix, ttl in EDGE_TTL if path.startswith(prefix)), 0)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(self), microphone=(), camera=()"
    if request.url.scheme == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if request.url.path.startswith("/api/"):
        ttl = _edge_ttl(request) if response.status_code == 200 else 0
        # s-maxage lets Vercel's shared CDN answer repeat requests, so they never reach Open-Meteo.
        response.headers.setdefault("Cache-Control", f"public, max-age=60, s-maxage={ttl}, stale-while-revalidate={ttl * 4}" if ttl else "no-store")
    if request.url.path.startswith(("/api/", "/health")):
        response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
    else:
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; manifest-src 'self'; worker-src 'self'; "
            "connect-src 'self' https://api.open-meteo.com https://air-quality-api.open-meteo.com https://geocoding-api.open-meteo.com https://archive-api.open-meteo.com; frame-ancestors 'none'",
        )
    return response


app.include_router(risk_router)
app.include_router(api_router)
app.include_router(web_router)
