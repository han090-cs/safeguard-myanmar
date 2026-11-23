"""Leaf photo "second look" for the Lab (Leaf check): the optional AI route, paid for by whoever uses it.

One downscaled leaf photo goes to a vision model, which says which of the app's OWN listed pests and diseases (pests.js) it looks like.
The Leaf check also has an on-device photo check (rice, potato, cucurbit; models in models/leaf/) and a sign checklist, and both work without this route.

Whose key pays (v9.27):
  * Default: the VISITOR's own key (Anthropic, or Google Gemini since v9.28 — the Lab's key card lets the visitor pick the provider;
    a Gemini key is free to get, which is why it was added). The browser sends the key in the X-User-Api-Key header (and the provider
    in X-Ai-Provider) with each check, this server forwards that one call to that provider and forgets it. It is never stored, logged,
    echoed or put in a URL, and the owner's key is never used for such a call.
  * Opt-in: the owner's ANTHROPIC_API_KEY serves visitors who bring no key ONLY when SG_LEAF_SHARE_SERVER_KEY=1 (a private demo, a
    school or a co-op that pays for its members). Without that flag the owner's key is not used for anyone.

The endpoint stays narrow either way:
  * the browser sends only the photo, a crop id and a language; the candidate list is read from pests.js here, so nobody can put
    their own text into the prompt;
  * the answer must be JSON and is filtered back to ids from that list; free text is length-limited;
  * a small body limit; a per-visitor hourly budget for each mode and, for the owner's shared key, a per-day budget for the whole server
    (all best effort in memory, so on a serverless host each warm instance counts for itself);
  * the key, the photo and the upstream error text are never logged or returned.
No pesticide names or doses, same rule as the rest of the app.
"""
from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import re
import time
from collections import OrderedDict, deque
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app import state

router = APIRouter()
log = logging.getLogger("safeguard.leaf")

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
MAX_IMAGE_BYTES = 1_800_000
MIN_IMAGE_BYTES = 2_000
LANGS = {"en": "English", "my": "Burmese (Myanmar language)", "ja": "Japanese"}
CONF = ("low", "medium", "high")
ISSUES = ("blurry", "too_far", "dark", "not_plant")
KEY_HEADER = "x-user-api-key"
USER_KEY = re.compile(r"^sk-ant-[A-Za-z0-9_\-]{16,256}$")      # the shape of an Anthropic API key; anything else is refused before any call
PROVIDER_HEADER = "x-ai-provider"
GEMINI_KEY = re.compile(r"^AIza[A-Za-z0-9_\-]{20,128}$")       # the shape of a Google API key; anything else is refused before any call
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
_YES = ("1", "true", "yes", "on")

_ip_hits: OrderedDict[str, deque] = OrderedDict()               # owner's shared key, per visitor
_own_hits: OrderedDict[str, deque] = OrderedDict()              # visitor's own key, per visitor (only protects this server from being hammered)
_day = {"d": "", "n": 0}


def _int_env(name: str, default: int) -> int:
    try:
        return max(0, int(os.getenv(name, str(default)) or default))
    except ValueError:
        return default


def per_ip_hour() -> int:
    return _int_env("SG_LEAF_PER_IP_HOUR", 10)


def per_day() -> int:
    return _int_env("SG_LEAF_DAILY_MAX", 300)


def per_ip_hour_own() -> int:
    return _int_env("SG_LEAF_BYOK_PER_HOUR", 30)


def ai_on() -> bool:
    """The AI route exists at all (SG_LEAF_AI=0 switches it off for everyone)."""
    return os.getenv("SG_LEAF_AI", "1") != "0"


def server_key() -> str:
    """The owner's key, and only when the owner chose to share it with every visitor. Empty otherwise."""
    if not ai_on() or os.getenv("SG_LEAF_SHARE_SERVER_KEY", "").strip().lower() not in _YES:
        return ""
    return os.getenv("ANTHROPIC_API_KEY", "").strip()


def enabled() -> bool:
    """Visitors can use the AI look without bringing a key (the owner shares theirs)."""
    return bool(server_key())


