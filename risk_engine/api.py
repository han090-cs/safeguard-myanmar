"""Versioned API (blueprint §15). Mount into the existing FastAPI app:

    from risk_engine.api import router as risk_router
    app.include_router(risk_router)          # serves /api/v1/...

Coverage is restricted to Myanmar because every rule and message is built from a Myanmar-focused evidence base.
"""
from __future__ import annotations

import hmac
import os
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.routing import APIRoute

from . import status as pstatus
from .baseline import PERIOD, SOURCE as BASELINE_SOURCE, monthly_comparison
from .config import ENGINE_VERSION, MYANMAR_TZ
from .decision import what_matters_today
from .dmh_importer import source_status
from .engine import RiskEngine
from .geo import in_myanmar, region_at, region_names
from .metrics import METRICS
from .official import NATIONAL
from .schemas import (Condition, EngineResult, Localized, OfficialWarning, ProviderStatus, RiskObject,
                      WhatMattersItem)


class TimedRoute(APIRoute):
    """Counts requests and records latency per route for /api/v1/diagnostics (no request contents kept)."""

    def get_route_handler(self):
        original = super().get_route_handler()
        path = self.path

        async def handler(request: Request):
            t = time.perf_counter()
            code = 500
            try:
                response = await original(request)
                code = response.status_code
                return response
            except HTTPException as exc:
                code = exc.status_code
                raise
            finally:
                METRICS.observe(f"route {path}", time.perf_counter() - t)
                METRICS.inc(f"http.{code // 100}xx")
        return handler


router = APIRouter(prefix="/api/v1", tags=["risk-intelligence"], route_class=TimedRoute)
_engine: Optional[RiskEngine] = None


def get_engine() -> RiskEngine:
    global _engine
    if _engine is None:
        _engine = RiskEngine()
    return _engine


async def shutdown_engine() -> None:
    if _engine is not None:
        await _engine.aclose()


def _check_coords(lat: float, lon: float) -> None:
    if not in_myanmar(lat, lon):
        raise HTTPException(422, detail="Risk intelligence covers Myanmar only; the evidence base and rules are Myanmar-specific.")


def _csv(value: Optional[str]) -> set[str]:
    return {v.strip() for v in value.split(",") if v.strip()} if value else set()


async def _assess(lat, lon, region, name, audience, context, horizon_days, include_minor) -> EngineResult:
    _check_coords(lat, lon)
    try:
        result, _ = await get_engine().assess(lat, lon, region=region, name=name, audience=_csv(audience),
                                              context_flags=_csv(context), horizon_days=horizon_days,
                                              include_minor=include_minor)
    except RuntimeError as exc:
        raise HTTPException(503, detail=str(exc)) from exc
    result.providers.append(pstatus.official_status(source_status(get_engine().kb.data_dir)))
    return result


COMMON = dict(
    lat=Query(..., ge=-90, le=90), lon=Query(..., ge=-180, le=180),
    region=Query(None, description="State/region (English or Burmese name) — gates location-specific cards"),
    name=Query(None, description="Display name of the location"),
    audience=Query(None, description="Comma list of opt-in audiences, e.g. outdoor_worker"),
    context=Query(None, description="Comma list of context flags, e.g. displacement_site"),
    horizon_days=Query(3, ge=1, le=7),
    include_minor=Query(False, description="Include metric-card-level signals (e.g. UVI 3–7, AQI 51–100)"),
)


@router.get("/risk")
async def risk(lat: float = COMMON["lat"], lon: float = COMMON["lon"], region: Optional[str] = COMMON["region"],
               name: Optional[str] = COMMON["name"], audience: Optional[str] = COMMON["audience"],
               context: Optional[str] = COMMON["context"], horizon_days: int = COMMON["horizon_days"],
               include_minor: bool = COMMON["include_minor"]):
    """All model signals, informational cards, official warnings (separate), hazard signals and rule diagnostics."""
    return await _assess(lat, lon, region, name, audience, context, horizon_days, include_minor)


