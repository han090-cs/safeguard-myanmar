"""Official-warnings snapshot published by the scheduled GitHub workflow (.github/workflows/dmh-import.yml).

Why this exists: a serverless host such as Vercel cannot keep the DMH importer's background loop running and cannot
write files. The workflow runs the importer on GitHub's runners every ~20 minutes and publishes the two JSON files it
writes (official_alerts.json, official_alerts_state.json) as assets of a GitHub release called "dmh-data". This module
reads them over HTTPS, keeps the last good copy in memory and re-checks at most every DMH_DATA_TTL_S seconds.

Safety rules:
- Nothing is ever *removed* because of a network problem: on a failed refresh the last good copy stays.
- The files are only data. Every alert still goes through the OfficialWarning schema in official.py, and the
  importer's own rules (only DMH warning pages, never model output) decided what was written.
- Off by default except on Vercel (VERCEL=1) or when DMH_DATA_URL is set. DMH_DATA_URL=off switches it off.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Optional

import httpx

log = logging.getLogger("risk_engine.remote_official")

FILES = ("official_alerts.json", "official_alerts_state.json")
DEFAULT_REPO = "han090-cs/safeguard-myanmar"
RELEASE_TAG = "dmh-data"
MAX_BYTES = 2_000_000                 # a snapshot is a few KB; anything this big is not ours
FAIL_RETRY_S = 60                     # after a failed refresh, do not try again for this long
_OFF = ("0", "off", "false", "no", "none")

_cache: dict = {"alerts": None, "state": None, "ok_at": 0.0, "fail_at": 0.0, "error": None}
_lock: Optional[asyncio.Lock] = None


def base_url() -> Optional[str]:
    """Where the snapshot files live, or None when remote snapshots are not used."""
    raw = os.getenv("DMH_DATA_URL", "").strip()
    if raw.lower() in _OFF:
        return None
    if raw:
        url = raw.rstrip("/")
    elif os.getenv("VERCEL"):
        owner = os.getenv("VERCEL_GIT_REPO_OWNER") or DEFAULT_REPO.split("/")[0]
        slug = os.getenv("VERCEL_GIT_REPO_SLUG") or DEFAULT_REPO.split("/")[1]
        url = f"https://github.com/{owner}/{slug}/releases/download/{RELEASE_TAG}"
    else:
        return None
    local = url.startswith(("http://127.0.0.1", "http://localhost"))
    return url if url.startswith("https://") or local else None


def active() -> bool:
    return base_url() is not None


def ttl_seconds() -> float:
    try:
        return max(30.0, float(os.getenv("DMH_DATA_TTL_S", "300")))
    except ValueError:
        return 300.0


def alerts_doc() -> Optional[dict]:
    return _cache["alerts"]


def state_doc() -> Optional[dict]:
    return _cache["state"]


def last_ok_epoch() -> float:
    return _cache["ok_at"]


def last_error() -> Optional[str]:
    return _cache["error"]


def reset() -> None:
    """Forget everything (tests)."""
    global _lock
    _cache.update({"alerts": None, "state": None, "ok_at": 0.0, "fail_at": 0.0, "error": None})
    _lock = None


def _valid(doc: object, key: str) -> bool:
    return isinstance(doc, dict) and isinstance(doc.get(key), (list, dict))


async def _fetch_json(client: httpx.AsyncClient, url: str) -> dict:
    r = await client.get(url)
    r.raise_for_status()
    if len(r.content) > MAX_BYTES:
        raise ValueError("snapshot too large")
    return json.loads(r.text)


async def refresh(client: Optional[httpx.AsyncClient] = None, force: bool = False) -> bool:
    """Fetch the snapshot if the cached copy is older than the TTL. True when the cache holds a usable copy."""
    global _lock
    base = base_url()
    if base is None:
        return False
    now = time.monotonic()
    fresh = _cache["alerts"] is not None and now - _cache["ok_at"] < ttl_seconds()
    recently_failed = _cache["fail_at"] > 0 and now - _cache["fail_at"] < FAIL_RETRY_S
    if not force and (fresh or recently_failed):
        return _cache["alerts"] is not None
    if _lock is None:
        _lock = asyncio.Lock()
    async with _lock:
        now = time.monotonic()
        if not force and _cache["alerts"] is not None and now - _cache["ok_at"] < ttl_seconds():
            return True                                   # another request refreshed while we waited
        own = client is None
        client = client or httpx.AsyncClient(timeout=4.0, follow_redirects=True,
                                             headers={"User-Agent": "SafeGuardMyanmar/remote-official"})
        try:
            alerts, state = await asyncio.gather(*(_fetch_json(client, f"{base}/{f}") for f in FILES))
            if not _valid(alerts, "alerts"):
                raise ValueError("alerts file has no alerts list")
            _cache.update({"alerts": alerts, "state": state if _valid(state, "nodes") else {}, "ok_at": now, "fail_at": 0.0, "error": None})
            return True
        except (httpx.HTTPError, ValueError, OSError) as exc:
            _cache.update({"error": type(exc).__name__, "fail_at": time.monotonic()})
            log.warning("DMH snapshot refresh failed: %s", type(exc).__name__)
            return _cache["alerts"] is not None
        finally:
            if own:
                await client.aclose()
