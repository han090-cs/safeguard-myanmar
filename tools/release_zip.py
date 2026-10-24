from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
out = ROOT.parent / f"myanmar-weather-v{version}.zip"
exclude = {".git", "__pycache__", ".pytest_cache"}
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for p in ROOT.rglob("*"):
        rel = p.relative_to(ROOT)
        if any(part in exclude for part in rel.parts) or p == out:
            continue
        if p.is_file(): z.write(p, rel.as_posix())
print(out)
