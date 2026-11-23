"""The weather page is split into ES modules. Guards the import graph: every import resolves to a real export,
there are no import cycles, and every module is both precached by the service worker and allowed by the server."""
import re
from pathlib import Path
from _src import generated_js, source_js

ROOT = Path(__file__).resolve().parent.parent
IMPORT = re.compile(r'^import\s*\{([^}]*)\}\s*from\s*"\./([\w.-]+\.js)";', re.M)
EXPORT = re.compile(r"^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([\w$]+)", re.M)  # `$` is a valid name
MODULES = [p.name for p in source_js() if not p.name.endswith(".config.js") and re.search(r"^(import|export)\s", p.read_text(encoding="utf-8"), re.M)]
GENERATED = [p.name for p in generated_js()]  # Preact bundles: only their export list is checked


def _imports(name):
    return [(m.group(2), [x.strip().split(" as ")[0] for x in m.group(1).split(",") if x.strip()])
            for m in IMPORT.finditer((ROOT / name).read_text(encoding="utf-8"))]


def test_every_import_resolves_to_an_export():
    exports = {n: set(EXPORT.findall((ROOT / n).read_text(encoding="utf-8"))) for n in MODULES}
    for n in GENERATED:  # `export { x as name }` at the end of a bundle
        exports[n] = {part.split(" as ")[-1].strip() for blk in re.findall(r"export\s*\{([^}]*)\}", (ROOT / n).read_text(encoding="utf-8")) for part in blk.split(",") if part.strip()}
    exports["i18n.js"] |= set(re.findall(r"export \{([^}]*)\}", (ROOT / "i18n.js").read_text(encoding="utf-8"))[0].replace(" ", "").split(","))
    for name in MODULES:
        for target, names in _imports(name):
            assert target in exports, (name, target)
            assert set(names) <= exports[target], (name, target, set(names) - exports[target])


def test_no_import_cycles():
    graph = {n: [t for t, _ in _imports(n)] for n in MODULES}
    state = {}

    def visit(n, path):
        assert state.get(n) != 1, f"import cycle: {' -> '.join(path + [n])}"
        if state.get(n) == 2:
            return
        state[n] = 1
        for t in graph.get(n, []):
            visit(t, path + [n])
        state[n] = 2

    for n in graph:
        visit(n, [])


def test_modules_are_precached_and_served():
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    web = (ROOT / "app" / "web.py").read_text(encoding="utf-8")
    for name in MODULES:
        assert f'"./{name}"' in sw, f"{name} missing from sw.js precache"
        assert f'"{name}"' in web, f"{name} missing from PUBLIC_FILES"


def test_modules_link_in_a_real_es_module_engine():
    import shutil
    import subprocess

    node = shutil.which("node")
    if not node:
        import pytest
        pytest.skip("node not installed")
    r = subprocess.run([node, str(ROOT / "tests" / "module_link_check.mjs")], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr


def test_architecture_page_lists_every_module():
    page = (ROOT / "docs" / "ARCHITECTURE.md").read_text(encoding="utf-8")
    for name in MODULES:
        assert name in page, f"{name} is not described in docs/ARCHITECTURE.md"