@router.get("/what-matters-today")
async def what_matters(lat: float = COMMON["lat"], lon: float = COMMON["lon"], region: Optional[str] = COMMON["region"],
                       name: Optional[str] = COMMON["name"], audience: Optional[str] = COMMON["audience"],
                       context: Optional[str] = COMMON["context"], limit: int = Query(3, ge=1, le=5)):
    """Home-screen items (What / So what / When / Who / What next / Why am I seeing this), ranked by class, severity,
    immediacy and confidence; official warnings listed separately."""
    result = await _assess(lat, lon, region, name, audience, context, 2, False)
    return {
        "location": result.location, "generated_at": result.generated_at,
        "official_warnings": result.official_warnings,          # render separately from model signals
        "items": what_matters_today(result.model_signals, get_engine().kb, result.generated_at, limit),
        "data_freshness": result.data_freshness, "disclaimer": result.disclaimer, "mode": result.mode,
        "official_source": _official_source(),       # when DMH was last checked, so "no warning" is never ambiguous
        "providers": result.providers,
    }


def _official_source() -> dict:
    s = source_status(get_engine().kb.data_dir)
    return {k: s[k] for k in ("name", "url", "importer_enabled", "last_success_at", "stale")}


@router.get("/hazards")
async def hazards(lat: float = COMMON["lat"], lon: float = COMMON["lon"], region: Optional[str] = COMMON["region"],
                  horizon_days: int = COMMON["horizon_days"]):
    """Meteorological hazard signals only (no health claims)."""
    result = await _assess(lat, lon, region, None, None, None, horizon_days, False)
    return {"location": result.location, "hazards": result.hazards, "official_warnings": result.official_warnings,
            "data_freshness": result.data_freshness}


@router.get("/health-risk")
@router.get("/health", include_in_schema=False)
async def health_domain(lat: float = COMMON["lat"], lon: float = COMMON["lon"], region: Optional[str] = COMMON["region"],
                        audience: Optional[str] = COMMON["audience"], context: Optional[str] = COMMON["context"],
                        horizon_days: int = COMMON["horizon_days"]):
    """Health tab: health-category signals plus informational cards."""
    result = await _assess(lat, lon, region, None, audience, context, horizon_days, False)
    return {"location": result.location,
            "model_signals": [s for s in result.model_signals if s.category == "health"],
            "informational": result.informational, "official_warnings": result.official_warnings,
            "data_freshness": result.data_freshness, "disclaimer": result.disclaimer}


@router.get("/evidence")
def evidence(rule_id: Optional[str] = None, eligibility: Optional[str] = None, category: Optional[str] = None):
    """Evidence records (knowledge class, eligibility, Myanmar evidence, sources), filterable by rule."""
    kb = get_engine().kb
    records = kb.evidence_records
    if rule_id:
        ids = set(kb.entries.get(rule_id, {}).get("evidence_ids", []))
        records = [r for r in records if r["id"] in ids]
    if eligibility:
        records = [r for r in records if r["warning_eligibility"].upper() == eligibility.upper()]
    if category:
        records = [r for r in records if category.lower() in r["category"].lower()]
    return {"kb_version": kb.version, "count": len(records), "records": records,
            "sources": kb.entries[rule_id]["sources"] if rule_id in kb.entries else None}


@router.get("/evidence/{evidence_id}")
def evidence_one(evidence_id: str):
    """One evidence record by id (E01…)."""
    for r in get_engine().kb.evidence_records:
        if r["id"] == evidence_id:
            return r
    raise HTTPException(404, detail="evidence record not found")


@router.get("/rules")
def rules():
    """Rule registry: review status, eligibility, trigger (MY/EN), threshold and its basis, limitations."""
    kb = get_engine().kb
    out = []
    for rid, cfg in kb.registry["rules"].items():
        e = kb.entries[rid]
        out.append({"rule_id": rid, "name": e["name"], "label": cfg["label"], "enabled": cfg["enabled"],
                    "review_status": cfg["review_status"], "eligibility": e["warning_eligibility"],
                    "trigger": {"my": e["rule"]["trigger_my"], "en": e["rule"]["trigger"]},
                    "threshold": e["threshold"], "threshold_basis": {"my": e.get("threshold_basis_my"), "en": e["threshold_basis"]},
                    "myanmar_evidence": cfg["myanmar_evidence"], "evidence_ids": e["evidence_ids"],
                    "limitations": e["limitations"]})
    return {"kb_version": kb.version, "mode": get_engine().settings.mode, "rules": out}


