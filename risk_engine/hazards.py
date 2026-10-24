"""Meteorological hazard signals (upstream of health rules).

These are statements about the weather ("very heavy rain is forecast"), never about health. Thresholds come
from data/hazard_thresholds.json; an unset threshold leaves its signal inactive with status 'unset'.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Optional

from .knowledge import KnowledgeBase
from .normalize import NormalizedWeather
from .schemas import HazardSignal, OfficialWarning


@dataclass
class HazardState:
    signals: list[HazardSignal] = field(default_factory=list)
    flood_days: set[date] = field(default_factory=set)          # rainfall proxy days (past + forecast)
    heavy_rain_days: set[date] = field(default_factory=set)
    storm_days: set[date] = field(default_factory=set)
    cold_days: set[date] = field(default_factory=set)
    dry_spell_active: bool = False
    dry_spell_days: int = 0
    dry_spell_status: str = "unset"
    low_visibility_next24h: bool = False
    official_flood: list[OfficialWarning] = field(default_factory=list)
    official_storm: list[OfficialWarning] = field(default_factory=list)

    def flood_within(self, start: date, end: date) -> list[date]:
        return sorted(d for d in self.flood_days if start <= d <= end)


def _val(th: dict) -> Optional[float]:
    return th.get("value") if isinstance(th, dict) else None


def compute_hazards(nw: NormalizedWeather, kb: KnowledgeBase, now: datetime,
                    official: list[OfficialWarning]) -> HazardState:
    st = HazardState()
    today = now.date()
    heavy, very_heavy = kb.threshold("heavy_rain_24h_mm"), kb.threshold("very_heavy_rain_24h_mm")
    storm, dry = kb.threshold("storm_force_wind_kmh"), kb.threshold("dry_spell_min_consecutive_dry_days")
    cold, vis = kb.threshold("cold_spell_tmin_c"), kb.threshold("low_visibility_m")

    # Rainfall categories per day (past days included, for look-back rules)
    for d, p in nw.daily.items("precipitation_sum"):
        if p is None:
            continue
        if _val(very_heavy) is not None and p >= very_heavy["value"]:
            st.flood_days.add(d)
        if _val(heavy) is not None and p >= heavy["value"]:
            st.heavy_rain_days.add(d)
        if d >= today:
            if d in st.flood_days:
                st.signals.append(HazardSignal(hazard="flood_potential", active=True, day=d.isoformat(), value=p, unit="mm/24h",
                                               threshold=very_heavy["value"], threshold_source=very_heavy.get("source"),
                                               threshold_status=very_heavy.get("status", ""),
                                               basis="Rainfall proxy only; rainfall does not establish that flooding occurs."))
            elif d in st.heavy_rain_days:
                st.signals.append(HazardSignal(hazard="heavy_rain", active=True, day=d.isoformat(), value=p, unit="mm/24h",
                                               threshold=heavy["value"], threshold_source=heavy.get("source"),
                                               threshold_status=heavy.get("status", ""), basis="Forecast daily precipitation"))

    # 7-day forecast accumulation (existing dashboard rule) as an additional flood-potential proxy
    f7 = kb.threshold("flood_7day_forecast_mm")
    week = [(d, p) for d, p in nw.daily.items("precipitation_sum") if today <= d < today + timedelta(days=7) and p is not None]
    total7 = sum(p for _, p in week)
    if _val(f7) is not None and week and total7 >= f7["value"]:
        wettest = max(week, key=lambda x: x[1])[0]
        st.flood_days.add(wettest)
        st.signals.append(HazardSignal(hazard="flood_potential_7d", active=True, day=wettest.isoformat(), value=round(total7, 1),
                                       unit="mm/7d", threshold=f7["value"], threshold_source=f7.get("source"),
                                       threshold_status=f7.get("status", ""),
                                       basis="7-day forecast accumulation; rainfall does not establish that flooding occurs."))

    # Storm-force wind (sustained 10 m wind, daily max)
    for d, w in nw.daily.items("wind_speed_10m_max"):
        if w is not None and _val(storm) is not None and w >= storm["value"]:
            st.storm_days.add(d)
            if d >= today:
                st.signals.append(HazardSignal(hazard="storm_force_wind", active=True, day=d.isoformat(), value=w, unit="km/h",
                                               threshold=storm["value"], threshold_source=storm.get("source"),
                                               threshold_status=storm.get("status", ""), basis="Forecast daily max sustained wind"))

    # Cold spell (only when configured)
    if _val(cold) is not None:
        for d, t in nw.daily.items("temperature_2m_min"):
            if t is not None and t <= cold["value"] and d >= today:
                st.cold_days.add(d)
                st.signals.append(HazardSignal(hazard="cold_spell", active=True, day=d.isoformat(), value=t, unit="°C",
                                               threshold=cold["value"], threshold_source=cold.get("source"),
                                               threshold_status=cold.get("status", "")))

    # Dry spell: consecutive dry days ending today (past days + today)
    wet_mm = dry.get("wet_day_mm", 1.0) if isinstance(dry, dict) else 1.0
    run = 0
    for d, p in sorted(nw.daily.items("precipitation_sum")):
        if d > today:
            break
        run = run + 1 if (p is not None and p < wet_mm) else 0
    st.dry_spell_days = run
    fc = kb.threshold("dry_spell_forecast")
    configured = []
    if _val(dry) is not None:
        configured.append(dry.get("status", ""))
        if run >= dry["value"]:
            st.dry_spell_active = True
            st.signals.append(HazardSignal(hazard="dry_spell", active=True, day=today.isoformat(), value=run, unit="days",
                                           threshold=dry["value"], threshold_source=dry.get("source"),
                                           threshold_status=dry.get("status", "")))
    if isinstance(fc, dict) and fc.get("max_7d_forecast_mm") is not None:
        configured.append(fc.get("status", ""))
        tmax = nw.daily.get("temperature_2m_max", today)
        if week and total7 < fc["max_7d_forecast_mm"] and tmax is not None and tmax >= fc["min_tmax_c"]:
            st.dry_spell_active = True
            st.signals.append(HazardSignal(hazard="dry_spell_forecast", active=True, day=today.isoformat(), value=round(total7, 1),
                                           unit="mm/7d", threshold=fc["max_7d_forecast_mm"], threshold_source=fc.get("source"),
                                           threshold_status=fc.get("status", ""), basis=f"with Tmax {tmax} °C"))
    st.dry_spell_status = "unset" if not configured else ", ".join(sorted(set(configured)))

    # Low visibility in the next 24 h
    if _val(vis) is not None:
        low = [v for _, v in nw.hourly.window("visibility", now, now + timedelta(hours=24)) if v < vis["value"]]
        st.low_visibility_next24h = bool(low)
        if low:
            st.signals.append(HazardSignal(hazard="low_visibility", active=True, day=today.isoformat(), value=min(low), unit="m",
                                           threshold=vis["value"], threshold_source=vis.get("source"),
                                           threshold_status=vis.get("status", "")))

    # Official alerts (flags only; the alerts themselves are returned separately)
    st.official_flood = [a for a in official if a.type == "flood"]
    st.official_storm = [a for a in official if a.type in ("cyclone", "storm")]
    return st
