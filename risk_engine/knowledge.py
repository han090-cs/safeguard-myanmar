"""Evidence and rule knowledge store.

Blueprint §16–17: research content is stored as structured, versioned records (data/*.json, data/*.csv) and is
read here — it is never embedded in rule code or the UI. Rule code only decides *whether* a reviewed rule fires.
"""
from __future__ import annotations

import csv
import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from .config import DATA_DIR
from .schemas import Card, EvidenceSummary, Localized, Notice

EVIDENCE_COLUMNS = [
    "id", "category", "weather_condition", "weather_metric", "threshold", "duration", "environmental_change",
    "secondary_hazard", "health_outcome", "mechanism", "population", "location", "season", "time_lag",
    "evidence_type", "evidence_strength", "knowledge_class", "myanmar_evidence", "regional_evidence",
    "global_evidence", "source_organization", "publication_year", "doi_url", "source_level",
    "warning_eligibility", "notes",
]
NOTICE_KEYS_MY = {"situation": "အခြေအနေ", "possible_risk": "ဖြစ်နိုင်သောအန္တရာယ်",
                  "important_note": "အရေးကြီးသော သတိပြုရန်", "what_you_can_do": "လုပ်ဆောင်နိုင်သော အချက်"}


class _SafeDict(dict):
    """Leaves unknown placeholders visible instead of raising, so a missing value is noticed in QA."""
    def __missing__(self, key):  # pragma: no cover - defensive
        return "{" + key + "}"


def _fill(text: str, values: dict[str, Any]) -> str:
    return text.format_map(_SafeDict({k: v for k, v in values.items() if v is not None}))