@router.get("/do-not-automate")
def do_not_automate():
    """Relationships that must never be turned into automated messages, with reasons."""
    return {"items": get_engine().kb.do_not_automate}


@router.get("/official-alerts")
def official_alerts(region: Optional[str] = None):
    """All stored official alerts (current and recent), plus the state of the DMH importer and its review queue."""
    eng = get_engine()
    alerts = eng.alerts.all()
    canon = eng.kb.canonical_region(region)
    if region:
        alerts = [a for a in alerts if canon in a.regions or NATIONAL in a.regions]
    return {"alerts": alerts, "source_status": source_status(eng.kb.data_dir),
            "note": "Only alerts ingested from authoritative sources are listed here."}


# ---------------------------------------------------------------------------------------- climate & agriculture
CLIMATE_NOTE = Localized(
    my="အခုရာသီဥတုကို ၁၉၉၁–၂၀၂၀ ပုံမှန်တန်ဖိုးနဲ့ နှိုင်းယှဉ်ပြထားတာပါ။ သတိပေးချက် မဟုတ်ပါ။",
    en="Descriptions of how recent and forecast weather compare with 1991–2020. These are not warnings.")
AGRI_NOTE = Localized(
    my="မိုးရေ၊ အပူချိန်နဲ့ မြေဆီလွှာ စိုထိုင်းဆ အခြေအနေကိုပဲ ပြထားပါတယ်။ သီးနှံအလိုက် အကြံပြုချက် မပါပါဘူး – "
       "ပြန်လည်သုံးသပ်ပြီးသား စိုက်ပျိုးရေး အထောက်အထား မရှိသေးလို့ပါ။ စိုက်ပျိုးရေး ဆုံးဖြတ်ချက်တွေအတွက် "
       "ဒေသဆိုင်ရာ စိုက်ပျိုးရေး ဦးစီးဌာနနဲ့ တိုင်ပင်ပါ။",
    en="Rainfall, temperature and soil-moisture conditions only. No crop-specific interpretation or farming advice: "
       "no reviewed agronomic evidence base exists yet. For farming decisions, consult the local Department of Agriculture.")
AGRI_EXCLUDED = [
    "crop-specific thresholds (heat, water stress, disease) — need crop, variety and growth-stage evidence for Myanmar",
    "planting, irrigation, spraying or harvest advice — needs agronomic evidence and extension-service review",
    "humidity-driven crop disease risk — no validated local model",
]


def _baseline_meta(bl) -> dict:
    return {"available": bl is not None, "recent_available": bool(bl and bl.recent), "source": BASELINE_SOURCE,
            "period": f"{PERIOD[0]}–{PERIOD[1]}", "grid_point": [bl.lat, bl.lon] if bl else None,
            "method": "Season window ±7 days in each year; rainfall terciles; temperature percentile rank with the "
                      "ETCCDI 10th/90th percentiles; forecast temperatures compared after removing the forecast model's "
                      "recent mean difference from ERA5. Forecast rainfall is not compared with normal."}


def _location(lat: float, lon: float, nw=None) -> dict:
    region = region_at(lat, lon)
    return {"lat": lat, "lon": lon, "grid_lat": getattr(nw, "lat", None), "grid_lon": getattr(nw, "lon", None),
            "region": region, "region_source": "coordinates" if region else None,
            "elevation_m": getattr(nw, "elevation_m", None)}


async def _climate(lat: float, lon: float):
    _check_coords(lat, lon)
    eng = get_engine()
    nw, bl, items = await eng.climate(lat, lon)
    providers: list[ProviderStatus] = pstatus.weather_status(nw)[:1]
    bls = pstatus.baseline_status(True, bl is not None, bool(bl and bl.recent),
                                  datetime.fromisoformat(eng.baseline.last_success_at) if eng.baseline.last_success_at else None)
    providers.append(bls)
    return nw, bl, items, providers


