"""Decision layer: 'What Matters Today' (blueprint §6, §21).

Answers What? · So what? · When? · Who? · What next? · Why do we believe this?  Only model signals that are
notices, home-eligible and active within the next 24 hours are eligible. Official warnings are returned
separately and must be rendered in their own visual style (blueprint §7) — they always come first.

Ranking (a documented heuristic, not a score): alert class (advisory > watch > information) → severity →
immediacy (active now > starts within 6 h > within 24 h) → confidence → start time. Confidence is never the
first key, so a well-evidenced minor item cannot outrank a severe, imminent one. Local relevance is built in
(every signal is computed for the requested point, and region-specific items only exist where they apply);
impact is carried by the knowledge base's severity tiers.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from .indices import to_myanmar_digits
from .knowledge import KnowledgeBase
from .schemas import ALERT_CLASS_ORDER, CONFIDENCE_ORDER, SEVERITY_ORDER, Localized, RiskObject, WhatMattersItem

IMMEDIACY_ORDER = {"now": 0, "within_6h": 1, "within_24h": 2}


def immediacy(s: RiskObject, now: datetime) -> str:
    if s.time_window.start <= now:
        return "now"
    return "within_6h" if s.time_window.start < now + timedelta(hours=6) else "within_24h"


def rank_key(s: RiskObject, now: datetime) -> tuple:
    return (-ALERT_CLASS_ORDER[s.alert_class], -SEVERITY_ORDER[s.severity], IMMEDIACY_ORDER[immediacy(s, now)],
            -CONFIDENCE_ORDER[s.confidence.level], s.time_window.start)

MONTHS_MY = ["ဇန်နဝါရီ", "ဖေဖော်ဝါရီ", "မတ်", "ဧပြီ", "မေ", "ဇွန်", "ဇူလိုင်", "ဩဂုတ်", "စက်တင်ဘာ", "အောက်တိုဘာ", "နိုဝင်ဘာ", "ဒီဇင်ဘာ"]
MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _day_word(d, now: datetime) -> tuple[str, str]:
    delta = (d - now.date()).days
    if delta == 0:
        return "ယနေ့", "Today"
    if delta == 1:
        return "မနက်ဖြန်", "Tomorrow"
    return f"{MONTHS_MY[d.month - 1]} {to_myanmar_digits(str(d.day))} ရက်", f"{d.day} {MONTHS_EN[d.month - 1]}"


def format_window(start: datetime, end: datetime, now: datetime) -> Localized:
    if end - start <= timedelta(hours=24) and start.date() == (end - timedelta(minutes=1)).date():
        my_d, en_d = _day_word(start.date(), now)
        s, e = start.strftime("%H:%M"), end.strftime("%H:%M") if end.strftime("%H:%M") != "00:00" else "24:00"
        return Localized(my=f"{my_d} {to_myanmar_digits(s)} – {to_myanmar_digits(e)}", en=f"{en_d} {s}–{e}")
    my_s, en_s = ("ယခု", "Now") if start <= now else _day_word(start.date(), now)
    my_e, en_e = _day_word((end - timedelta(minutes=1)).date(), now)
    return Localized(my=f"{my_s}မှ {my_e}အထိ", en=f"{en_s} until {en_e}")


def what_matters_today(signals: list[RiskObject], kb: KnowledgeBase, now: datetime, limit: int = 3) -> list[WhatMattersItem]:
    horizon = now + timedelta(hours=24)
    eligible = [s for s in signals
                if s.display == "notice" and kb.rule_config(s.rule_id).get("home_eligible")
                and s.time_window.start < horizon and s.time_window.end > now]
    eligible.sort(key=lambda s: rank_key(s, now))
    items = []
    for s in eligible[:limit]:
        sources = [{"citation": src.get("citation"), "url": src.get("url")} for src in kb.entries.get(s.rule_id, {}).get("sources", [])]
        items.append(WhatMattersItem(
            risk_id=s.risk_id, rule_id=s.rule_id, category=s.category, hazard=s.hazard,
            severity=s.severity, severity_label=s.severity_label,
            what=Localized(my=f"{s.label.my} – {s.severity_label.my}", en=f"{s.label.en} – {s.severity_label.en}"),
            so_what=s.notice.possible_risk,
            when=format_window(s.time_window.start, s.time_window.end, now),
            who=s.affected_groups_label,
            what_next=s.notice.what_you_can_do,
            why_we_believe_this={
                "relationship_strength": s.evidence.relationship_strength,
                "myanmar_evidence": s.evidence.myanmar_evidence_label.model_dump(),
                "source_count": s.evidence.source_count,
                "confidence": s.confidence.label.model_dump(),
                "review_status": s.evidence.review_status,
                "drivers": [d.model_dump(mode="json") for d in s.drivers],
                "evidence_endpoint": f"/api/v1/evidence?rule_id={s.rule_id}",
                "is_official_warning": False,
                "alert_class": s.alert_class,
                "time_window": {"start": s.time_window.start.isoformat(), "end": s.time_window.end.isoformat(),
                                "label": format_window(s.time_window.start, s.time_window.end, now).model_dump()},
                "limitations": s.limitations,                 # from the knowledge base (Burmese)
                "limitations_lang": "my",
                "sources": sources,
                "data_sources": [f.source for f in s.data_freshness],
            },
            signal_type=s.signal_type,
            alert_class=s.alert_class, alert_class_label=s.alert_class_label, time_window=s.time_window,
            immediacy=immediacy(s, now),
        ))
    return items
