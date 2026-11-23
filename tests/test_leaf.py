"""Leaf check (Lab tab). Server side: the one POST route (optional AI second look) and the static files of the on-device photo check.
The browser side (rules, preprocessing, screens) is covered by tests/leaf_prep.test.mjs, tests/leaf_data.test.mjs and tests/e2e/ux.spec.js."""
import base64
import hashlib
import json
import logging
import re
import subprocess
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import leaf, state
from app.app import app

ROOT = Path(__file__).resolve().parent.parent
client = TestClient(app)
# smallest believable JPEG-looking payload: magic bytes + padding (the route checks magic and size, the model call is replaced)
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 4000
B64 = base64.b64encode(JPEG).decode()


OWNER = "sk-ant-api03-" + "O" * 40           # the owner's key (server environment)
VISITOR = "sk-ant-api03-" + "V" * 40         # a visitor's own key (sent by their browser)


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    leaf.reset_budgets()
    for k in ("ANTHROPIC_API_KEY", "SG_LEAF_AI", "SG_LEAF_MODEL", "SG_LEAF_PER_IP_HOUR", "SG_LEAF_DAILY_MAX", "SG_LEAF_SHARE_SERVER_KEY", "SG_LEAF_BYOK_PER_HOUR"):
        monkeypatch.delenv(k, raising=False)
    yield
    leaf.reset_budgets()


@pytest.fixture
def on(monkeypatch):
    """The owner has a key AND chose to share it with every visitor (SG_LEAF_SHARE_SERVER_KEY=1)."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", OWNER)
    monkeypatch.setenv("SG_LEAF_SHARE_SERVER_KEY", "1")
    return monkeypatch


@pytest.fixture
def mine(monkeypatch):
    """Default deployment: the owner may or may not have a key set, visitors bring their own."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", OWNER)
    return monkeypatch


def post(body=None, key=None, **kw):
    body = {"image": B64, "crop": "rice", "lang": "en"} if body is None else body
    if key is not None:
        kw["headers"] = {**kw.get("headers", {}), "X-User-Api-Key": key}
    return client.post("/api/v1/leaf", json=body, **kw)


# ---------------------------------------------------------------- catalog and status

def test_catalog_matches_the_pest_guide():
    cat = leaf.catalog()
    src = (ROOT / "pests.js").read_text(encoding="utf-8")
    assert len(cat["problems"]) == len(re.findall(r'\bE\("', src)) == 61
    assert len(cat["crops"]) == 18
    assert {p["crop"] for p in cat["problems"].values()} <= set(cat["crops"])
    assert {c["id"] for c in leaf.candidates("rice")} >= {"rice_blast", "bacterial_blight", "tungro"}


def test_status_follows_sharing_and_switch(monkeypatch):
    # nothing set: visitors can still bring their own key, but nobody's key is shared
    assert client.get("/api/v1/leaf/status").json() == {"enabled": False, "byok": True, "per_hour": 0, "byok_per_hour": 30}
    # the owner has a key but did not share it: still not shared
    monkeypatch.setenv("ANTHROPIC_API_KEY", OWNER)
    assert client.get("/api/v1/leaf/status").json()["enabled"] is False
    monkeypatch.setenv("SG_LEAF_SHARE_SERVER_KEY", "1")
    assert client.get("/api/v1/leaf/status").json() == {"enabled": True, "byok": True, "per_hour": 10, "byok_per_hour": 30}
    monkeypatch.setenv("SG_LEAF_AI", "0")
    assert client.get("/api/v1/leaf/status").json() == {"enabled": False, "byok": False, "per_hour": 0, "byok_per_hour": 0}
    assert "sk-ant" not in client.get("/api/v1/leaf/status").text


def test_no_key_at_all_asks_for_one():
    r = post()
    assert r.status_code == 401 and r.json()["detail"] == "need_key"


