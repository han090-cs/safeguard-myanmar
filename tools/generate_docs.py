"""Regenerate the tables in docs/ that are derived from code and data, so the docs cannot drift from them.

    python tools/generate_docs.py

Replaces the text between <!-- BEGIN GENERATED:name --> and <!-- END GENERATED:name --> markers in
docs/RISK_RULES.md, docs/API.md and docs/SAFETY_EVIDENCE.md. Everything outside the markers is hand-written.
Also refreshes docs/types/risk.d.ts and docs/schema/risk_objects.schema.json (tools/export_types.py).
"""
from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

from fastapi import FastAPI  # noqa: E402

import export_types  # noqa: E402
from risk_engine import classes  # noqa: E402
from risk_engine.api import router  # noqa: E402
from risk_engine.knowledge import get_kb  # noqa: E402

DOCS = ROOT / "docs"


def _cell(v) -> str:
    return str(v if v not in (None, "") else "—").replace("|", "\\|").replace("\n", " ")


def rules_table() -> str:
    kb = get_kb()
    rows = ["| Rule | Name (EN / MY) | Hazard | Knowledge class | Eligibility | Threshold status | Myanmar evidence | Max public class | Review |",
            "|---|---|---|---|---|---|---|---|---|"]
    for rid, cfg in kb.registry["rules"].items():
        e = kb.entries[rid]
        rows.append("| " + " | ".join(_cell(x) for x in (
            rid, f"{cfg['label']['en']} / {cfg['label']['my']}", cfg["hazard"], e.get("knowledge_class"),
            e.get("warning_eligibility"), cfg.get("threshold_status"), cfg.get("myanmar_evidence"),
            classes.cap_for(kb, rid), cfg.get("review_status"))) + " |")
    return "\n".join(rows)


def thresholds_table() -> str:
    kb = get_kb()
    rows = ["| Rule | Threshold basis (from the knowledge base) |", "|---|---|"]
    for rid in kb.registry["rules"]:
        rows.append(f"| {rid} | {_cell(kb.entries[rid].get('threshold_basis'))} |")
    return "\n".join(rows)


def cards_table() -> str:
    kb = get_kb()
    rows = ["| Card | Name | Eligibility | Review |", "|---|---|---|---|"]
    for cid, cfg in kb.registry.get("cards", {}).items():
        e = kb.entries.get(cid, {})
        rows.append("| " + " | ".join(_cell(x) for x in (cid, e.get("name"), e.get("warning_eligibility"),
                                                              cfg.get("review_status"))) + " |")
    return "\n".join(rows)


def evidence_summary() -> str:
    kb = get_kb()
    recs = kb.evidence_records
    by_class = Counter((r.get("knowledge_class") or "?").strip()[:1] for r in recs)
    by_elig = Counter(r.get("warning_eligibility") for r in recs)
    lines = [f"Evidence records: **{len(recs)}** (`risk_engine/data/master_evidence.csv`), knowledge base version {kb.version}.", "",
             "| Knowledge class | Records |", "|---|---|"]
    lines += [f"| {k} | {v} |" for k, v in sorted(by_class.items())]
    lines += ["", "| Warning eligibility | Records |", "|---|---|"]
    lines += [f"| {_cell(k)} | {v} |" for k, v in sorted(by_elig.items(), key=lambda x: str(x[0]))]
    lines += ["", f"Relationships that must never be automated: **{len(kb.do_not_automate)}** (`/api/v1/do-not-automate`)."]
    return "\n".join(lines)


def endpoints_table() -> str:
    app = FastAPI()
    app.include_router(router)
    spec = app.openapi()
    rows = ["| Path | Parameters | Summary |", "|---|---|---|"]
    for path, ops in spec["paths"].items():
        op = ops.get("get")
        if not op:
            continue
        params = ", ".join(("**" + p["name"] + "**") if p.get("required") else p["name"] for p in op.get("parameters", []))
        doc = " ".join((op.get("description") or op.get("summary") or "").strip().split("\n\n")[0].split())
        rows.append(f"| `{path}` | {params or '—'} | {_cell(doc)} |")
    hidden = [r.path for r in router.routes if getattr(r, "include_in_schema", True) is False]
    rows += ["", "Aliases and internal routes not in the OpenAPI schema: " + ", ".join(f"`{h}`" for h in hidden) + "."]
    return "\n".join(rows)


SECTIONS = {
    "RISK_RULES.md": {"rules": rules_table, "thresholds": thresholds_table, "cards": cards_table},
    "API.md": {"endpoints": endpoints_table},
    "SAFETY_EVIDENCE.md": {"evidence": evidence_summary},
}


def fill(text: str, name: str, body: str) -> str:
    pat = re.compile(rf"(<!-- BEGIN GENERATED:{name} -->\n)(?:.*?\n)?(<!-- END GENERATED:{name} -->)", re.S)
    if not pat.search(text):
        raise SystemExit(f"marker GENERATED:{name} not found")
    return pat.sub(lambda m: m.group(1) + body + "\n" + m.group(2), text)


def main() -> None:
    for fname, parts in SECTIONS.items():
        p = DOCS / fname
        text = p.read_text(encoding="utf-8")
        for name, fn in parts.items():
            text = fill(text, name, fn())
        p.write_text(text, encoding="utf-8")
        print("updated", p.relative_to(ROOT))
    bundle, ts = export_types.build()
    import json
    (DOCS / "schema").mkdir(exist_ok=True)
    (DOCS / "types").mkdir(exist_ok=True)
    (DOCS / "schema" / "risk_objects.schema.json").write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (DOCS / "types" / "risk.d.ts").write_text(ts, encoding="utf-8")
    print("updated docs/types/risk.d.ts, docs/schema/risk_objects.schema.json")


if __name__ == "__main__":
    main()
