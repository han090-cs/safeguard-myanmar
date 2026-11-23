"""The text written in weather.html must equal the default language (Burmese), or the page jumps when i18n.js swaps the real text in."""
import json
import re
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATTERN = re.compile(r'<(\w+)[^>]*?\bdata-i18n="([^"]+)"[^>]*>([^<]*)</\1>')


def test_static_html_text_equals_default_language():
    my = json.loads((ROOT / "i18n" / "my.json").read_text(encoding="utf-8"))
    html = (ROOT / "weather.html").read_text(encoding="utf-8")
    drift = [k for _tag, k, inner in PATTERN.findall(html) if k in my and unescape(inner).strip() != my[k].strip()]
    assert not drift, f"weather.html text differs from i18n/my.json for {drift}: run  python tools/sync_static_text.py"