def test_the_owners_key_is_not_used_for_visitors_unless_shared(mine):
    async def boom(*a, **k):
        raise AssertionError("no model call without a key the owner agreed to share")
    mine.setattr(leaf, "call_model", boom)
    r = post()
    assert r.status_code == 401 and r.json()["detail"] == "need_key"
    mine.setenv("SG_LEAF_SHARE_SERVER_KEY", "0")
    assert post().status_code == 401


def test_everything_is_off_with_the_switch(monkeypatch):
    monkeypatch.setenv("SG_LEAF_AI", "0")
    monkeypatch.setenv("ANTHROPIC_API_KEY", OWNER)
    monkeypatch.setenv("SG_LEAF_SHARE_SERVER_KEY", "1")
    for k in (None, VISITOR):
        r = post(key=k)
        assert r.status_code == 503 and r.json()["detail"] == "off"


# ---------------------------------------------------------------- answer handling

def test_answer_is_filtered_to_the_crops_own_problems(on):
    async def fake(*a):
        return '```json\n' + json.dumps({"photo_ok": True, "issue": "none", "healthy": False, "other": "x" * 400, "matches": [
            {"id": "rice_blast", "confidence": "HIGH", "why": "w" * 500},
            {"id": "potato_late_blight", "confidence": "high", "why": "wrong crop"},
            {"id": "rice_blast", "confidence": "low", "why": "duplicate"},
            {"id": "tungro", "confidence": "medium", "why": "ok\x00\x07 text"},
            {"id": "__proto__", "confidence": "high"}, "junk", {"id": "stem_borer"}, {"id": "bacterial_blight"}]}) + '\n```'
    on.setattr(leaf, "call_model", fake)
    r = post()
    assert r.status_code == 200
    j = r.json()
    assert [m["id"] for m in j["matches"]] == ["rice_blast", "tungro", "stem_borer"]
    assert j["matches"][0]["confidence"] == "low"          # "HIGH" is not one of low/medium/high, so it is not trusted
    assert len(j["matches"][0]["why"]) == 240 and len(j["other"]) == 160
    assert "\x00" not in j["matches"][1]["why"] and j["matches"][1]["why"].startswith("ok")
    assert j["ok"] is True and j["model"] == "claude-sonnet-5-5" and j["generated"].endswith("Z")
    assert r.headers["cache-control"] == "no-store"


def test_garbage_reply_gives_an_empty_valid_answer(on):
    async def fake(*a):
        return "I cannot help with that"
    on.setattr(leaf, "call_model", fake)
    j = post().json()
    assert j["matches"] == [] and j["healthy"] is False and j["issue"] == "" and j["other"] == ""


def test_healthy_and_photo_issue_pass_through(on):
    async def fake(*a):
        return json.dumps({"photo_ok": False, "healthy": True, "matches": []})
    on.setattr(leaf, "call_model", fake)
    j = post().json()
    assert j["healthy"] is True and j["issue"] == "not_plant"


def test_prompt_is_built_only_from_the_servers_own_list():
    system, user = leaf.build_prompt("rice", "my")
    assert "rice_blast" in user and "Burmese" in user and "potato_late_blight" not in user
    assert "pesticide" in system.lower()          # the instruction not to recommend any
    assert leaf.model_name() == "claude-sonnet-5-5"


@pytest.mark.parametrize("body", [
    {"image": "short", "crop": "rice"},
    {"image": B64, "crop": "Rice"},
    {"image": B64, "crop": "r"},
    {"image": B64, "crop": "rice", "lang": "fr"},
    {"image": B64},
    {"crop": "rice"},
    {"image": B64, "crop": "unicorn"},
    {"image": "!" * 500, "crop": "rice"},
    {"image": base64.b64encode(b"\x00" * 3000).decode(), "crop": "rice"},       # not an image
    {"image": base64.b64encode(b"\xff\xd8\xff" + b"\x00" * 200).decode(), "crop": "rice"},   # too small
])
def test_bad_input_is_refused_before_any_model_call(on, body):
    async def boom(*a):
        raise AssertionError("model must not be called")
    on.setattr(leaf, "call_model", boom)
    assert post(body).status_code == 422