@router.get("/climate")
async def climate(lat: float = COMMON["lat"], lon: float = COMMON["lon"],
                  domain: str = Query("all", pattern="^(all|environment|agriculture)$")):
    """Level-2/3 conditions: today's temperatures and recent rainfall compared with 1991–2020 (ERA5), plus plain
    accumulated quantities. Informational only; never triggers a notice."""
    nw, bl, items, providers = await _climate(lat, lon)
    if domain != "all":
        items = [c for c in items if domain in c.domains]
    return {"location": _location(lat, lon, nw), "generated_at": datetime.now(timezone.utc),
            "conditions": items, "baseline": _baseline_meta(bl), "providers": providers,
            "data_freshness": nw.freshness[:1], "note": CLIMATE_NOTE,
            "agriculture_note": AGRI_NOTE if any("agriculture" in c.domains for c in items) else None,
            "disclaimer": get_engine().kb.disclaimer()}


_REGIONS_DOC: Optional[dict] = None


def _regions_doc() -> dict:
    """State/region centres and names shared with the Compare tab's climate-history card (data/history.json)."""
    global _REGIONS_DOC
    if _REGIONS_DOC is None:
        import json
        from pathlib import Path
        try:
            doc = json.loads((Path(__file__).resolve().parents[1] / "data" / "history.json").read_text(encoding="utf-8"))
            _REGIONS_DOC = {k: v for k, v in doc["regions"].items()}
        except Exception:
            _REGIONS_DOC = {}
    return _REGIONS_DOC


@router.get("/monthly-compare")
async def monthly_compare(lat: float = COMMON["lat"], lon: float = COMMON["lon"],
                          region: Optional[str] = Query(None, pattern=r"^MM-\d{2}$")):
    """This year's monthly mean temperature and rain total against the 1991–2020 normal, both from ERA5, for the Compare
    tab. Descriptive only. A month still in progress is compared with the normal for the same days. With `region`
    (MM-01…) the figures are for that state/region's centre instead of the selected place."""
    regions = _regions_doc()
    if region:
        if region not in regions:
            raise HTTPException(status_code=404, detail="Unknown region")
        lat, lon = regions[region]["lat"], regions[region]["lon"]
    _check_coords(lat, lon)
    eng = get_engine()
    today = datetime.now(MYANMAR_TZ).date()
    base = {"location": _location(lat, lon), "generated_at": datetime.now(timezone.utc), "source": BASELINE_SOURCE,
            "period": f"{PERIOD[0]}–{PERIOD[1]}", "region_id": region,
            "region": {"my": regions[region]["my"], "en": regions[region]["en"]} if region else None,
            "regions": [{"id": k, "my": v["my"], "en": v["en"]} for k, v in regions.items()]}
    bl = await eng.baseline.get(lat, lon, today)
    ytd = await eng.baseline.year_to_date(lat, lon, today) if bl else None
    if bl is None or ytd is None:
        return {**base, "available": False, "reason": "baseline_unavailable" if bl is None else "year_unavailable"}
    return {**base, "available": True, **monthly_comparison(bl.normals, ytd, today)}


@router.get("/agriculture-risk")
@router.get("/agriculture", include_in_schema=False)
async def agriculture(lat: float = COMMON["lat"], lon: float = COMMON["lon"]):
    """Agriculture-relevant conditions only (rain anomaly, dry/wet spell, water balance, soil moisture, heat vs
    normal). No crop-specific risk and no farming advice until an agronomic evidence review exists."""
    nw, bl, items, providers = await _climate(lat, lon)
    return {"location": _location(lat, lon, nw), "generated_at": datetime.now(timezone.utc),
            "status": "conditions_only", "conditions": [c for c in items if "agriculture" in c.domains],
            "risks": [], "crop_specific": None, "excluded": AGRI_EXCLUDED, "baseline": _baseline_meta(bl),
            "providers": providers, "note": AGRI_NOTE, "disclaimer": get_engine().kb.disclaimer()}


# ---------------------------------------------------------------------------------------- alerts & locations
@router.get("/alerts")
async def alerts(lat: float = COMMON["lat"], lon: float = COMMON["lon"], region: Optional[str] = COMMON["region"]):
    """Everything with a public message class for this place: official warnings (DMH) first, then model
    advisories and watches. Information-class items are left to the full /risk response."""
    result = await _assess(lat, lon, region, None, None, None, 3, False)
    model = [s for s in result.model_signals if s.alert_class in ("advisory", "watch")]
    return {"location": result.location, "generated_at": result.generated_at,
            "official_warnings": result.official_warnings,
            "model_alerts": [{"risk_id": s.risk_id, "rule_id": s.rule_id, "label": s.label, "alert_class": s.alert_class,
                              "alert_class_label": s.alert_class_label, "severity": s.severity,
                              "severity_label": s.severity_label, "time_window": s.time_window,
                              "situation": s.notice.situation, "what_you_can_do": s.notice.what_you_can_do,
                              "confidence": s.confidence.label, "official_warning": False} for s in model],
            "official_source": _official_source(), "providers": result.providers, "disclaimer": result.disclaimer}


