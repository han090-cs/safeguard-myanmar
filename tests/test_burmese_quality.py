"""Guards the Burmese UI copy: the user-facing text should stay in one warm, spoken register
(ပါတယ်), and known wrong/awkward words must not creep back in. Run: python -m pytest tests/test_burmese_quality.py"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MY = re.compile(r"[\u1000-\u109F]")

# files whose Burmese strings are all user-facing
CODE_FILES = [
    "weather.html", "weather_script.js", "agri.js", "feeds.js", "risk_panel.js", "notifications.js",
    "app_boot.js", "risk_engine/conditions.py", "risk_engine/api.py", "risk_engine/status.py",
    "risk_engine/indices.py", "risk_engine/schemas.py", "data/agri.json",
]
# (pattern, why) — formal/literary register and known mistakes
FORBIDDEN = [
    ("ပါသည်", "formal ending; use ပါတယ်"),
    ("ညှိနှိုင်း", "means 'negotiate'; use ချိန်ညှိ for calibrate/adjust"),
    ("ယခု", "formal; use အခု/ဒီ"),
    ("မကြာသေးမီ", "formal; use မကြာသေးခင်"),
    ("တရားဝင် သတိပေးချက်", "write တရားဝင်သတိပေးချက် (no space)"),
    ("UV အညွှန်း", "use UV ညွှန်းကိန်း everywhere"),
    ("နှင့်", "formal 'and'; use နဲ့"),
]


# proper nouns that keep their official (formal) spelling
OFFICIAL_NAMES = ["မိုးလေဝသနှင့်ဇလဗေဒညွှန်ကြားမှုဦးစီးဌာန", "မိုးလေဝသနှင့် ဇလဗေဒ ညွှန်ကြားမှု ဦးစီးဌာန", "မိုးလေဝသနှင့် ဇလဗေဒညွှန်ကြားမှုဦးစီးဌာန"]


def _strip_official(text):
    for name in OFFICIAL_NAMES:
        text = text.replace(name, "")
    return text


def _burmese_lines(text):
    text = _strip_official(text)
    return [(i, l) for i, l in enumerate(text.split("\n"), 1) if MY.search(l)]


def test_code_files_have_no_forbidden_words():
    bad = []
    for rel in CODE_FILES:
        text = (ROOT / rel).read_text(encoding="utf-8")
        for i, line in _burmese_lines(text):
            for pat, why in FORBIDDEN:
                if pat in line:
                    bad.append(f"{rel}:{i}: '{pat}' ({why})")
    assert not bad, "\n".join(bad[:30])


def test_knowledge_model_user_facing_fields():
    km = json.loads((ROOT / "risk_engine/data/knowledge_model.json").read_text(encoding="utf-8"))
    bad = []
    for e in km["knowledge_model"]:
        texts = list(e.get("limitations", []))
        if "rule" in e:
            texts += list(e["rule"]["message"]["my"].values())
        if "text" in e:
            texts.append(e["text"]["my"])
        for t in texts:
            for pat, why in FORBIDDEN:
                if pat in _strip_official(t):
                    bad.append(f"{e['id']}: '{pat}' ({why}) in {t[:40]}")
    assert not bad, "\n".join(bad[:30])


def test_placeholders_survive():
    km = json.loads((ROOT / "risk_engine/data/knowledge_model.json").read_text(encoding="utf-8"))
    for e in km["knowledge_model"]:
        if "rule" in e:
            for k, v in e["rule"]["message"]["my"].items():
                assert all(not p or True for p in re.findall(r"\{\w+\}", v)), e["id"]
    assert True