class KnowledgeBase:
    def __init__(self, data_dir: Path = DATA_DIR):
        self.data_dir = Path(data_dir)
        km = json.loads((self.data_dir / "knowledge_model.json").read_text(encoding="utf-8"))
        self.meta: dict = km["meta"]
        self.version: str = self.meta.get("version", "unknown")
        self.entries: dict[str, dict] = {e["id"]: e for e in km["knowledge_model"]}
        self.do_not_automate: list[dict] = km.get("do_not_automate", [])
        self.api_variable_map: list[dict] = km.get("api_variable_map", [])
        self.registry: dict = json.loads((self.data_dir / "rule_registry.json").read_text(encoding="utf-8"))
        self.thresholds: dict = json.loads((self.data_dir / "hazard_thresholds.json").read_text(encoding="utf-8"))
        self.location_context: dict = json.loads((self.data_dir / "location_context.json").read_text(encoding="utf-8"))
        self.evidence_records: list[dict] = self._load_evidence()
        self._validate()

    # ------------------------------------------------------------------ loading / validation
    def _load_evidence(self) -> list[dict]:
        path = self.data_dir / "master_evidence.csv"
        with path.open(encoding="utf-8-sig", newline="") as f:
            rows = list(csv.reader(f))
        return [dict(zip(EVIDENCE_COLUMNS, r, strict=True)) for r in rows[1:]]

    def _validate(self) -> None:
        ev_ids = {r["id"] for r in self.evidence_records}
        for rid in list(self.registry["rules"]) + list(self.registry["cards"]):
            if rid not in self.entries:
                raise ValueError(f"Registry references {rid}, which is missing from knowledge_model.json")
            for eid in self.entries[rid].get("evidence_ids", []):
                if eid not in ev_ids:
                    raise ValueError(f"{rid} references evidence {eid}, which is missing from master_evidence.csv")
            if self.entries[rid]["warning_eligibility"] in ("RESEARCH ONLY", "DO NOT USE"):
                raise ValueError(f"{rid} is {self.entries[rid]['warning_eligibility']} and must not be wired as a rule")

    # ------------------------------------------------------------------ accessors
    def rule_config(self, rule_id: str) -> dict:
        return self.registry["rules"][rule_id]

    def card_config(self, card_id: str) -> dict:
        return self.registry["cards"][card_id]

    def threshold(self, key: str) -> dict:
        return self.thresholds.get(key, {"value": None, "status": "unset"})

    def group_labels(self, codes: list[str]) -> list[Localized]:
        labels = self.registry.get("group_labels", {})
        return [Localized(**labels[c]) if c in labels else Localized(my=c, en=c) for c in codes]

    def myanmar_evidence_label(self, level: str) -> Localized:
        return Localized(**self.registry["myanmar_evidence_levels"][level])

    def canonical_region(self, region: Optional[str]) -> Optional[str]:
        if not region:
            return None
        aliases = self.location_context["region_aliases"]
        regions = {r.lower(): r for r in self.location_context["regions"]}
        key = region.strip()
        if key in self.location_context["regions"]:
            return key
        for cand in _region_candidates(key):
            hit = regions.get(cand) or aliases.get(cand)
            if hit:
                return hit
        return None

    def region_in_set(self, region: Optional[str], set_name: str) -> bool:
        return region is not None and region in self.location_context["region_sets"].get(set_name, [])

    def notice(self, rule_id: str, values: dict[str, Any]) -> Notice:
        """Fill the KB message template. Numbers are rendered with Myanmar digits in the Burmese text;
        Localized values (e.g. an AQI category) supply their own Burmese and English wording."""
        msg = self.entries[rule_id]["rule"]["message"]
        v_my, v_en = {}, {}
        for k, v in values.items():
            if isinstance(v, Localized):
                v_my[k], v_en[k] = v.my, v.en
            elif v is not None:
                v_en[k] = str(v)
                v_my[k] = str(v).translate(str.maketrans("0123456789", "၀၁၂၃၄၅၆၇၈၉"))
        return Notice(**{
            k: Localized(my=_fill(msg["my"][NOTICE_KEYS_MY[k]], v_my), en=_fill(msg["en"][k], v_en))
            for k in NOTICE_KEYS_MY
        })

    def evidence_summary(self, item_id: str) -> EvidenceSummary:
        e = self.entries[item_id]
        cfg = self.registry["rules"].get(item_id) or self.registry["cards"].get(item_id)
        level = cfg["myanmar_evidence"]
        return EvidenceSummary(
            relationship_strength=str(e.get("evidence_level", "")),
            knowledge_class=e.get("knowledge_class"),
            myanmar_evidence=level,
            myanmar_evidence_label=self.myanmar_evidence_label(level),
            evidence_location=e.get("evidence_location", []),
            evidence_ids=e.get("evidence_ids", []),
            source_keys=[s["key"] for s in e.get("sources", [])],
            source_count=len(e.get("sources", [])),
            review_status=cfg.get("review_status", "provisional"),
            kb_version=self.version,
        )

    def card(self, card_id: str) -> Card:
        e = self.entries[card_id]
        return Card(card_id=card_id, name=e["name"], text=Localized(**e["text"]),
                    evidence=self.evidence_summary(card_id), limitations=e.get("limitations", []))

    def disclaimer(self) -> Localized:
        return Localized(my=self.meta["mandatory_disclaimer_my"],
                         en="Model-based estimate only. Not an official hazard warning and not a medical diagnosis.")


@lru_cache(maxsize=1)
def get_kb() -> KnowledgeBase:
    return KnowledgeBase()

# Suffixes that geocoders and the dashboard's city list attach to state/region names.
_REGION_SUFFIXES_EN = (" union territory", " territory", " region", " state", " division")
_REGION_SUFFIXES_MY = ("ပြည်ထောင်စုနယ်မြေ", "တိုင်းဒေသကြီး", "တိုင်း", "ပြည်နယ်")


def _region_candidates(name: str) -> list[str]:
    """'Yangon Region' / 'ရန်ကုန်တိုင်း' / 'Shan State (South)' → lookup keys, most specific first."""
    import re
    raw = re.sub(r"\s+", " ", name.strip().lower())
    base = re.sub(r"\s*\(.*?\)\s*", " ", raw).strip()
    for suf in _REGION_SUFFIXES_EN:
        if base.endswith(suf):
            base = base[: -len(suf)].strip()
            break
    for suf in _REGION_SUFFIXES_MY:
        if base.endswith(suf):
            base = base[: -len(suf)].strip()
            break
    out = [raw, base, base.replace(" ", "")]
    return [c for i, c in enumerate(out) if c and c not in out[:i]]
