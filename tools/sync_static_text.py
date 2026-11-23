"""Make the text written in weather.html equal to the default language (Burmese, i18n/my.json).

The page paints its static HTML first and i18n.js swaps in the translated text a moment later. When the two differ in length the
hero grows or shrinks after the first paint and the whole page jumps (Lighthouse: layout shift). tests/test_static_text.py fails
when they drift apart; run this script to fix it:

    python tools/sync_static_text.py
"""
import json
import re
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATTERN = re.compile(r'(<(\w+)[^>]*?\bdata-i18n="([^"]+)"[^>]*>)([^<]*)(</\2>)')


def main() -> int:
    my = json.loads((ROOT / "i18n" / "my.json").read_text(encoding="utf-8"))
    path = ROOT / "weather.html"
    text = path.read_text(encoding="utf-8")
    changed = []

    def fix(m):
        key, current = m.group(3), m.group(4)
        want = my.get(key)
        if want is None or "\n" in want or current.strip() == want.strip():
            return m.group(0)
        changed.append(key)
        return m.group(1) + escape(want, quote=False) + m.group(5)

    path.write_text(PATTERN.sub(fix, text), encoding="utf-8")
    print(f"updated {len(changed)}: {', '.join(changed) or '-'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
