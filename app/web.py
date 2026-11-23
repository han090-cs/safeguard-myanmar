"""Sitemap, robots.txt and static frontend routes."""
from __future__ import annotations

import html as _html
import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, Response

from app import state

router = APIRouter()
ROOT = state.ROOT
PUBLIC_FILES = {"weather.html", "legal.html", "theme_init.js", "error_report.js", "styles.css", "pro.css", "risk_panel.js", "agri.js", "views.js", "views_compare.js", "views_farm.js", "views_more.js", "vchunk-preact.js", "vchunk-slots.js", "vchunk-guides_view.js", "lazy_views.js", "views_lab.js", "leaf.js", "leaf_data.js", "leaf_models.js", "leaf_prep.js", "leaf_engine.js", "feeds.js", "world.js", "history.js", "monthly_compare.js", "compare.js", "help.js", "ux.css", "about.js", "brief.js", "rainlog.js", "sw.js", "sw-version.js", "manifest.json", "notifications.js", "app_boot.js", "weather_script.js", "interaction.js", "core.js", "net.js", "enso_card.js", "emergency_card.js", "nature.js", "mm_calendar.js", "wxicon.js", "swipe_tabs.js", "field_guides.js", "pests.js", "scale_ui.js", "render_cards.js", "health_tips.js", "safety.js", "flood_status.js", "hospitals.js", "i18n.js", "i18n/my.json", "i18n/en.json", "i18n/weather_codes.json", "i18n/scales.json", "i18n/ja.json", "i18n/scales_ja.json", "i18n/weather_codes_ja.json", "i18n/ja_easy.json", "i18n/scales_ja_easy.json", "i18n/weather_codes_ja_easy.json", "icon-192.png", "logo.png", "safeguard.png", "icon-512.png", "apple-touch-icon.png", "og-image.png"}
FONT_FILES = {"noto-myanmar-400.woff2", "noto-myanmar-700.woff2"}

@router.get("/robots.txt", include_in_schema=False)
def robots_txt(request: Request):
    base = state.public_base(request)
    return PlainTextResponse(f"User-agent: *\nAllow: /\nSitemap: {base}/sitemap.xml\n", media_type="text/plain")

@router.get("/sitemap.xml", include_in_schema=False)
def sitemap_xml(request: Request):
    base = state.public_base(request)
    urls = [f"{base}/"]
    body = "".join(f"<url><loc>{u}</loc></url>" for u in urls)
    return Response(f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{body}</urlset>', media_type="application/xml")

@router.get("/", include_in_schema=False)
def frontend_index(request: Request):
    base = state.public_base(request)
    html = (ROOT / "weather.html").read_text(encoding="utf-8").replace("__PUBLIC_BASE_URL__", _html.escape(base, quote=True))
    return HTMLResponse(html)

@router.get("/fonts/{name}", include_in_schema=False)
def frontend_font(name: str):
    if name not in FONT_FILES:
        raise HTTPException(status_code=404)
    return FileResponse(ROOT / "fonts" / name, media_type="font/woff2", headers={"Cache-Control": "public, max-age=31536000, immutable"})

_PEST_FILE = re.compile(r"^[a-z0-9_]+\.(jpg|json)$")

@router.get("/pests/{name}", include_in_schema=False)
def pest_file(name: str):
    """Pest-guide photos (Wikimedia Commons, CC) and their credits; only plain names, nothing else under pests/."""
    path = ROOT / "pests" / name
    if not _PEST_FILE.match(name) or not path.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})

_LEAF_MODEL = re.compile(r"^[a-z0-9_]+\.onnx$")
_ORT_FILE = re.compile(r"^(ort\.wasm\.min\.mjs|ort-wasm-simd-threaded\.mjs|ort-wasm-simd-threaded\.wasm\.[1-9])$")

def _static_blob(folder: str, name: str, ok: re.Pattern, media_type: str):
    """Large read-only files for the on-device leaf check: plain names only, nothing else from the folder."""
    path = ROOT / folder / name
    if not ok.match(name) or not path.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(path, media_type=media_type, headers={"Cache-Control": "public, max-age=604800"})

@router.get("/models/leaf/{name}", include_in_schema=False)
def leaf_model_file(name: str):
    """The two small ONNX models (models/leaf/MODELS.md says where they come from)."""
    return _static_blob("models/leaf", name, _LEAF_MODEL, "application/octet-stream")

@router.get("/vendor/ort/{name}", include_in_schema=False)
def ort_file(name: str):
    """ONNX Runtime Web, served from this site. The 11 MB .wasm is stored as four parts because one response must stay under the host's size limit."""
    return _static_blob("vendor/ort", name, _ORT_FILE, "text/javascript" if name.endswith(".mjs") else "application/octet-stream")

@router.get("/{name:path}", include_in_schema=False)
def frontend_file(name: str, request: Request):
    if name in ("legal", "legal/"):
        name = "legal.html"
    if name not in PUBLIC_FILES:
        raise HTTPException(status_code=404)
    if name == "weather.html":  # installed PWAs / old links still get the placeholders filled in
        return frontend_index(request)
    return FileResponse(ROOT / name, headers={"Cache-Control": "no-cache"})
