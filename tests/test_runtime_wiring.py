"""Wiring that ESLint's no-undef found missing at runtime: strength() in the risk panel and the shared isSlowNet."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_risk_panel_defines_strength_and_translates_every_evidence_level():
    js = (ROOT / "risk_panel.js").read_text(encoding="utf-8")
    assert re.search(r"function strength\(v, lang\)", js)  # the "why this alert" panel calls it
    pairs = json.loads((ROOT / "i18n" / "my.json").read_text(encoding="utf-8"))["risk_strength_my"]
    kb = " ".join(p.read_text(encoding="utf-8") for p in (ROOT / "risk_engine").rglob("*.json"))
    levels = set(re.findall(r'"evidence_level":\s*"([^"]+)"', kb))
    assert levels
    for lv in levels:
        out = lv
        for a, b in pairs:
            out = out.replace(a, b)
        assert not re.search(r"[A-Za-z]{3,}", out), (lv, out)  # no English left in the Burmese text


def test_is_slow_net_is_shared_with_feeds():
    assert "window.isSlowNet=isSlowNet" in (ROOT / "net.js").read_text(encoding="utf-8")
    feeds = (ROOT / "feeds.js").read_text(encoding="utf-8")
    assert 'typeof window.isSlowNet==="function"' in feeds and feeds.count("slowNet()") >= 2