def model_name() -> str:
    return os.getenv("SG_LEAF_MODEL", "").strip() or "claude-sonnet-5-5"


def gemini_model_name() -> str:
    return os.getenv("SG_LEAF_GEMINI_MODEL", "").strip() or "gemini-2.5-flash"


# ------------------------------------------------------------------------------------------------ what the app knows (pests.js)

_CROP = re.compile(r'\{id:"([a-z]+)",\s*my:"[^"]*",\s*en:"([^"]+)"')
_ENTRY = re.compile(r'\bE\("([a-z0-9_]+)","([a-z]+)","(pest|disease)","([^"]+)","([^"]*)"')


@lru_cache(maxsize=1)
def catalog() -> dict[str, Any]:
    """{"crops": {id: English name}, "problems": {id: {crop, kind, en, sci}}}, read once from pests.js so there is one list to maintain."""
    src = (state.ROOT / "pests.js").read_text(encoding="utf-8")
    crops = {i: en for i, en in _CROP.findall(src)}
    problems = {i: {"crop": c, "kind": k, "en": en, "sci": sci} for i, c, k, en, sci in _ENTRY.findall(src)}
    return {"crops": crops, "problems": problems}


def candidates(crop: str) -> list[dict[str, str]]:
    return [{"id": i, **p} for i, p in catalog()["problems"].items() if p["crop"] == crop]


# ------------------------------------------------------------------------------------------------ budgets

def _client_key(request: Request) -> str:
    return state._client_ip(request)


def _window(book: OrderedDict, ip: str, now: float, limit: int) -> bool:
    """Record one hit for ip in a sliding one-hour window. False (nothing recorded) when the visitor is over the limit."""
    q = book.get(ip)
    if q is None:
        q = book[ip] = deque()
        while len(book) > 2000:
            book.popitem(last=False)
    else:
        book.move_to_end(ip)
    while q and now - q[0] > 3600:
        q.popleft()
    if limit and len(q) >= limit:
        return False
    q.append(now)
    return True


def take_budget(ip: str, now: float | None = None, own_key: bool = False) -> str | None:
    """Spend one call. Returns None when allowed, else "visitor" or "day" for the budget that is used up.
    own_key=True is a call paid with the visitor's own key: only the per-visitor hourly limit applies (nobody else's money is spent)."""
    now = time.time() if now is None else now
    if own_key:
        return None if _window(_own_hits, ip, now, per_ip_hour_own()) else "visitor"
    today = datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%d")
    if _day["d"] != today:
        _day["d"], _day["n"] = today, 0
    if per_day() and _day["n"] >= per_day():
        return "day"
    if not _window(_ip_hits, ip, now, per_ip_hour()):
        return "visitor"
    _day["n"] += 1
    return None


def reset_budgets() -> None:
    _ip_hits.clear()
    _own_hits.clear()
    _day.update(d="", n=0)


# ------------------------------------------------------------------------------------------------ the request

class LeafIn(BaseModel):
    image: str = Field(min_length=100, max_length=2_500_000)     # base64 of a JPEG/PNG/WebP, optionally as a data: URL
    crop: str = Field(pattern=r"^[a-z]{2,24}$")
    lang: str = Field("en", pattern=r"^(en|my|ja)$")


def decode_image(data: str) -> tuple[bytes, str]:
    if data.startswith("data:"):
        data = data.split(",", 1)[-1]
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, "photo is not valid base64") from None
    if not MIN_IMAGE_BYTES <= len(raw) <= MAX_IMAGE_BYTES:
        raise HTTPException(413 if len(raw) > MAX_IMAGE_BYTES else 422, "photo size is not accepted")
    if raw[:3] == b"\xff\xd8\xff":
        return raw, "image/jpeg"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return raw, "image/png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return raw, "image/webp"
    raise HTTPException(422, "photo must be a JPEG, PNG or WebP image")