@router.get("/locations/resolve")
def locations_resolve(lat: float = COMMON["lat"], lon: float = COMMON["lon"]):
    """Location levels for a GPS point. State/region comes from OpenStreetMap boundaries; district and township
    are not resolved yet (no reviewed boundary data in the engine), and are returned as null rather than guessed."""
    inside = in_myanmar(lat, lon)
    region = region_at(lat, lon) if inside else None
    names = region_names().get(region, {}) if region else {}
    return {"lat": lat, "lon": lon, "in_coverage": inside,
            "levels": {"region": {"key": region, "name": {"my": names.get("my"), "en": names.get("en")},
                                  "iso_3166_2": names.get("iso_3166_2"), "source": "OpenStreetMap admin_level=4 (ODbL)"}
                       if region else None,
                       "district": None, "township": None},
            "note": "District and township lookup is not available yet; the engine never guesses them."}


# ---------------------------------------------------------------------------------------- contracts & operations
_SCHEMA_MODELS = {"RiskObject": RiskObject, "WhatMattersItem": WhatMattersItem, "OfficialWarning": OfficialWarning,
                  "Condition": Condition, "ProviderStatus": ProviderStatus, "EngineResult": EngineResult}


@router.get("/schema")
def schema(model: Optional[str] = None):
    """JSON Schema of the public objects (the UI and a future map consume the same objects)."""
    if model:
        if model not in _SCHEMA_MODELS:
            raise HTTPException(404, detail=f"unknown model; one of {sorted(_SCHEMA_MODELS)}")
        return _SCHEMA_MODELS[model].model_json_schema()
    return {name: m.model_json_schema() for name, m in _SCHEMA_MODELS.items()}


@router.get("/status")
def service_status():
    """Public, location-independent status of each source (no error details)."""
    eng = get_engine()
    src = source_status(eng.kb.data_dir)
    last, errs = getattr(eng.client, "last_success_at", {}), getattr(eng.client, "last_error_at", {})

    def upstream(key: str, source: str) -> dict:
        at, err_at = last.get(source), errs.get(source)
        failing = err_at is not None and (at is None or err_at > at)
        state = "temporarily_unavailable" if failing else "available" if at else "not_configured"
        return {"key": key, "status": state, "last_success_at": at}

    return {"engine_version": ENGINE_VERSION, "kb_version": eng.kb.version, "mode": eng.settings.mode,
            "sources": [upstream("forecast", "Open-Meteo Forecast"), upstream("air_quality", "Open-Meteo Air Quality (CAMS)"),
                        {"key": "baseline", "status": "available" if eng.baseline.last_success_at else "not_configured",
                         "last_success_at": eng.baseline.last_success_at},
                        pstatus.official_status(src).model_dump(mode="json")]}


@router.get("/diagnostics", include_in_schema=False)
def diagnostics(x_diagnostics_token: Optional[str] = Header(None)):
    """Internal. Enabled only when DIAGNOSTICS_TOKEN is set; the caller must send it as X-Diagnostics-Token.
    Otherwise the route answers 404 as if it did not exist."""
    token = os.getenv("DIAGNOSTICS_TOKEN")
    if not token or not x_diagnostics_token or not hmac.compare_digest(token, x_diagnostics_token):
        raise HTTPException(404, detail="Not Found")
    eng = get_engine()
    return {"engine_version": ENGINE_VERSION, "kb_version": eng.kb.version, "mode": eng.settings.mode,
            "metrics": METRICS.snapshot(),
            "upstream": {"last_success_at": getattr(eng.client, "last_success_at", None),
                         "last_error": getattr(eng.client, "last_error", None),
                         "cache_entries": len(getattr(getattr(eng.client, "cache", None), "_data", {})),
                         "inflight": len(getattr(eng.client, "_inflight", {}))},
            "baseline": eng.baseline.status(), "official_source": source_status(eng.kb.data_dir)}
