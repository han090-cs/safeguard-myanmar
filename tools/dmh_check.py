"""Exit 1 when the DMH import in DIR has not read DMH successfully within --max-age-min minutes.

Used by .github/workflows/dmh-import.yml after the snapshot is published, so a run that could not read DMH shows as
failed in the Actions tab (and GitHub e-mails the repository owner) instead of silently publishing an old snapshot.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def check(data_dir: Path, max_age_min: float, now: datetime | None = None) -> tuple[bool, str]:
    now = now or datetime.now(timezone.utc)
    try:
        src = json.loads((data_dir / "official_alerts_state.json").read_text(encoding="utf-8")).get("source", {})
    except (OSError, ValueError):
        return False, "no import state found"
    last = src.get("last_success_at")
    if not last:
        return False, f"DMH was never read successfully (last error: {src.get('last_error') or 'none recorded'})"
    age = now - datetime.fromisoformat(last)
    if age > timedelta(minutes=max_age_min):
        return False, f"last good DMH read was {int(age.total_seconds() // 60)} min ago (last error: {src.get('last_error') or 'none recorded'})"
    note = f"; some pages failed: {src['last_error']}" if src.get("last_error") else ""
    return True, f"DMH read {int(age.total_seconds() // 60)} min ago{note}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("data_dir", type=Path)
    ap.add_argument("--max-age-min", type=float, default=90)
    args = ap.parse_args()
    ok, msg = check(args.data_dir, args.max_age_min)
    print(("OK: " if ok else "FAILED: ") + msg)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