def test_png_and_webp_are_accepted_by_magic_bytes(on):
    async def fake(*a):
        return "{}"
    on.setattr(leaf, "call_model", fake)
    png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 3000).decode()
    webp = base64.b64encode(b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 3000).decode()
    assert post({"image": png, "crop": "rice"}).status_code == 200
    assert post({"image": "data:image/webp;base64," + webp, "crop": "rice"}).status_code == 200


# ---------------------------------------------------------------- the one POST route stays narrow

def test_body_guards(on):
    assert client.post("/api/v1/leaf", content=b"x=1", headers={"content-type": "text/plain"}).status_code == 415
    assert client.post("/api/v1/leaf", content=b"x" * 3_300_000, headers={"content-type": "application/json"}).status_code == 413
    assert client.post("/api/v1/leaf", content=b"{}", headers={"content-type": "application/json; charset=utf-8"}).status_code == 422


def test_every_other_write_is_still_refused(on):
    for path in ("/api/weather?lat=1&lon=1", "/api/v1/leaf/status", "/api/client-error", "/api/v1/risk"):
        assert client.post(path, json={}).status_code == 405, path
    for m in ("put", "delete", "patch"):
        assert client.request(m.upper(), "/api/v1/leaf", json={}).status_code == 405


def test_cors_preflight_does_not_open_the_post_route():
    r = client.options("/api/v1/leaf", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}
    r = post(headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}


# ---------------------------------------------------------------- budgets

def test_visitor_budget_then_day_budget(on):
    async def fake(*a):
        return "{}"
    on.setattr(leaf, "call_model", fake)
    on.setenv("SG_LEAF_PER_IP_HOUR", "2")
    assert post().status_code == 200 and post().status_code == 200
    r = post()
    assert r.status_code == 429 and r.json() == {"detail": "limit", "scope": "visitor"}
    leaf.reset_budgets()
    on.setenv("SG_LEAF_PER_IP_HOUR", "0")
    on.setenv("SG_LEAF_DAILY_MAX", "1")
    assert post().status_code == 200
    assert post().json() == {"detail": "limit", "scope": "day"}


def test_budget_window_slides_and_invalid_input_costs_nothing(on):
    on.setenv("SG_LEAF_PER_IP_HOUR", "1")
    assert leaf.take_budget("1.1.1.1", 1000.0) is None
    assert leaf.take_budget("1.1.1.1", 1500.0) == "visitor"
    assert leaf.take_budget("2.2.2.2", 1500.0) is None
    assert leaf.take_budget("1.1.1.1", 1000.0 + 3601) is None
    leaf.reset_budgets()
    assert post({"image": B64, "crop": "unicorn"}).status_code == 422
    assert post({"image": "!" * 500, "crop": "rice"}).status_code == 422
    assert leaf._day["n"] == 0


# ---------------------------------------------------------------- the upstream call

class FakeResp:
    def __init__(self, status=200, data=None):
        self.status_code, self._d = status, data if data is not None else {}

    def json(self):
        return self._d


class FakeClient:
    def __init__(self, resp=None, exc=None):
        self.resp, self.exc, self.calls = resp, exc, []

    async def post(self, url, **kw):
        self.calls.append((url, kw))
        if self.exc:
            raise self.exc
        return self.resp


