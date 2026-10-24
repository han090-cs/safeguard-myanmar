"""Orchestrator: Raw data → Normalized data → Hazard signals → Scientific rules → Risk objects → Decision objects.

`evaluate()` is pure (no I/O) so it can be tested with fixtures; `RiskEngine.assess()` adds fetching and caching.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

from . import classes
from .baseline import Baseline, BaselineStore
from .cards import evaluate_cards
from .conditions import compute_conditions
from .config import ENGINE_VERSION, MYANMAR_TZ, SETTINGS, EngineSettings
from .geo import region_at
from .hazards import compute_hazards
from .knowledge import KnowledgeBase, get_kb
from .metrics import METRICS
from .normalize import NormalizedWeather, normalize
from .official import OfficialAlertStore
from .providers import OpenMeteoClient
from .rules import INDEPENDENT_RULES, RuleContext, r02_hot_night, r06_pm10
from .schemas import ALERT_CLASS_ORDER, SEVERITY_ORDER, Condition, EngineResult, Location, RuleEvaluation
from .status import weather_status

log = logging.getLogger("risk_engine.engine")


def _run_rule(rid: str, fn, *args):
    """Fault isolation: a failing rule is reported as status "error" and never breaks the other rules."""
    try:
        METRICS.inc("rules.evaluated")
        return fn(*args)
    except Exception as exc:                      # noqa: BLE001 – isolation is the point
        log.exception("rule %s failed", rid)
        METRICS.error(f"rule.{rid}", exc)
        return None


def _allowed(kb: KnowledgeBase, rule_id: str, require_approved: bool) -> Optional[RuleEvaluation]:
    cfg = kb.rule_config(rule_id)
    if not cfg.get("enabled", False):
        return RuleEvaluation(rule_id=rule_id, status="disabled")
    if require_approved and cfg.get("review_status") != "approved":
        return RuleEvaluation(rule_id=rule_id, status="not_approved", reason="production mode requires review_status=approved")
    return None


def evaluate(nw: NormalizedWeather, *, kb: Optional[KnowledgeBase] = None, now: Optional[datetime] = None,
             region: Optional[str] = None, name: Optional[str] = None, audience: Optional[set[str]] = None,
             context_flags: Optional[set[str]] = None, horizon_days: int = 3, include_minor: bool = False,
             climate_baseline: Optional[dict] = None, alerts: Optional[OfficialAlertStore] = None,
             settings: EngineSettings = SETTINGS, point: Optional[tuple[float, float]] = None,
             infer_region: bool = True) -> EngineResult:
    kb = kb or get_kb()
    now = (now or datetime.now(timezone.utc)).astimezone(nw.tz or MYANMAR_TZ)
    # State/region: the supplied name if it is recognised, otherwise from the requested coordinates
    # (point; the forecast grid point is a few km off). It gates location cards and official alerts.
    region, region_source = kb.canonical_region(region), None
    if region is not None:
        region_source = "supplied"
    elif infer_region:
        region = region_at(*(point or (nw.lat, nw.lon)))
        region_source = "coordinates" if region else None
    alerts = alerts or OfficialAlertStore(kb.data_dir / "official_alerts.json")
    here = point or (nw.lat, nw.lon)
    official_now = alerts.for_region(region, now, point=here)
    official_lookback = alerts.for_region(region, now, lookback_days=28, point=here)
    hz = compute_hazards(nw, kb, now, official_lookback)
    location = Location(lat=nw.lat, lon=nw.lon, name=name, region=region, region_source=region_source,
                        elevation_m=nw.elevation_m)
    ctx = RuleContext(nw=nw, kb=kb, hz=hz, now=now, location=location, region=region, audience=audience or set(),
                      context_flags=context_flags or set(), horizon_days=max(1, min(horizon_days, 7)),
                      include_minor=include_minor, climate_baseline=climate_baseline,
                      stale=any(f.stale for f in nw.freshness), require_approved=settings.require_approved)

    signals, evals = [], []
    outputs = {}
    for rid, fn in INDEPENDENT_RULES.items():
        blocked = _allowed(kb, rid, settings.require_approved)
        if blocked:
            evals.append(blocked)
            outputs[rid] = []
            continue
        out = _run_rule(rid, fn, ctx)
        if out is None:
            evals.append(RuleEvaluation(rule_id=rid, status="error", reason="rule failed; see diagnostics"))
            outputs[rid] = []
            continue
        outputs[rid] = out.objects
        signals.extend(out.objects)
        evals.append(out.evaluation)
    # dependent rules
    for rid, fn, dep in (("R02", r02_hot_night, "R01"), ("R06", r06_pm10, "R05")):
        blocked = _allowed(kb, rid, settings.require_approved)
        if blocked:
            evals.append(blocked)
            continue
        out = _run_rule(rid, fn, ctx, outputs.get(dep, []))
        if out is None:
            evals.append(RuleEvaluation(rule_id=rid, status="error", reason="rule failed; see diagnostics"))
            continue
        signals.extend(out.objects)
        evals.append(out.evaluation)

    card_out = _run_rule("cards", evaluate_cards, ctx)
    cards, card_evals = card_out if card_out is not None else ([], [])
    evals.extend(card_evals)
    classes.apply(signals, kb, now)
    signals.sort(key=lambda s: (-ALERT_CLASS_ORDER[s.alert_class], -SEVERITY_ORDER[s.severity], s.time_window.start))
    evals.sort(key=lambda e: e.rule_id)
    return EngineResult(location=location, generated_at=now, engine_version=ENGINE_VERSION, kb_version=kb.version,
                        mode=settings.mode, model_signals=signals, informational=cards, official_warnings=official_now,
                        hazards=hz.signals, rule_evaluations=evals, data_freshness=nw.freshness,
                        providers=weather_status(nw), disclaimer=kb.disclaimer())


class RiskEngine:
    def __init__(self, settings: EngineSettings = SETTINGS, kb: Optional[KnowledgeBase] = None,
                 client: Optional[OpenMeteoClient] = None, alerts: Optional[OfficialAlertStore] = None,
                 baseline: Optional[BaselineStore] = None):
        self.settings = settings
        self.kb = kb or get_kb()
        self.client = client or OpenMeteoClient(settings)
        self.alerts = alerts or OfficialAlertStore(self.kb.data_dir / "official_alerts.json")
        self.baseline = baseline or BaselineStore(client=httpx.AsyncClient(
            timeout=60, headers={"User-Agent": "myanmar-weather-risk-engine/1.0"}))

    async def aclose(self) -> None:
        await self.client.aclose()
        await self.baseline.aclose()

    async def climate(self, lat: float, lon: float) -> tuple[NormalizedWeather, Optional[Baseline], list[Condition]]:
        """Forecast and ERA5 baseline are fetched in parallel and fail independently."""
        today = datetime.now(MYANMAR_TZ).date()
        nw, bl = await asyncio.gather(self.load(lat, lon), self.baseline.get(lat, lon, today))
        now = datetime.now(timezone.utc).astimezone(nw.tz or MYANMAR_TZ)
        return nw, bl, compute_conditions(nw, bl, now)

    async def load(self, lat: float, lon: float) -> NormalizedWeather:
        forecast, air = await asyncio.gather(self.client.forecast(lat, lon), self.client.air_quality(lat, lon))
        return normalize(forecast, air, lat, lon, ttl_minutes=self.settings.cache_ttl_seconds // 60,
                         stale_after_minutes=self.settings.stale_after_minutes, now_utc=datetime.now(timezone.utc))

    async def assess(self, lat: float, lon: float, **kwargs) -> tuple[EngineResult, NormalizedWeather]:
        nw = await self.load(lat, lon)
        if "forecast" in nw.errors:
            raise RuntimeError(f"forecast unavailable: {nw.errors['forecast']}")
        kwargs.setdefault("point", (lat, lon))
        return evaluate(nw, kb=self.kb, alerts=self.alerts, settings=self.settings, **kwargs), nw
