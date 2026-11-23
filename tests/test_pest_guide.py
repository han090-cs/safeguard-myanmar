"""Pest guide data: all five crops covered, bilingual, no pesticide names/doses, photos only through the safe route."""
import re
from pathlib import Path

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

ROOT = Path(__file__).resolve().parents[1]
SRC = (ROOT / "pests.js").read_text(encoding="utf-8")

def test_entries_cover_crops_and_are_bilingual():
    ids = re.findall(r'\bE\("([a-z0-9_]+)","([a-z]+)","(pest|disease)"', SRC)
    assert len(ids) == len({i for i, *_ in ids}) >= 20
    assert {"rice", "sesame", "coffee", "potato", "mustard"} <= {c for _, c, _ in ids}
    declared = set(re.findall(r'\{id:"([a-z]+)", my:', SRC))
    assert {c for _, c, _ in ids} == declared  # every crop with entries has a chip, and the other way round
    assert SRC.count("{my:") >= 3 * len(ids) and SRC.count(",en:") >= 3 * len(ids)

def test_no_pesticide_names_or_doses():
    low = SRC.lower()
    for word in ("mancozeb", "carbendazim", "imidacloprid", "chlorpyrifos", "cypermethrin", "tricyclazole", "metalaxyl", "copper oxychloride", "glyphosate", "ml/", "g/l", "kg/ha"):
        assert word not in low, word
    assert "agriculture office" in low

def test_pest_photo_route_is_locked_down():
    assert client.get("/pests/credits.json").status_code == 200
    assert client.get("/pests/..%2Fmain.py").status_code == 404
    assert client.get("/pests/nothing.jpg").status_code == 404
    assert client.get("/pests.js").status_code == 200

def test_fetch_tool_parses_every_entry():
    import importlib.util
    spec = importlib.util.spec_from_file_location("fci", ROOT / "tools" / "fetch_commons_images.py")
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    assert len(m.entries()) == len(re.findall(r'\bE\("', SRC)) - 0
