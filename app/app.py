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
from app.leaf import router as leaf_router
from app.web import router as web_router
from risk_engine.api import router as risk_router, shutdown_engine
from risk_engine import remote_official
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
    # API docs are public by default only when ENABLE_DOCS=1 (keeps the schema private in production)
    docs_url="/docs" if __import__("os").getenv("ENABLE_DOCS") == "1" else None,
    redoc_url=None,
    openapi_url="/openapi.json" if __import__("os").getenv("ENABLE_DOCS") == "1" else None,
)

LEAF_POST_PATH = "/api/v1/leaf"      # the one POST route (optional AI look at a leaf photo, see app/leaf.py)
LEAF_MAX_BODY = 3_200_000            # bytes; a 1024 px JPEG photo is about 150 KB, so this is generous

allowed_origins = [
    origin.strip().rstrip("/")
    for origin in __import__("os").getenv("ALLOWED_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000").split(",")
    if origin.strip() and origin.strip() != "*"
]
dev_origin_regex = __import__("os").getenv("ALLOWED_ORIGIN_REGEX", "").strip() or None
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_origin_regex=dev_origin_regex, allow_credentials=False, allow_methods=["GET"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=1024)
_hosts = [h.strip() for h in __import__("os").getenv("ALLOWED_HOSTS", "").split(",") if h.strip() and h.strip() != "*"]
if _hosts:  # e.g. ALLOWED_HOSTS=safeguard-myanmar.vercel.app,localhost,127.0.0.1 : rejects forged Host headers
    from starlette.middleware.trustedhost import TrustedHostMiddleware
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=_hosts)


@app.middleware("http")
async def request_guard(request: Request, call_next):
    """Cheap checks before any work: read-only methods (one narrow exception below) and a bounded query string."""
    if request.method == "POST" and request.url.path == LEAF_POST_PATH:
        # The leaf photo route is the only POST: JSON only, a declared size, and a hard cap before the body is read.
        if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
            return JSONResponse({"detail": "JSON only"}, status_code=415)
        try:
            size = int(request.headers.get("content-length", ""))
        except ValueError:
            return JSONResponse({"detail": "Length required"}, status_code=411)
        if size < 0 or size > LEAF_MAX_BODY:
            return JSONResponse({"detail": "Photo too large"}, status_code=413)
    elif request.method not in ("GET", "HEAD", "OPTIONS"):
        return JSONResponse({"detail": "Method not allowed"}, status_code=405, headers={"Allow": "GET, HEAD, OPTIONS"})
    if len(request.url.query) > state.MAX_QUERY_LEN:
        return JSONResponse({"detail": "Query string too long"}, status_code=414)
    return await call_next(request)


# Routes that read official warnings. On a serverless host the DMH importer runs on GitHub (a scheduled workflow) and
# publishes a snapshot; the first such request after the cached copy expires (5 min) fetches it. Never blocks longer
# than the fetch timeout and never fails the request: the last good copy (or the file in the deployment) is used.
OFFICIAL_PREFIXES = ("/api/dmh", "/api/v1/", "/api/forecast-alerts")


@app.middleware("http")
async def official_snapshot(request: Request, call_next):
    if request.url.path.startswith(OFFICIAL_PREFIXES) and remote_official.active():
        try:
            await remote_official.refresh()
        except Exception:  # noqa: BLE001 - official warnings must never take the request down
            pass
    return await call_next(request)


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
    if request.url.path.startswith(state.EXPENSIVE_PREFIXES):
        ekey = "x:" + key
        ews, ecount = state.rate_limit_buckets.get(ekey, (now, 0))
        if now - ews > state.RATE_LIMIT_WINDOW:
            ews, ecount = now, 0
        ecount += 1
        state.rate_limit_buckets[ekey] = (ews, ecount)
        state.rate_limit_buckets.move_to_end(ekey)
        if ecount > state.EXPENSIVE_MAX:
            retry_after = max(1, int(state.RATE_LIMIT_WINDOW - (now - ews)))
            return JSONResponse({"detail": "Too many requests. Please slow down."}, status_code=429, headers={"Retry-After": str(retry_after)})
    return await call_next(request)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "geolocation=(self), microphone=(), camera=()"
    if request.url.scheme == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    if request.url.path.startswith(("/api/", "/health")):
        response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
    else:
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; manifest-src 'self'; worker-src 'self'; "
            "connect-src 'self' https://api.open-meteo.com https://air-quality-api.open-meteo.com https://geocoding-api.open-meteo.com https://archive-api.open-meteo.com; "
            "base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none'",
        )
    return response


app.include_router(risk_router)
app.include_router(api_router)
app.include_router(leaf_router)
app.include_router(web_router)
