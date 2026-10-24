"""Compatibility entrypoint for local tooling; the FastAPI app serves the dashboard on one origin."""
from main import app

PAGE_FILES = {
    "weather.html", "styles.css", "weather_script.js", "risk_panel.js", "agri.js", "feeds.js",
    "app_boot.js", "notifications.js", "sw.js", "sw-version.js", "i18n.js",
}

__all__ = ["app", "PAGE_FILES"]
