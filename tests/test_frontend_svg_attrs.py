"""Preact writes attribute names exactly as typed. HTML ignores the difference, but SVG is case-sensitive: `textAnchor="end"` is not
`text-anchor="end"`, so the label silently stays left-aligned (this once pushed the last year label out of the chart and clipped it).
Inside the Preact views, SVG attributes must be written in their real, dashed form."""
import re
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "frontend" / "src"
CAMEL = re.compile(
    r"\b(textAnchor|fontSize|fontWeight|fontFamily|strokeWidth|strokeDasharray|strokeDashoffset|strokeLinecap|strokeLinejoin|strokeOpacity|"
    r"strokeMiterlimit|fillOpacity|fillRule|clipRule|stopColor|stopOpacity|dominantBaseline|alignmentBaseline|vectorEffect|shapeRendering)=")


def test_svg_attributes_are_dashed_in_preact_views():
    bad = []
    for f in sorted(SRC.glob("*.jsx")):
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            m = CAMEL.search(line)
            if m:
                bad.append(f"{f.name}:{n} {m.group(1)}")
    assert not bad, "write SVG attributes dashed (text-anchor, stroke-width, ...): " + ", ".join(bad)
