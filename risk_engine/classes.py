"""Public message class for model signals: information / watch / advisory.

"official_warning" is never assigned here: only alerts issued by an authority (DMH) carry it (OfficialWarning).

This is a PRESENTATION policy, not a scientific threshold. It re-uses what the knowledge base already decided
(severity tier, knowledge class, display level) plus how soon the signal starts:

    display is not "notice"                       → information
    severity ≥ high and it starts within 24 h     → advisory
    severity ≥ high, starting later               → watch
    severity moderate                             → watch
    otherwise                                     → information

and then caps the result by how strong the rule's evidence is:

    knowledge class A → advisory at most;  B → watch at most;  C/D or unknown → information only.
    A rule can be capped lower in rule_registry.json with "alert_class_cap" (e.g. R11 mosquito breeding
    sites: the trigger is a design parameter, not a validated vector threshold, so it stays information).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from .knowledge import KnowledgeBase
from .schemas import ALERT_CLASS_LABELS, ALERT_CLASS_ORDER, SEVERITY_ORDER, Localized, RiskObject

CLASS_CAP_BY_KNOWLEDGE = {"A": "advisory", "B": "watch", "C": "information", "D": "information"}
IMMEDIATE = timedelta(hours=24)


def label(cls: str) -> Localized:
    my, en = ALERT_CLASS_LABELS[cls]
    return Localized(my=my, en=en)


def cap_for(kb: KnowledgeBase, rule_id: str) -> str:
    kc = (kb.entries.get(rule_id, {}).get("knowledge_class") or "").strip().upper()[:1]
    cap = CLASS_CAP_BY_KNOWLEDGE.get(kc, "information")
    explicit = kb.rule_config(rule_id).get("alert_class_cap")
    if explicit in ALERT_CLASS_ORDER and ALERT_CLASS_ORDER[explicit] < ALERT_CLASS_ORDER[cap]:
        cap = explicit
    return cap


def classify(s: RiskObject, kb: KnowledgeBase, now: datetime) -> str:
    if s.display != "notice":
        cls = "information"
    else:
        sev = SEVERITY_ORDER[s.severity]
        if sev >= SEVERITY_ORDER["high"]:
            cls = "advisory" if s.time_window.start < now + IMMEDIATE else "watch"
        elif sev >= SEVERITY_ORDER["moderate"]:
            cls = "watch"
        else:
            cls = "information"
    cap = cap_for(kb, s.rule_id)
    if ALERT_CLASS_ORDER[cls] > ALERT_CLASS_ORDER[cap]:
        cls = cap
    return cls


def apply(signals: list[RiskObject], kb: KnowledgeBase, now: datetime) -> None:
    for s in signals:
        s.alert_class = classify(s, kb, now)
        s.alert_class_label = label(s.alert_class)
