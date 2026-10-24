"""Public per-source status ("Weather: available · Air quality: temporarily unavailable · …").

Each source fails independently; this block lets the UI say which part is missing instead of failing the whole
screen. No error messages are exposed here (see /api/v1/diagnostics for those).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from .normalize import NormalizedWeather
from .schemas import Localized, ProviderStatus

LABELS = {
    "forecast": ("မိုးလေဝသ ခန့်မှန်းချက်", "Weather forecast"),
    "air_quality": ("လေထုအရည်အသွေး", "Air quality"),
    "baseline": ("ရာသီဥတု ပုံမှန်တန်ဖိုး (၁၉၉၁–၂၀၂၀)", "Climate normal (1991–2020)"),
    "official_alerts": ("တရားဝင်သတိပေးချက် (DMH)", "Official alerts (DMH)"),
}
STATE_LABELS = {
    "available": ("ရနိုင်ပါတယ်", "Available"),
    "stale": ("နောက်ဆုံးရတဲ့ ဒေတာ (ဟောင်းနေနိုင်)", "Last available data (may be out of date)"),
    "temporarily_unavailable": ("ယာယီ မရနိုင်ပါ", "Temporarily unavailable"),
    "not_configured": ("ဖွင့်မထားပါ", "Not enabled"),
}


def _ps(key: str, state: str, updated_at: Optional[datetime] = None) -> ProviderStatus:
    return ProviderStatus(key=key, label=Localized(my=LABELS[key][0], en=LABELS[key][1]), status=state,
                          status_label=Localized(my=STATE_LABELS[state][0], en=STATE_LABELS[state][1]),
                          updated_at=updated_at)


def weather_status(nw: NormalizedWeather) -> list[ProviderStatus]:
    out = []
    for key, f in zip(("forecast", "air_quality"), nw.freshness, strict=True):
        if key in nw.errors:
            out.append(_ps(key, "temporarily_unavailable"))
        else:
            out.append(_ps(key, "stale" if f.stale else "available", f.fetched_at))
    return out


def baseline_status(requested: bool, available: bool, recent_available: bool,
                    updated_at: Optional[datetime] = None) -> Optional[ProviderStatus]:
    if not requested:
        return None
    if not available:
        return _ps("baseline", "temporarily_unavailable")
    return _ps("baseline", "available" if recent_available else "stale", updated_at)


def official_status(src: dict) -> ProviderStatus:
    if not src.get("importer_enabled", True) and not src.get("last_success_at"):
        return _ps("official_alerts", "not_configured")
    ts = src.get("last_success_at")
    when = datetime.fromisoformat(ts) if isinstance(ts, str) else ts
    if when is None:
        return _ps("official_alerts", "temporarily_unavailable")
    return _ps("official_alerts", "stale" if src.get("stale") else "available", when)