def test_upstream_request_shape(on):
    fc = FakeClient(FakeResp(200, {"content": [{"type": "text", "text": '{"matches":[{"id":"tungro","confidence":"high","why":"yellow-orange"}]}'}]}))
    on.setattr(state, "client", fc)
    on.setenv("SG_LEAF_MODEL", "claude-test-model")
    j = post().json()
    assert j["matches"][0]["id"] == "tungro" and j["model"] == "claude-test-model"
    url, kw = fc.calls[0]
    assert url == "https://api.anthropic.com/v1/messages"
    assert kw["headers"]["x-api-key"] == OWNER and kw["headers"]["anthropic-version"]
    body = kw["json"]
    assert body["model"] == "claude-test-model" and body["max_tokens"] <= 1000
    img = body["messages"][0]["content"][0]
    assert img["type"] == "image" and img["source"]["media_type"] == "image/jpeg" and img["source"]["data"] == B64
    assert "tungro" in body["messages"][0]["content"][1]["text"]


@pytest.mark.parametrize("resp,exc,status,detail", [
    (FakeResp(401, {"error": {"message": "invalid x-api-key " + OWNER}}), None, 502, "unavailable"),       # the owner's key problem is not the visitor's to see
    (FakeResp(403, {"error": {"message": "forbidden " + OWNER}}), None, 502, "unavailable"),
    (FakeResp(500), None, 502, "unavailable"),
    (None, RuntimeError("boom " + OWNER), 502, "unavailable"),
    (FakeResp(429), None, 503, "busy"),
    (FakeResp(529), None, 503, "busy"),
])
def test_upstream_failures_are_generic_and_never_leak(on, caplog, resp, exc, status, detail):
    on.setattr(state, "client", FakeClient(resp, exc))
    with caplog.at_level(logging.DEBUG):
        r = post()
    assert r.status_code == status and r.json()["detail"] == detail
    assert "sk-ant" not in r.text and "sk-ant" not in caplog.text and B64[:40] not in caplog.text


# ---------------------------------------------------------------- the visitor's own key (bring your own key)

GOOD = FakeResp(200, {"content": [{"type": "text", "text": '{"matches":[{"id":"tungro","confidence":"high","why":"yellow-orange"}]}'}]})


def test_a_visitors_own_key_pays_and_wins_over_the_owners(mine):
    fc = FakeClient(GOOD)
    mine.setattr(state, "client", fc)
    r = post(key=VISITOR)
    assert r.status_code == 200 and r.json()["matches"][0]["id"] == "tungro"
    assert fc.calls[0][1]["headers"]["x-api-key"] == VISITOR            # theirs, never the owner's
    assert OWNER not in repr(fc.calls)
    mine.setenv("SG_LEAF_SHARE_SERVER_KEY", "1")                         # even when the owner shares, a visitor's own key is the one used
    fc.calls.clear()
    assert post(key=VISITOR).status_code == 200 and fc.calls[0][1]["headers"]["x-api-key"] == VISITOR


def test_works_when_the_owner_has_no_key_at_all(monkeypatch):
    fc = FakeClient(GOOD)
    monkeypatch.setattr(state, "client", fc)
    assert post(key=VISITOR).status_code == 200
    assert fc.calls[0][1]["headers"]["x-api-key"] == VISITOR


@pytest.mark.parametrize("bad", ["abc", "sk-test-0000", "sk-ant-short", "sk-ant-" + "a" * 300, "sk-ant-api03-" + "a" * 20 + " x", "Bearer " + VISITOR, "sk-ant-api03-" + "é" * 20])
def test_a_key_that_is_not_shaped_like_a_key_is_refused_without_any_call(mine, bad):
    async def boom(*a, **k):
        raise AssertionError("model must not be called")
    mine.setattr(leaf, "call_model", boom)
    try:
        r = post(key=bad)
    except UnicodeEncodeError:                                          # the HTTP client itself will not send non-latin-1 header text
        return
    assert r.status_code == 401 and r.json() == {"detail": "bad_key"}
    assert leaf._day["n"] == 0 and not leaf._own_hits


@pytest.mark.parametrize("code", [401, 403])
def test_a_rejected_own_key_is_reported_as_bad_key_and_not_echoed(mine, caplog, code):
    mine.setattr(state, "client", FakeClient(FakeResp(code, {"error": {"message": "invalid x-api-key " + VISITOR}})))
    with caplog.at_level(logging.DEBUG):
        r = post(key=VISITOR)
    assert r.status_code == 401 and r.json() == {"detail": "bad_key"}
    assert VISITOR not in r.text and VISITOR not in caplog.text and "sk-ant" not in caplog.text


