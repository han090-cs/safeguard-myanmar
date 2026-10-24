"""Engine configuration. Everything scientific lives in data/*.json; this module only holds runtime settings."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo

DATA_DIR = Path(os.getenv("RISK_ENGINE_DATA_DIR", Path(__file__).parent / "data"))
MYANMAR_TZ = ZoneInfo("Asia/Yangon")
ENGINE_VERSION = "1.0.0"


@dataclass(frozen=True)
class EngineSettings:
    # "development": provisional (not yet reviewed) rules may run and are labelled review_status="provisional".
    # "production": only rules with review_status == "approved" in rule_registry.json run.
    mode: str = field(default_factory=lambda: os.getenv("RISK_ENGINE_MODE", "development"))
    forecast_url: str = os.getenv("OPEN_METEO_FORECAST_URL", "https://api.open-meteo.com/v1/forecast")
    forecast_model: str = os.getenv("WEATHER_MODEL", "ecmwf_ifs")
    air_quality_url: str = os.getenv("OPEN_METEO_AIR_QUALITY_URL", "https://air-quality-api.open-meteo.com/v1/air-quality")
    cache_ttl_seconds: int = int(os.getenv("RISK_ENGINE_CACHE_TTL", "600"))   # 10 min, same as the frontend weather cache
    cache_max_entries: int = int(os.getenv("RISK_ENGINE_CACHE_MAX", "2048"))
    # After the TTL, a cached forecast may still be served for this long while a fresh copy is fetched in the
    # background (stale-while-revalidate). Freshness metadata keeps the original fetch time.
    stale_while_revalidate_seconds: int = int(os.getenv("RISK_ENGINE_SWR", "3600"))
    http_timeout_seconds: float = float(os.getenv("RISK_ENGINE_HTTP_TIMEOUT", "10"))
    http_retries: int = int(os.getenv("RISK_ENGINE_HTTP_RETRIES", "2"))
    past_days: int = 28          # R09 needs a 28-day flood look-back
    forecast_days: int = 7
    default_horizon_days: int = 3
    stale_after_minutes: int = 180   # data older than this lowers confidence one level

    @property
    def require_approved(self) -> bool:
        return self.mode.lower() == "production"


SETTINGS = EngineSettings()