def build_prompt(crop: str, lang: str) -> tuple[str, str]:
    cat = catalog()
    cands = candidates(crop)
    system = (
        "You help smallholder farmers in Myanmar recognise crop problems from one photo. You are cautious: a single photo is often not "
        "enough, so say low confidence when unsure and never invent certainty. You never recommend pesticides, product names or doses. "
        "Reply with one JSON object and nothing else."
    )
    listing = "\n".join(f'- {c["id"]}: {c["en"]} ({c["sci"]}), {c["kind"]}' for c in cands)
    user = (
        f"The farmer says this is {cat['crops'].get(crop, crop)}. Look at the photo and decide which of these listed problems, if any, "
        f"it shows:\n{listing}\n\n"
        'Return JSON: {"photo_ok": true|false, "issue": "none"|"blurry"|"too_far"|"dark"|"not_plant", "healthy": true|false, '
        '"matches": [{"id": "<one id from the list>", "confidence": "low"|"medium"|"high", "why": "<=25 words: the visible sign that supports it"}], '
        '"other": "<=20 words about anything visible that is not in the list, or empty"}. '
        "At most 3 matches, best first; empty matches if nothing in the list fits. Use only ids from the list. "
        f"Write why and other in {LANGS.get(lang, 'English')}."
    )
    return system, user


def parse_answer(text: str, crop: str) -> dict[str, Any]:
    """The model's reply, reduced to the shape the screen expects. Anything unexpected is dropped, never passed on."""
    a, b = text.find("{"), text.rfind("}")
    try:
        obj = json.loads(text[a:b + 1]) if a >= 0 and b > a else {}
    except ValueError:
        obj = {}
    if not isinstance(obj, dict):
        obj = {}
    ok = {c["id"] for c in candidates(crop)}

    def clean(v: Any, n: int) -> str:
        return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]+", " ", str(v or ""))).strip()[:n]

    matches, seen = [], set()
    for m in obj.get("matches") or []:
        if isinstance(m, dict) and m.get("id") in ok and m["id"] not in seen:
            seen.add(m["id"])
            matches.append({"id": m["id"], "confidence": m.get("confidence") if m.get("confidence") in CONF else "low", "why": clean(m.get("why"), 240)})
    issue = obj.get("issue") if obj.get("issue") in ISSUES else ""
    if obj.get("photo_ok") is False and not issue:
        issue = "not_plant"
    return {"matches": matches[:3], "healthy": obj.get("healthy") is True and not matches, "issue": issue, "other": clean(obj.get("other"), 160)}


async def call_model(raw: bytes, media_type: str, crop: str, lang: str, key: str, own_key: bool = False) -> str:
    """One Messages API call with the given key. Kept apart so tests can replace it. Raises HTTPException with a generic reason on any failure.
    own_key=True means the key is the visitor's: then a rejected key is reported as "bad_key" (it is theirs to fix), nothing else is said about it."""
    if state.client is None or not key:
        raise HTTPException(503, "off")
    system, user = build_prompt(crop, lang)
    body = {
        "model": model_name(), "max_tokens": 700, "system": system,
        "messages": [{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": base64.b64encode(raw).decode("ascii")}},
            {"type": "text", "text": user}]}],
    }
    try:
        r = await state.client.post(API_URL, json=body, timeout=40, headers={"x-api-key": key, "anthropic-version": API_VERSION, "content-type": "application/json"})
    except Exception as exc:                                   # network or timeout: say nothing about the request itself
        log.warning("leaf: upstream unreachable (%s)", type(exc).__name__)
        raise HTTPException(502, "unavailable") from None
    if r.status_code in (401, 403) and own_key:
        raise HTTPException(401, "bad_key")
    if r.status_code == 429 or r.status_code == 529:
        raise HTTPException(503, "busy")
    if r.status_code != 200:
        log.warning("leaf: upstream status %s", r.status_code)     # status only: the body can echo request details
        raise HTTPException(502, "unavailable")
    try:
        return "".join(b.get("text", "") for b in r.json().get("content", []) if isinstance(b, dict) and b.get("type") == "text")
    except ValueError:
        raise HTTPException(502, "unavailable") from None