@pytest.mark.parametrize("resp,exc,status,detail", [
    (FakeResp(500), None, 502, "unavailable"),
    (None, RuntimeError("boom " + VISITOR), 502, "unavailable"),
    (FakeResp(429), None, 503, "busy"),
    (FakeResp(529), None, 503, "busy"),
])
def test_other_failures_with_an_own_key_stay_generic_and_never_leak_it(mine, caplog, resp, exc, status, detail):
    mine.setattr(state, "client", FakeClient(resp, exc))
    with caplog.at_level(logging.DEBUG):
        r = post(key=VISITOR)
    assert r.status_code == status and r.json()["detail"] == detail
    assert VISITOR not in r.text and "sk-ant" not in caplog.text and B64[:40] not in caplog.text


def test_the_key_never_comes_back_in_any_response(mine):
    mine.setattr(state, "client", FakeClient(GOOD))
    ok = post(key=VISITOR)
    assert VISITOR not in ok.text and VISITOR not in json.dumps(dict(ok.headers))
    assert ok.headers["cache-control"] == "no-store"
    for body in ({"image": "short", "crop": "rice"}, {"image": B64, "crop": "unicorn"}, {"image": "!" * 500, "crop": "rice"}):
        r = post(body, key=VISITOR)
        assert r.status_code == 422 and VISITOR not in r.text


def test_a_key_in_the_url_or_body_is_ignored(mine):
    async def boom(*a, **k):
        raise AssertionError("only the header counts")
    mine.setattr(leaf, "call_model", boom)
    assert client.post("/api/v1/leaf?key=" + VISITOR, json={"image": B64, "crop": "rice"}).status_code == 401
    assert client.post("/api/v1/leaf", json={"image": B64, "crop": "rice", "key": VISITOR, "api_key": VISITOR}).status_code == 401


def test_own_key_budget_is_separate_and_has_no_day_limit(mine):
    mine.setattr(state, "client", FakeClient(GOOD))
    mine.setenv("SG_LEAF_SHARE_SERVER_KEY", "1")
    mine.setenv("SG_LEAF_PER_IP_HOUR", "1")          # the owner's shared budget is tiny (1 per visitor, 1 per day) ...
    mine.setenv("SG_LEAF_DAILY_MAX", "1")
    mine.setenv("SG_LEAF_BYOK_PER_HOUR", "3")
    assert post().status_code == 200
    assert post().json() == {"detail": "limit", "scope": "day"}          # ... and used up
    for _ in range(3):                                                    # ... yet a visitor with their own key is not held back by it
        assert post(key=VISITOR).status_code == 200
    assert post(key=VISITOR).json() == {"detail": "limit", "scope": "visitor"}
    assert leaf._day["n"] == 1                                             # own-key calls never count against the owner's day budget


def test_own_key_budget_window_and_switch():
    leaf.reset_budgets()
    assert leaf.take_budget("1.1.1.1", 1000.0, own_key=True) is None
    os_env = __import__("os").environ
    os_env["SG_LEAF_BYOK_PER_HOUR"] = "1"
    try:
        assert leaf.take_budget("1.1.1.1", 1500.0, own_key=True) == "visitor"
        assert leaf.take_budget("2.2.2.2", 1500.0, own_key=True) is None
        assert leaf.take_budget("1.1.1.1", 1000.0 + 3601, own_key=True) is None
        os_env["SG_LEAF_BYOK_PER_HOUR"] = "0"                               # 0 = no limit
        assert all(leaf.take_budget("3.3.3.3", 2000.0 + i, own_key=True) is None for i in range(50))
    finally:
        os_env.pop("SG_LEAF_BYOK_PER_HOUR", None)
        leaf.reset_budgets()


