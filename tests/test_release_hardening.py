from pathlib import Path
from _src import source_js

ROOT = Path(__file__).resolve().parents[1]

def test_bootstrap_is_external_and_allowlisted():
    html = (ROOT / "weather.html").read_text()
    assert 'src="app_boot.js" type="module"' in html
    assert html.count('src="app_boot.js"') == 1
    assert "<script>" not in html
    page = (ROOT / "dev_server.py").read_text()
    assert '"app_boot.js"' in page

def test_csp_has_no_inline_script_or_style_exceptions():
    main = (ROOT / "main.py").read_text()
    assert "script-src 'self'; style-src 'self';" in main
    assert "unsafe-inline" not in main

def test_gitignore_covers_generated_python_cache():
    gi = (ROOT / ".gitignore").read_text()
    assert "__pycache__/" in gi
    assert "*.py[cod]" in gi


def test_i18n_files_have_identical_keys():
    import json
    my = json.loads((ROOT / "i18n/my.json").read_text(encoding="utf-8"))
    en = json.loads((ROOT / "i18n/en.json").read_text(encoding="utf-8"))
    assert set(my) == set(en)


def test_version_is_the_cache_source_of_truth():
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    state = (ROOT / "app/state.py").read_text(encoding="utf-8")
    sw_version = (ROOT / "sw-version.js").read_text(encoding="utf-8")
    assert 'CACHE_VERSION = "weather-v" + APP_VERSION' in state
    assert f'weather-v{version}' in sw_version


def test_no_legacy_data_language_attributes_or_nasa_power():
    source_roots = [ROOT / "app", ROOT / "risk_engine", ROOT / "tools"]
    source_files = [ROOT / "weather.html", *source_js(), *ROOT.glob("*.py")]
    for root in source_roots:
        source_files.extend(p for p in root.rglob("*") if p.is_file() and p.suffix in {".py", ".js", ".html", ".json"})
    for path in source_files:
        text = path.read_text(encoding="utf-8")
        assert "data-en=" not in text and "data-my=" not in text, path
        assert "power.larc.nasa.gov" not in text.lower(), path


def test_every_script_with_import_or_export_is_loaded_as_module():
    """A classic <script> that contains `import`/`export` throws 'Cannot use import statement outside a module'."""
    import re
    html = (ROOT / "weather.html").read_text(encoding="utf-8")
    for m in re.finditer(r"<script\b([^>]*)>", html):
        attrs = m.group(1)
        src = re.search(r'src="([^"]+)"', attrs)
        if not src or not src.group(1).endswith(".js"):
            continue
        code = (ROOT / src.group(1)).read_text(encoding="utf-8")
        has_esm = re.search(r"^\s*(import\s.+from\s|import\s*[\"']|export\s)", code, re.M) is not None
        if has_esm:
            assert 'type="module"' in attrs, f"{src.group(1)} uses ES module syntax but is not loaded as type=module"