async def call_gemini(raw: bytes, media_type: str, crop: str, lang: str, key: str, own_key: bool = False) -> str:
    """One Gemini generateContent call with the given key, same contract as call_model: the reply text, or a generic HTTPException.
    The key travels in the x-goog-api-key header, never in the URL. Gemini answers a rejected key with 400/401/403, so for a
    visitor's own key those all read as "bad_key" (the request itself is built here from validated parts, so it is not the cause)."""
    if state.client is None or not key:
        raise HTTPException(503, "off")
    system, user = build_prompt(crop, lang)
    body = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"parts": [
            {"text": user},
            {"inline_data": {"mime_type": media_type, "data": base64.b64encode(raw).decode("ascii")}},
        ]}],
        "generationConfig": {"maxOutputTokens": 700, "responseMimeType": "application/json"},
    }
    try:
        r = await state.client.post(GEMINI_URL.format(model=gemini_model_name()), json=body, timeout=40,
                                    headers={"x-goog-api-key": key, "content-type": "application/json"})
    except Exception as exc:                                   # network or timeout: say nothing about the request itself
        log.warning("leaf: upstream unreachable (%s)", type(exc).__name__)
        raise HTTPException(502, "unavailable") from None
    if r.status_code in (400, 401, 403) and own_key:
        raise HTTPException(401, "bad_key")
    if r.status_code == 429:
        raise HTTPException(503, "busy")
    if r.status_code != 200:
        log.warning("leaf: upstream status %s", r.status_code)     # status only: the body can echo request details
        raise HTTPException(502, "unavailable")
    try:
        parts = r.json()["candidates"][0]["content"]["parts"]
        return "".join(p.get("text", "") for p in parts if isinstance(p, dict))
    except (ValueError, KeyError, IndexError, TypeError):
        raise HTTPException(502, "unavailable") from None


def _json(data: dict[str, Any], status: int = 200) -> JSONResponse:
    return JSONResponse(data, status_code=status, headers={"Cache-Control": "no-store"})


def resolve_key(request: Request) -> tuple[str, bool, str]:
    """(key, is_the_visitors_own, provider). The visitor's key wins; the owner's key serves a visitor only when the owner shares
    it on purpose (and it is an Anthropic key, so the shared path is always the Anthropic provider). A visitor's key is checked
    against the shape of the provider they picked; a mismatch, or a provider this server does not know, is refused before any call."""
    given = request.headers.get(KEY_HEADER, "").strip()
    if given:
        provider = request.headers.get(PROVIDER_HEADER, "anthropic").strip().lower()
        shape = {"anthropic": USER_KEY, "gemini": GEMINI_KEY}.get(provider)
        if shape is None or not shape.match(given):
            raise HTTPException(401, "bad_key")
        return given, True, provider
    shared = server_key()
    if shared:
        return shared, False, "anthropic"
    raise HTTPException(401, "need_key")


@router.get("/api/v1/leaf/status")
async def leaf_status():
    """What the Lab page needs to know: is the AI look possible at all (byok), and can a visitor use it without their own key (enabled)."""
    on, shared = ai_on(), enabled()
    return _json({"enabled": shared, "byok": on, "per_hour": per_ip_hour() if shared else 0, "byok_per_hour": per_ip_hour_own() if on else 0})


@router.post("/api/v1/leaf")
async def leaf_look(body: LeafIn, request: Request):
    if not ai_on():
        raise HTTPException(503, "off")
    if body.crop not in catalog()["crops"] or not candidates(body.crop):
        raise HTTPException(422, "unknown crop")
    raw, media_type = decode_image(body.image)
    key, own, provider = resolve_key(request)
    spent = take_budget(_client_key(request), own_key=own)
    if spent:
        return _json({"detail": "limit", "scope": spent}, 429)
    if provider == "gemini":
        text = await call_gemini(raw, media_type, body.crop, body.lang, key, own)
        used = gemini_model_name()
    else:
        text = await call_model(raw, media_type, body.crop, body.lang, key, own)
        used = model_name()
    out = parse_answer(text, body.crop)
    out.update(ok=True, model=used, generated=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    return _json(out)