def test_cross_site_pages_cannot_use_the_key_header():
    r = client.options("/api/v1/leaf", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-user-api-key,content-type"})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}
    r = post(key=VISITOR, headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}


# ---------------------------------------------------------------- static files of the on-device photo check

def test_models_and_engine_files_are_served_exactly_and_nothing_else():
    for name, sha, size in [("rice_student_mbv3s.onnx", "0af21e86c46537ed85eb053664556051449447a2147cb5d2f72364164acb8f7a", 3103989),
                            ("pv_int8.onnx", "0db0651a4df688d752dd70366ea7ddaef8e75a4a5b19609b8eb3e1169e4fe765", 2653866)]:
        r = client.get(f"/models/leaf/{name}")
        assert r.status_code == 200 and len(r.content) == size and hashlib.sha256(r.content).hexdigest() == sha
        assert "max-age" in r.headers["cache-control"]
    parts = b"".join(client.get(f"/vendor/ort/ort-wasm-simd-threaded.wasm.{i}").content for i in range(1, 5))
    assert len(parts) == 11246032 and hashlib.sha256(parts).hexdigest() == "207d02be4591c156b0a98f024f3d58005b5b04c92274d759fb390338c63559ea"
    assert max(len(client.get(f"/vendor/ort/ort-wasm-simd-threaded.wasm.{i}").content) for i in range(1, 5)) < 4_000_000      # one response stays far below a serverless limit
    for glue in ("ort.wasm.min.mjs", "ort-wasm-simd-threaded.mjs"):
        r = client.get(f"/vendor/ort/{glue}")
        assert r.status_code == 200 and "javascript" in r.headers["content-type"]
    for bad in ("/models/leaf/x.txt", "/models/leaf/..%2fmain.py", "/models/leaf/MODELS.md", "/vendor/ort/ort-wasm-simd-threaded.wasm.5", "/vendor/ort/ort-wasm-simd-threaded.wasm",
                "/vendor/ort/ort.wasm.min.mjs.map", "/vendor/ort/../../main.py", "/models/main.py"):
        assert client.get(bad).status_code == 404, bad


def test_page_policy_allows_webassembly_but_still_no_inline_script():
    csp = client.get("/").headers["content-security-policy"]
    assert "script-src 'self' 'wasm-unsafe-eval'" in csp and "unsafe-inline" not in csp and "unsafe-eval'" not in csp.replace("'wasm-unsafe-eval'", "")
    assert "img-src 'self' data:" in csp
    assert client.get("/api/v1/leaf/status").headers["content-security-policy"].startswith("default-src 'none'")


def test_new_modules_are_served_precached_and_documented():
    web = (ROOT / "app" / "web.py").read_text(encoding="utf-8")
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    arch = (ROOT / "docs" / "ARCHITECTURE.md").read_text(encoding="utf-8")
    for f in ("leaf.js", "leaf_data.js", "leaf_models.js", "leaf_prep.js", "leaf_engine.js", "views_lab.js"):
        assert f'"{f}"' in web and f'"./{f}"' in sw and f"`{f}`" in arch, f
        assert client.get(f"/{f}").status_code == 200, f
    assert '"sg-leaf-v1"' in sw and "/vendor/ort/" in sw and "/models/leaf/" in sw
    assert "ANTHROPIC_API_KEY" in (ROOT / "DEPLOY_FREE.md").read_text(encoding="utf-8")
    assert "/api/v1/leaf" in (ROOT / "SECURITY.md").read_text(encoding="utf-8")
    assert (ROOT / "models" / "leaf" / "MODELS.md").is_file()


def test_prep_matches_pillow_on_fixtures():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    r = subprocess.run([node, str(ROOT / "tests" / "leaf_prep.test.mjs")], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr


def test_leaf_rules_pass_their_node_tests():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    r = subprocess.run([node, str(ROOT / "tests" / "leaf_data.test.mjs")], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
