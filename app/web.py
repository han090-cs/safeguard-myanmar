"""Sitemap, robots.txt and static frontend routes."""
from __future__ import annotations

import html as _html

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, Response

from app import state

router = APIRouter()
ROOT = state.ROOT
PUBLIC_FILES = {"weather.html", "theme_init.js", "styles.css", "risk_panel.js", "agri.js", "views.js", "feeds.js", "history.js", "monthly_compare.js", "compare.js", "help.js", "ux.css", "about.js", "brief.js", "rainlog.js", "sw.js", "sw-version.js", "manifest.json", "notifications.js", "app_boot.js", "weather_script.js", "interaction.js", "core.js", "net.js", "enso_card.js", "emergency_card.js", "nature.js", "mm_calendar.js", "field_guides.js", "scale_ui.js", "render_cards.js", "health_tips.js", "safety.js", "flood_status.js", "hospitals.js", "i18n.js", "i18n/my.json", "i18n/en.json", "i18n/weather_codes.json", "i18n/scales.json", "icon-192.png", "logo.png", "safeguard.png", "icon-512.png", "apple-touch-icon.png", "og-image.png"}
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

@router.get("/{name:path}", include_in_schema=False)
def frontend_file(name: str, request: Request):
    if name not in PUBLIC_FILES:
        raise HTTPException(status_code=404)
    if name == "weather.html":  # installed PWAs / old links still get the placeholders filled in
        return frontend_index(request)
    return FileResponse(ROOT / name, headers={"Cache-Control": "no-cache"})
