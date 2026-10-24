"""Rule evaluators R01–R13.

Each evaluator decides only WHETHER a reviewed knowledge-base rule applies to the normalized data, and fills in
drivers, time window and placeholders. Wording, evidence, sources and limitations come from the knowledge base.
No evaluator may produce a disease-occurrence claim; notices describe conditions that "may increase" risk.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Callable, Optional

from . import confidence as conf
from .hazards import HazardState
from .indices import AQI_CATEGORIES, aqi_category, heat_index_c, heat_index_tier
from .knowledge import KnowledgeBase
from .normalize import NormalizedWeather
from .schemas import (SEVERITY_LABELS, Driver, Localized, Location, RiskObject, RuleEvaluation, TimeWindow,
                      Timing)

HI_TIER_SEVERITY = {"extreme_caution": "moderate", "danger": "high", "extreme_danger": "very_high"}
AQI_SEVERITY = {"unhealthy_sensitive": "moderate", "unhealthy": "high", "very_unhealthy": "very_high", "hazardous": "extreme"}


@dataclass
class RuleContext:
    nw: NormalizedWeather
    kb: KnowledgeBase
    hz: HazardState
    now: datetime                      # timezone-aware, local (Asia/Yangon)
    location: Location
    region: Optional[str] = None
    audience: set[str] = field(default_factory=set)
    context_flags: set[str] = field(default_factory=set)   # e.g. {"displacement_site"}
    horizon_days: int = 3
    include_minor: bool = False
    climate_baseline: Optional[dict] = None                 # e.g. {"tmin_hot_night_c": {"4": 27.1, ...}} – must be validated
    stale: bool = False
    require_approved: bool = False

    @property
    def today(self) -> date:
        return self.now.date()

    def days(self) -> list[date]:
        return [self.today + timedelta(days=i) for i in range(self.horizon_days)]

    def day_start(self, d: date) -> datetime:
        return datetime.combine(d, time(0), tzinfo=self.nw.tz)


@dataclass
class RuleOutput:
    objects: list[RiskObject] = field(default_factory=list)
    evaluation: Optional[RuleEvaluation] = None


def _timing(ctx: RuleContext, start: datetime) -> str:
    hours = (start - ctx.now).total_seconds() / 3600
    if hours < 0:
        return "now"
    for label, limit in (("now", 1), ("2h", 2), ("6h", 6), ("12h", 12), ("24h", 24)):
        if hours <= limit:
            return label
    return "7d"


def _build(ctx: RuleContext, rule_id: str, *, severity: str, display: str, start: datetime, end: datetime,
           drivers: list[Driver], values: dict, day_offset: int = 0, data_cap: str = "high",
           upstream: Optional[str] = None, timing: Optional[str] = None, suffix: str = "",
           extra_limitations: Optional[list[str]] = None, official: Optional[list] = None) -> RiskObject:
    kb, cfg, entry = ctx.kb, ctx.kb.rule_config(rule_id), ctx.kb.entries[rule_id]
    ev = kb.evidence_summary(rule_id)
    c = conf.compute(entry["evidence_level"], cfg["threshold_status"], cfg["myanmar_evidence"], day_offset=day_offset,
                     data_cap=data_cap, stale=ctx.stale, upstream=upstream)
    lag = cfg.get("biological_lag")
    my_sev, en_sev = SEVERITY_LABELS[severity]
    return RiskObject(
        risk_id=f"{rule_id}:{ctx.location.lat:.3f},{ctx.location.lon:.3f}:{start.date().isoformat()}{suffix}",
        rule_id=rule_id, name=entry["name"], category=cfg["category"], hazard=cfg["hazard"], label=Localized(**cfg["label"]),
        eligibility=entry["warning_eligibility"], display=display, location=ctx.location,
        severity=severity, severity_label=Localized(my=my_sev, en=en_sev), confidence=c,
        time_window=TimeWindow(start=start, end=end), timing=Timing(meteorological=timing or _timing(ctx, start),
                                                                    biological_lag=Localized(**lag) if lag else None),
        drivers=drivers, affected_groups=cfg["affected_groups"], affected_groups_label=kb.group_labels(cfg["affected_groups"]),
        health_implications=cfg["health_implications"], notice=_notice(kb, rule_id, values, official), evidence=ev,
        limitations=list(entry.get("limitations", [])) + (extra_limitations or []),
        data_freshness=ctx.nw.freshness, frequency_cap=cfg.get("frequency_cap"), disclaimer=kb.disclaimer(),
    )


def _notice(kb, rule_id: str, values: dict, official: Optional[list]):
    """KB notice; when an official warning triggered the rule, the model-based wording is replaced (registry
    'official_basis') so the notice never contradicts the official block shown above it."""
    n = kb.notice(rule_id, values)
    ob = kb.registry.get("official_basis") if official else None
    if not ob:
        return n
    n.important_note = Localized(**ob["important_note"])
    if rule_id in ob.get("situation_rules", []):
        titles_my = "၊ ".join(dict.fromkeys(a.title.my for a in official))
        titles_en = "; ".join(dict.fromkeys(a.title.en for a in official))
        n.situation = Localized(my=ob["situation"]["my"].replace("{alerts}", titles_my),
                                en=ob["situation"]["en"].replace("{alerts}", titles_en))
    return n


def _eval(rule_id: str, status: str, reason: str = "") -> RuleEvaluation:
    return RuleEvaluation(rule_id=rule_id, status=status, reason=reason)


# ----------------------------------------------------------------------------------------------- heat
def _hourly_hi(ctx: RuleContext, start: datetime, end: datetime) -> list[tuple[datetime, float, float, float]]:
    temps = dict(ctx.nw.hourly.window("temperature_2m", start, end))
    rhs = dict(ctx.nw.hourly.window("relative_humidity_2m", start, end))
    out = []
    for t in sorted(set(temps) & set(rhs)):
        hi = heat_index_c(temps[t], rhs[t])
        if hi is not None:
            out.append((t, hi, temps[t], rhs[t]))
    return out


def r01_heat_index(ctx: RuleContext) -> RuleOutput:
    rid = "R01"
    missing = ctx.nw.missing(["temperature_2m", "relative_humidity_2m"])
    if missing:
        return RuleOutput(evaluation=_eval(rid, "insufficient_data", f"missing: {', '.join(missing)}"))
    tiers = ctx.kb.entries[rid]["threshold"]["tiers"]
    objs = []
    for i, d in enumerate(ctx.days()):
        start = max(ctx.day_start(d), ctx.now - timedelta(hours=1)) if i == 0 else ctx.day_start(d)
        series = _hourly_hi(ctx, start, ctx.day_start(d) + timedelta(days=1))
        if not series:
            continue
        t_peak, hi_max, temp_at, rh_at = max(series, key=lambda x: x[1])
        tier = heat_index_tier(hi_max, tiers)
        if tier is None:
            continue
        if tier["display"] != "notice" and tier["display"] != "hazards_tab_only":
            continue
        # Window = hours at or above the reported tier, so the severity label matches the hours shown
        hot = [s for s in series if s[1] >= tier["min"]]
        w_start, w_end = hot[0][0], hot[-1][0] + timedelta(hours=1)
        drivers = [
            Driver(variable="heat_index_max", value=round(hi_max, 1), unit="°C", threshold=tier["min"],
                   threshold_source="US NWS heat index categories", threshold_status="regional_standard_not_myanmar_validated",
                   at=t_peak, note=f"tier={tier['level']}; heat index is defined for shade — full sun can add up to ~8 °C"),
            Driver(variable="temperature_2m", value=temp_at, unit="°C", at=t_peak),
            Driver(variable="relative_humidity_2m", value=rh_at, unit="%", at=t_peak),
        ]
        o = _build(ctx, rid, severity=HI_TIER_SEVERITY[tier["level"]], display=tier["display"], start=w_start, end=w_end,
                   drivers=drivers, values={"hi_max": round(hi_max)}, day_offset=i)
        # attachments: I01 (food safety) always with a notice; I11 only for flagged displacement sites
        if tier["display"] == "notice":
            if ctx.kb.card_config("I01").get("enabled"):
                o.attachments.append(ctx.kb.card("I01"))
            if "displacement_site" in ctx.context_flags and ctx.kb.card_config("I11").get("enabled"):
                o.attachments.append(ctx.kb.card("I11"))
        objs.append(o)
    return RuleOutput(objs, _eval(rid, "triggered" if objs else "not_triggered"))


def r02_hot_night(ctx: RuleContext, r01_objects: list[RiskObject]) -> RuleOutput:
    """Modifier only: attaches to an R01 notice; never emitted on its own."""
    rid = "R02"
    notices = [o for o in r01_objects if o.display == "notice"]
    if not notices:
        return RuleOutput(evaluation=_eval(rid, "not_applicable", "R01 not active"))
    baseline = (ctx.climate_baseline or {}).get("tmin_hot_night_c")
    if not baseline:
        return RuleOutput(evaluation=_eval(rid, "insufficient_data",
                                           "no validated location-specific night-time baseline supplied (engineering parameter)"))
    attached = 0
    for o in notices:
        d = o.time_window.start.date()
        tmin = ctx.nw.daily.get("temperature_2m_min", d + timedelta(days=1)) or ctx.nw.daily.get("temperature_2m_min", d)
        ref = baseline.get(str(d.month))
        if tmin is None or ref is None or tmin < ref:
            continue
        n = ctx.kb.notice(rid, {})
        o.modifiers.append({"rule_id": rid, "label": ctx.kb.rule_config(rid)["label"],
                            "driver": {"variable": "temperature_2m_min", "value": tmin, "reference": ref,
                                       "reference_status": "engineering_parameter_requires_validation"},
                            "notice": n.model_dump(), "evidence": ctx.kb.evidence_summary(rid).model_dump()})
        attached += 1
    return RuleOutput(evaluation=_eval(rid, "triggered" if attached else "not_triggered", "attached as modifier to R01"))


def r03_outdoor_worker(ctx: RuleContext) -> RuleOutput:
    rid = "R03"
    cfg = ctx.kb.rule_config(rid)
    if cfg["requires_audience"] not in ctx.audience:
        return RuleOutput(evaluation=_eval(rid, "not_applicable", "audience opt-in 'outdoor_worker' not set"))
    tiers = ctx.kb.entries["R01"]["threshold"]["tiers"]
    h0, h1 = cfg["work_hours"]
    objs = []
    for i, d in enumerate(ctx.days()[:2]):
        start = ctx.day_start(d) + timedelta(hours=h0)
        end = ctx.day_start(d) + timedelta(hours=h1)
        if end <= ctx.now:
            continue
        series = _hourly_hi(ctx, max(start, ctx.now - timedelta(hours=1)), end)
        if not series:
            continue
        t_peak, hi_max, _, _ = max(series, key=lambda x: x[1])
        tier = heat_index_tier(hi_max, tiers)
        if tier is None:
            continue
        objs.append(_build(ctx, rid, severity=HI_TIER_SEVERITY[tier["level"]], display="notice", start=start, end=end,
                           drivers=[Driver(variable="heat_index_max_work_hours", value=round(hi_max, 1), unit="°C",
                                           threshold=tier["min"], threshold_source="US NWS heat index categories (proxy for WBGT)",
                                           threshold_status="regional_standard_not_myanmar_validated", at=t_peak)],
                           values={"hi_work": round(hi_max)}, day_offset=i))
    return RuleOutput(objs, _eval(rid, "triggered" if objs else "not_triggered"))


# ----------------------------------------------------------------------------------------------- UV
def r04_uv(ctx: RuleContext) -> RuleOutput:
    rid = "R04"
    if not any(v is not None for v in ctx.nw.daily.values.get("uv_index_max", [])):
        return RuleOutput(evaluation=_eval(rid, "insufficient_data", "missing: uv_index_max"))
    objs = []
    for i, d in enumerate(ctx.days()):
        uvi = ctx.nw.daily.get("uv_index_max", d)
        if uvi is None:
            continue
        if uvi >= 11:
            sev, disp, thr = "very_high", "notice", 11
        elif uvi >= 8:
            sev, disp, thr = "high", "notice", 8
        elif uvi >= 3 and ctx.include_minor:
            sev, disp, thr = "moderate", "metric_card_only", 3
        else:
            continue
        hours = [t for t, v in ctx.nw.hourly.window("uv_index", ctx.day_start(d), ctx.day_start(d) + timedelta(days=1)) if v >= thr]
        start, end = (hours[0], hours[-1] + timedelta(hours=1)) if hours else (ctx.day_start(d), ctx.day_start(d) + timedelta(days=1))
        objs.append(_build(ctx, rid, severity=sev, display=disp, start=start, end=end,
                           drivers=[Driver(variable="uv_index_max", value=uvi, unit="UVI", threshold=thr,
                                           threshold_source="WHO Global Solar UV Index", threshold_status="global_standard")],
                           values={"uvi": round(uvi)}, day_offset=i))
    return RuleOutput(objs, _eval(rid, "triggered" if objs else "not_triggered"))


# ----------------------------------------------------------------------------------------------- air
def r05_pm25(ctx: RuleContext) -> RuleOutput:
    rid = "R05"
    air = ctx.nw.air
    if air is None or not air.has("us_aqi_pm2_5"):
        return RuleOutput(evaluation=_eval(rid, "insufficient_data", ctx.nw.errors.get("air_quality", "missing: us_aqi_pm2_5")))
    pm_roll = air.rolling_mean("pm2_5", 24) if air.has("pm2_5") else []
    objs = []
    for i, d in enumerate(ctx.days()):
        s, e = ctx.day_start(d), ctx.day_start(d) + timedelta(days=1)
        if i == 0:
            s = max(s, ctx.now - timedelta(hours=1))
        aqi = air.window("us_aqi_pm2_5", s, e)
        if not aqi:
            continue
        t_peak, aqi_max = max(aqi, key=lambda x: x[1])
        code, label = aqi_category(aqi_max)
        if code in AQI_SEVERITY:
            sev, disp = AQI_SEVERITY[code], "notice"
        elif code == "moderate" and ctx.include_minor:
            sev, disp = "low", "metric_card_only"
        else:
            continue
        pm_vals = [v for t, v in zip(air.times, pm_roll, strict=True) if v is not None and s <= t < e]
        pm_max = max(pm_vals) if pm_vals else None
        drivers = [Driver(variable="us_aqi_pm2_5_max", value=round(aqi_max), unit="US AQI",
                          threshold=next(lo for lo, c, *_ in AQI_CATEGORIES if c == code),
                          threshold_source="US EPA AQI categories", threshold_status="operational_standard_us_epa", at=t_peak)]
        if pm_max is not None:
            drivers.append(Driver(variable="pm2_5_24h_mean_max", value=round(pm_max, 1), unit="µg/m³",
                                  threshold=25, threshold_source="Myanmar NEQG 2015 (24-h) — reference only",
                                  threshold_status="guideline_reference", note="WHO AQG 2021 24-h guideline: 15 µg/m³"))
        objs.append(_build(ctx, rid, severity=sev, display=disp, start=s, end=e, drivers=drivers,
                           values={"aqi": round(aqi_max), "category": label, "pm25": round(pm_max) if pm_max is not None else "—"},
                           day_offset=i, data_cap="moderate"))
    return RuleOutput(objs, _eval(rid, "triggered" if objs else "not_triggered"))


def r06_pm10(ctx: RuleContext, r05_objects: list[RiskObject]) -> RuleOutput:
    rid = "R06"
    air = ctx.nw.air
    if air is None or not air.has("pm10"):
        return RuleOutput(evaluation=_eval(rid, "insufficient_data", ctx.nw.errors.get("air_quality", "missing: pm10")))
    ref = ctx.kb.entries[rid]["threshold"]["reference_values"]["Myanmar_NEQG_2015"]
    r05_days = {o.time_window.start.date() for o in r05_objects if o.display == "notice"}
    roll = air.rolling_mean("pm10", 24)
    objs, suppressed = [], 0
    for i, d in enumerate(ctx.days()):
        s, e = ctx.day_start(d), ctx.day_start(d) + timedelta(days=1)
        vals = [v for t, v in zip(air.times, roll, strict=True) if v is not None and s <= t < e]
        if not vals or max(vals) <= ref:
            continue
        if d in r05_days:
            suppressed += 1
            continue
        objs.append(_build(ctx, rid, severity="moderate", display="notice", start=s, end=e,
                           drivers=[Driver(variable="pm10_24h_mean_max", value=round(max(vals), 1), unit="µg/m³", threshold=ref,
                                           threshold_source="Myanmar NEQG 2015 PM10 24-h guideline",
                                           threshold_status="guideline_exceedance_not_health_threshold")],
                           values={"pm10": round(max(vals))}, day_offset=i, data_cap="moderate"))
    status = "triggered" if objs else ("suppressed" if suppressed else "not_triggered")
    return RuleOutput(objs, _eval(rid, status, "suppressed on days with an R05 notice" if suppressed else ""))


# ----------------------------------------------------------------------------------------------- storms / lightning
def r07_lightning(ctx: RuleContext) -> RuleOutput:
    rid = "R07"
    cfg = ctx.kb.rule_config(rid)
    if ctx.nw.missing(["weather_code"]):
        return RuleOutput(evaluation=_eval(rid, "insufficient_data", "missing: weather_code"))
    end = ctx.now + timedelta(hours=cfg["lookahead_hours"])
    hits = [(t, v) for t, v in ctx.nw.hourly.window("weather_code", ctx.now - timedelta(hours=1), end) if int(v) in cfg["thunder_codes"]]
    if not hits:
        return RuleOutput(evaluation=_eval(rid, "not_triggered"))
    cape = [v for _, v in ctx.nw.hourly.window("cape", hits[0][0], hits[-1][0] + timedelta(hours=1))]
    drivers = [Driver(variable="weather_code", value=hits[0][1], unit="WMO code", threshold_status="meteorological_category",
                      threshold_source="WMO weather code 95/96/99 (thunderstorm)", at=hits[0][0],
                      note=f"{len(hits)} thunderstorm hour(s) in next {cfg['lookahead_hours']} h")]
    if cape:
        drivers.append(Driver(variable="cape_max", value=round(max(cape)), unit="J/kg", threshold_status="no_threshold",
                              note="auxiliary only; no CAPE threshold is used"))
    o = _build(ctx, rid, severity="high", display="notice", start=hits[0][0], end=hits[-1][0] + timedelta(hours=1),
               drivers=drivers, values={}, data_cap="moderate")
    return RuleOutput([o], _eval(rid, "triggered"))


def _flood_driver(ctx: RuleContext, days: list[date]) -> list[Driver]:
    th = ctx.kb.threshold("very_heavy_rain_24h_mm")
    return [Driver(variable="precipitation_sum", value=ctx.nw.daily.get("precipitation_sum", d), unit="mm/24h",
                   threshold=th.get("value"), threshold_source=th.get("source"), threshold_status=th.get("status", ""),
                   at=ctx.day_start(d), note="rainfall proxy for flood potential") for d in days[:3]]


def r08_floodwater(ctx: RuleContext) -> RuleOutput:
    rid = "R08"
    cfg = ctx.kb.rule_config(rid)
    horizon_end = ctx.today + timedelta(days=ctx.horizon_days - 1)
    days = ctx.hz.flood_within(ctx.today, horizon_end)
    official = ctx.hz.official_flood
    if not days and not official:
        return RuleOutput(evaluation=_eval(rid, "not_triggered"))
    if official:
        start = min(a.valid_from for a in official)
        end = max(a.valid_to for a in official) + timedelta(hours=cfg["after_hours"])
        drivers = [Driver(variable="official_flood_alert", threshold_status="official_source", note=a.alert_id) for a in official]
        upstream, offset = "high", 0
    else:
        start = max(ctx.day_start(days[0]), ctx.now)
        end = ctx.day_start(days[-1]) + timedelta(days=1, hours=cfg["after_hours"])
        drivers, upstream, offset = _flood_driver(ctx, days), "low", (days[0] - ctx.today).days
    o = _build(ctx, rid, severity="high", display="notice", start=start, end=end, drivers=drivers, values={},
               upstream=upstream, day_offset=offset, official=official or None)
    return RuleOutput([o], _eval(rid, "triggered"))


def _lookback(ctx: RuleContext, rule_id: str, include_storm: bool) -> RuleOutput:
    cfg = ctx.kb.rule_config(rule_id)
    lb = cfg["lookback_days"]
    first, last = ctx.today - timedelta(days=lb), ctx.today + timedelta(days=ctx.horizon_days - 1)
    days = set(ctx.hz.flood_within(first, last))
    if include_storm:
        days |= {d for d in ctx.hz.storm_days if first <= d <= last}
    official = ctx.hz.official_flood + (ctx.hz.official_storm if include_storm else [])
    if not days and not official:
        return RuleOutput(evaluation=_eval(rule_id, "not_triggered"))
    ends = [ctx.day_start(max(days)) + timedelta(days=1 + lb)] if days else []
    ends += [a.valid_to + timedelta(days=lb) for a in official]
    end = max(ends)
    if end <= ctx.now:
        return RuleOutput(evaluation=_eval(rule_id, "not_triggered", "look-back window has passed"))
    starts = ([ctx.day_start(min(days))] if days else []) + [a.valid_from for a in official]
    event_start = min(starts)
    timing = "past" if event_start < ctx.day_start(ctx.today) else None
    upstream = "high" if official else "low"
    o = _build(ctx, rule_id, severity="moderate", display="notice", start=max(ctx.now, event_start), end=end,
               drivers=(_flood_driver(ctx, sorted(days)) if days else []) +
                       [Driver(variable="official_alert", threshold_status="official_source", note=a.alert_id) for a in official],
               values={}, upstream=upstream, timing=timing, official=official or None)
    return RuleOutput([o], _eval(rule_id, "triggered"))


def r09_leptospirosis_exposure(ctx: RuleContext) -> RuleOutput:
    return _lookback(ctx, "R09", include_storm=False)


def r10_water_food_safety(ctx: RuleContext) -> RuleOutput:
    return _lookback(ctx, "R10", include_storm=True)


def r11_mosquito_habitat(ctx: RuleContext) -> RuleOutput:
    rid = "R11"
    cfg = ctx.kb.rule_config(rid)
    if ctx.today.month not in cfg["months"]:
        return RuleOutput(evaluation=_eval(rid, "not_applicable", "outside rainy/post-monsoon months"))
    wet_mm = ctx.kb.threshold("dry_spell_min_consecutive_dry_days").get("wet_day_mm", 1.0)
    window = [(d, p) for d, p in ctx.nw.daily.items("precipitation_sum")
              if ctx.today - timedelta(days=cfg["lookback_days"] - 1) <= d <= ctx.today and p is not None]
    if not window:
        return RuleOutput(evaluation=_eval(rid, "insufficient_data", "missing: precipitation_sum (past 7 days)"))
    rain_days = [d for d, p in window if p >= wet_mm]
    if not rain_days:
        return RuleOutput(evaluation=_eval(rid, "not_triggered", "no rain day (≥1 mm) in past 7 days"))
    total = sum(p for _, p in window)
    o = _build(ctx, rid, severity="moderate", display="notice", start=ctx.now, end=ctx.now + timedelta(days=7),
               drivers=[Driver(variable="rain_days_past_7d", value=len(rain_days), unit="days", threshold=1,
                               threshold_source="design: ≥1 wet day (≥1 mm, ETCCDI) in 7 days",
                               threshold_status="design_parameter_not_evidence"),
                        Driver(variable="precipitation_past_7d", value=round(total, 1), unit="mm", threshold_status="no_threshold")],
               values={}, timing="now", suffix=":wk" + str(ctx.today.isocalendar()[1]))
    return RuleOutput([o], _eval(rid, "triggered"))


def r12_storm(ctx: RuleContext) -> RuleOutput:
    rid = "R12"
    horizon = {ctx.today + timedelta(days=i) for i in range(ctx.horizon_days)}
    days = sorted(d for d in ctx.hz.storm_days if d in horizon)
    official = ctx.hz.official_storm
    if not days and not official:
        return RuleOutput(evaluation=_eval(rid, "not_triggered"))
    th = ctx.kb.threshold("storm_force_wind_kmh")
    if official:
        start, end = min(a.valid_from for a in official), max(a.valid_to for a in official)
        drivers = [Driver(variable="official_cyclone_or_storm_alert", threshold_status="official_source", note=a.alert_id) for a in official]
        upstream, offset = "high", 0
    else:
        start, end = max(ctx.day_start(days[0]), ctx.now), ctx.day_start(days[-1]) + timedelta(days=1)
        drivers = [Driver(variable="wind_speed_10m_max", value=ctx.nw.daily.get("wind_speed_10m_max", d), unit="km/h",
                          threshold=th.get("value"), threshold_source=th.get("source"), threshold_status=th.get("status", ""),
                          at=ctx.day_start(d)) for d in days]
        upstream, offset = "moderate", (days[0] - ctx.today).days
    o = _build(ctx, rid, severity="high", display="notice", start=start, end=end, drivers=drivers, values={},
               upstream=upstream, day_offset=offset, official=official or None)
    return RuleOutput([o], _eval(rid, "triggered"))


def r13_dry_spell(ctx: RuleContext) -> RuleOutput:
    rid = "R13"
    cfg = ctx.kb.rule_config(rid)
    if ctx.today.month not in cfg["months"]:
        return RuleOutput(evaluation=_eval(rid, "not_applicable", "outside hot-season months"))
    if ctx.hz.dry_spell_status == "unset":
        return RuleOutput(evaluation=_eval(rid, "insufficient_data", "dry-spell threshold not configured (hazard_thresholds.json)"))
    if not ctx.hz.dry_spell_active:
        return RuleOutput(evaluation=_eval(rid, "not_triggered"))
    th = ctx.kb.threshold("dry_spell_min_consecutive_dry_days")
    o = _build(ctx, rid, severity="moderate", display="notice", start=ctx.now, end=ctx.now + timedelta(days=7),
               drivers=[Driver(variable="consecutive_dry_days", value=ctx.hz.dry_spell_days, unit="days",
                               threshold=th.get("value"), threshold_source=th.get("source"), threshold_status=th.get("status", ""))],
               values={}, upstream="moderate", timing="now", suffix=":wk" + str(ctx.today.isocalendar()[1]))
    return RuleOutput([o], _eval(rid, "triggered"))


INDEPENDENT_RULES: dict[str, Callable[[RuleContext], RuleOutput]] = {
    "R01": r01_heat_index, "R03": r03_outdoor_worker, "R04": r04_uv, "R05": r05_pm25, "R07": r07_lightning,
    "R08": r08_floodwater, "R09": r09_leptospirosis_exposure, "R10": r10_water_food_safety,
    "R11": r11_mosquito_habitat, "R12": r12_storm, "R13": r13_dry_spell,
}
