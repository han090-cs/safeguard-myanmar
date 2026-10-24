#!/usr/bin/env python3
"""Export every Burmese UI string to a CSV so a native speaker can review and correct the wording.

    python tools/export_strings.py            # writes docs/burmese_strings.csv
Send the corrected CSV back (keep the file and line columns) and the strings can be applied in bulk.
"""
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MY = re.compile(r"[\u1000-\u109F]")
FILES = ["weather.html", "weather_script.js", "agri.js", "feeds.js", "risk_panel.js", "notifications.js", "app_boot.js"]


def main() -> int:
    rows, seen = [], set()
    for name in FILES:
        text = (ROOT / name).read_text(encoding="utf-8")
        for lineno, line in enumerate(text.split("\n"), 1):
            for m in re.finditer(r'"([^"\n]*[\u1000-\u109F][^"\n]*)"|`([^`\n]*[\u1000-\u109F][^`\n]*)`|>([^<>\n]*[\u1000-\u109F][^<>\n]*)<', line):
                s = re.sub(r"\s+", " ", next(g for g in m.groups() if g)).strip()
                if len(s) >= 3 and (name, s) not in seen:
                    seen.add((name, s))
                    rows.append((name, lineno, s))
    data = json.loads((ROOT / "data" / "agri.json").read_text(encoding="utf-8"))

    def walk(o, path=""):
        if isinstance(o, dict):
            for k, v in o.items():
                if isinstance(v, str) and MY.search(v) and k != "sources":
                    rows.append(("data/agri.json", 0, f"{path}/{k}: {v}"))
                else:
                    walk(v, f"{path}/{k}")
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, f"{path}[{i}]")
    walk(data)
    out = ROOT / "docs" / "burmese_strings.csv"
    with out.open("w", encoding="utf-8-sig", newline="") as fh:   # utf-8-sig so Excel opens Burmese correctly
        w = csv.writer(fh)
        w.writerow(["file", "line", "current_text", "corrected_text"])
        for name, line, s in rows:
            w.writerow([name, line, s, ""])
    print(f"{len(rows)} strings written to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
