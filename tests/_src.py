"""Which root *.js files are hand-written source. Files built by frontend/ (Preact, via vite) start with the GENERATED banner and are minified, so source-level guards skip them."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BANNER = "/*! GENERATED"


def is_generated(p: Path) -> bool:
    return BANNER in p.read_text(encoding="utf-8")[:600]  # rollup puts the banner after the first import lines


def source_js():
    return [p for p in sorted(ROOT.glob("*.js")) if not is_generated(p)]


def generated_js():
    return [p for p in sorted(ROOT.glob("*.js")) if is_generated(p)]
