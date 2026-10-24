"""Universal risk / intelligence object and related contracts (blueprint §4), with two corrections:

1. Evidence is split into the global strength of the relationship and the level of Myanmar-specific
   evidence, so a heat signal can never claim "established + Myanmar-specific" when Myanmar only has
   event reports.
2. Confidence is categorical with its components exposed. It is explicitly NOT a probability.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

Severity = Literal["low", "moderate", "high", "very_high", "extreme"]
SignalType = Literal["model_signal", "informational", "official_warning"]
ConfidenceLevel = Literal["low", "moderate", "high"]
Display = Literal["notice", "hazards_tab_only", "metric_card_only", "health_tab_card"]
MyanmarEvidence = Literal["myanmar_epidemiological", "myanmar_exposure_or_burden_only", "myanmar_reports_only", "none"]

SEVERITY_ORDER = {"low": 0, "moderate": 1, "high": 2, "very_high": 3, "extreme": 4}
SEVERITY_LABELS = {
    "low": ("နိမ့်", "LOW"), "moderate": ("အလယ်အလတ်", "MODERATE"), "high": ("မြင့်", "HIGH"),
    "very_high": ("အလွန်မြင့်", "VERY HIGH"), "extreme": ("အလွန်အမင်း", "EXTREME"),
}
CONFIDENCE_ORDER = {"low": 0, "moderate": 1, "high": 2}

# Public message classes (master prompt §"warning language"). Model signals can be information, watch or advisory;
# "official_warning" is reserved for alerts issued by an authority (DMH) and can never be produced by a rule.
AlertClass = Literal["information", "watch", "advisory", "official_warning"]
ModelAlertClass = Literal["information", "watch", "advisory"]
ALERT_CLASS_ORDER = {"information": 0, "watch": 1, "advisory": 2, "official_warning": 3}
ALERT_CLASS_LABELS = {
    "information": ("သိထားသင့်တဲ့ အချက်", "Information"),
    "watch": ("စောင့်ကြည့်ရန်", "Watch"),
    "advisory": ("သတိပြုရန်", "Advisory"),
    "official_warning": ("တရားဝင်သတိပေးချက်", "Official warning"),
}
ProviderState = Literal["available", "stale", "temporarily_unavailable", "not_configured"]


class Localized(BaseModel):
    my: str
    en: str


class Location(BaseModel):
    lat: float
    lon: float
    name: Optional[str] = None
    region: Optional[str] = None
    region_source: Optional[str] = None      # "supplied" (recognised region parameter) or "coordinates"
    elevation_m: Optional[float] = None
    timezone: str = "Asia/Yangon"


class TimeWindow(BaseModel):
    start: datetime
    end: datetime
    timezone: str = "Asia/Yangon"


class Timing(BaseModel):
    """Meteorological timing is kept separate from biological/environmental lag (blueprint §13)."""
    meteorological: Literal["past", "now", "2h", "6h", "12h", "24h", "7d"]
    biological_lag: Optional[Localized] = None


class Driver(BaseModel):
    variable: str
    value: Optional[float] = None
    unit: Optional[str] = None
    threshold: Optional[float] = None
    threshold_source: Optional[str] = None
    threshold_status: str = "no_threshold"
    at: Optional[datetime] = None
    note: Optional[str] = None


class Confidence(BaseModel):
    level: ConfidenceLevel
    label: Localized
    components: dict[str, ConfidenceLevel]
    is_probability: bool = False
    note: str = "Categorical confidence from evidence strength, threshold transferability and data quality; not a probability."


class EvidenceSummary(BaseModel):
    relationship_strength: str = Field(description="Global strength of the weather→health relationship, from the knowledge base")
    knowledge_class: Optional[str] = None
    myanmar_evidence: MyanmarEvidence
    myanmar_evidence_label: Localized
    evidence_location: list[str] = []
    evidence_ids: list[str] = []
    source_keys: list[str] = []
    source_count: int = 0
    review_status: Literal["provisional", "approved", "rejected"]
    kb_version: str


class SourceFreshness(BaseModel):
    source: str
    fetched_at: Optional[datetime] = None
    model: Optional[str] = None
    next_expected_update: Optional[datetime] = None
    stale: bool = False


class Notice(BaseModel):
    situation: Localized
    possible_risk: Localized
    important_note: Localized
    what_you_can_do: Localized


class Card(BaseModel):
    card_id: str
    name: str
    signal_type: SignalType = "informational"
    text: Localized
    evidence: EvidenceSummary
    limitations: list[str] = []


class RiskObject(BaseModel):
    risk_id: str
    rule_id: str
    name: str
    category: str
    hazard: str
    label: Localized
    signal_type: SignalType = "model_signal"
    status: SignalType = "model_signal"          # kept for compatibility with the blueprint's example object
    eligibility: str
    display: Display
    location: Location
    severity: Severity
    severity_label: Localized
    confidence: Confidence
    time_window: TimeWindow
    timing: Timing
    drivers: list[Driver] = []
    affected_groups: list[str] = []
    affected_groups_label: list[Localized] = []
    health_implications: list[str] = []
    notice: Notice
    modifiers: list[dict] = []
    attachments: list[Card] = []
    evidence: EvidenceSummary
    limitations: list[str] = []
    data_freshness: list[SourceFreshness] = []
    frequency_cap: Optional[str] = None
    official_warning: Literal[False] = False
    alert_class: ModelAlertClass = "information"
    alert_class_label: Optional[Localized] = None
    disclaimer: Localized


class OfficialWarning(BaseModel):
    alert_id: str
    issuer: str
    type: str
    regions: list[str]
    valid_from: datetime
    valid_to: datetime
    url: Optional[str] = None
    links: Optional[Localized] = None          # the issuer's page in each language, when it has both
    title: Localized
    summary: Optional[Localized] = None
    source: Optional[str] = None                # "dmh" for imported alerts; absent for manual entries
    stations: Optional[list[str]] = None        # river flood warnings: the gauging stations named
    points: Optional[list[tuple[float, float]]] = None   # [lat, lon] of those stations; matching is by distance
    signal_type: SignalType = "official_warning"
    official_warning: Literal[True] = True
    alert_class: Literal["official_warning"] = "official_warning"
    retrieved_at: Optional[datetime] = None


class HazardSignal(BaseModel):
    """Meteorological hazard state (not a health claim)."""
    hazard: str
    active: bool
    day: Optional[str] = None
    value: Optional[float] = None
    unit: Optional[str] = None
    threshold: Optional[float] = None
    threshold_source: Optional[str] = None
    threshold_status: str = "unset"
    basis: str = ""


class RuleEvaluation(BaseModel):
    rule_id: str
    status: Literal["triggered", "not_triggered", "insufficient_data", "disabled", "not_approved", "suppressed",
                    "not_applicable", "error"]
    reason: str = ""


class WhatMattersItem(BaseModel):
    risk_id: str
    rule_id: str
    category: str
    hazard: str
    severity: Severity
    severity_label: Localized
    what: Localized
    so_what: Localized
    when: Localized
    who: list[Localized]
    what_next: Localized
    why_we_believe_this: dict
    signal_type: SignalType
    alert_class: ModelAlertClass = "information"
    alert_class_label: Optional[Localized] = None
    time_window: Optional[TimeWindow] = None
    immediacy: Optional[Literal["now", "within_6h", "within_24h"]] = None


class Metric(BaseModel):
    """Level-3 technical value behind a condition."""
    key: str
    label: Localized
    value: Optional[float] = None
    unit: str = ""


class Condition(BaseModel):
    """Level-2 environmental/agricultural condition: a description of how things compare with normal.
    Always informational: it never triggers a notice and is never an official warning."""
    condition_id: str
    kind: str
    domains: list[str]
    signal_type: Literal["informational"] = "informational"
    official_warning: Literal[False] = False
    level: Optional[str] = None
    level_label: Optional[Localized] = None
    title: Localized
    headline: Localized
    metrics: list[Metric] = []
    baseline: Optional[dict] = None
    sources: list[str] = []
    limitations: list[Localized] = []
    time_window: TimeWindow


class ProviderStatus(BaseModel):
    """Per-source availability, so one failing source never hides the others (e.g. weather available, air
    quality temporarily unavailable). Public: carries no error details (those are in /api/v1/diagnostics)."""
    key: str
    label: Localized
    status: ProviderState
    status_label: Localized
    updated_at: Optional[datetime] = None


class EngineResult(BaseModel):
    location: Location
    generated_at: datetime
    engine_version: str
    kb_version: str
    mode: str
    model_signals: list[RiskObject] = []
    informational: list[Card] = []
    official_warnings: list[OfficialWarning] = []
    hazards: list[HazardSignal] = []
    rule_evaluations: list[RuleEvaluation] = []
    data_freshness: list[SourceFreshness] = []
    providers: list[ProviderStatus] = []
    disclaimer: Localized
