"""Categorical confidence. Deliberately simple and transparent; it is not a calibrated probability.

overall = min(evidence, threshold, data), then capped at 'moderate' when Myanmar-specific evidence is only
event reports or absent (the relationship has not been validated in Myanmar).
"""
from __future__ import annotations

from .schemas import CONFIDENCE_ORDER, Confidence, Localized

LABELS = {"low": Localized(my="နိမ့်", en="LOW"), "moderate": Localized(my="အလယ်အလတ်", en="MODERATE"),
          "high": Localized(my="မြင့်", en="HIGH")}
THRESHOLD_COMPONENT = {
    "global_standard": "high", "operational_standard_us_epa": "high", "meteorological_category": "high",
    "regional_standard_not_myanmar_validated": "moderate", "no_threshold": "moderate",
    "guideline_exceedance_not_health_threshold": "low",
}


def _lvl(text: str) -> str:
    t = (text or "").strip().lower()
    if t.startswith("high"):
        return "high"
    if t.startswith("moderate"):
        return "moderate"
    return "low"


def _min(*levels: str) -> str:
    return min(levels, key=lambda x: CONFIDENCE_ORDER[x])


def _down(level: str) -> str:
    return {"high": "moderate", "moderate": "low", "low": "low"}[level]


def lead_time_level(day_offset: int) -> str:
    return "high" if day_offset <= 1 else ("moderate" if day_offset == 2 else "low")


def compute(evidence_level: str, threshold_status: str, myanmar_evidence: str, *, day_offset: int = 0,
            data_cap: str = "high", stale: bool = False, upstream: str | None = None) -> Confidence:
    evidence = _lvl(evidence_level)
    threshold = upstream if threshold_status == "depends_on_upstream_signal" and upstream else THRESHOLD_COMPONENT.get(threshold_status, "moderate")
    data = _min(lead_time_level(day_offset), data_cap)
    if stale:
        data = _down(data)
    overall = _min(evidence, threshold, data)
    if myanmar_evidence in ("myanmar_reports_only", "none") and overall == "high":
        overall = "moderate"
    return Confidence(level=overall, label=LABELS[overall],
                      components={"evidence": evidence, "threshold": threshold, "data": data})
