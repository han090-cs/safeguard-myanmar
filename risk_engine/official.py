"""Official warnings store. Only records in data/official_alerts.json are ever returned as official warnings,
and model signals can never set official_warning=True (enforced by the schema)."""
from __future__ import annotations

import json
import logging
import math
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from .config import DATA_DIR
from .schemas import Localized, OfficialWarning

log = logging.getLogger("risk_engine.official")
NATIONAL = "Myanmar"      # an alert whose regions include this applies to every location in Myanmar
# River flood warnings concern the townships around the named gauging stations, not whole states (Sagaing Region is
# ~94,000 km²). They are shown within this distance of a station: a display setting (about a township's extent),
# not a hydrological threshold.
FLOOD_RADIUS_KM = float(os.getenv("DMH_FLOOD_RADIUS_KM", "40"))


def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


class OfficialAlertStore:
    def __init__(self, path: Path = DATA_DIR / "official_alerts.json"):
        self.path = Path(path)

    def all(self) -> list[OfficialWarning]:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8")).get("alerts", [])
        except (OSError, ValueError):
            log.exception("official alerts file unreadable: %s", self.path)
            return []
        out = []
        for a in raw:
            try:
                out.append(OfficialWarning(
                    alert_id=a["id"], issuer=a["issuer"], type=a["type"], regions=a.get("regions", []),
                    valid_from=datetime.fromisoformat(a["valid_from"]), valid_to=datetime.fromisoformat(a["valid_to"]),
                    url=a.get("url"), links=Localized(**a["links"]) if a.get("links") else None,
                    title=Localized(**a["title"]), source=a.get("source"), stations=a.get("stations"),
                    points=[tuple(p) for p in a["points"]] if a.get("points") else None,
                    summary=Localized(**a["summary"]) if a.get("summary") else None,
                    retrieved_at=datetime.fromisoformat(a["retrieved_at"]) if a.get("retrieved_at") else None))
            except (KeyError, TypeError, ValueError):
                log.exception("skipping malformed official alert %r", a.get("id"))
        return out

    def for_region(self, region: Optional[str], at: datetime, lookback_days: int = 0,
                   point: Optional[tuple[float, float]] = None,
                   radius_km: float = FLOOD_RADIUS_KM) -> list[OfficialWarning]:
        """Alerts that apply here: whole-country alerts; alerts with station points within radius_km of `point`;
        otherwise alerts for this state/region. Without a point, station alerts fall back to their regions."""
        start = at - timedelta(days=lookback_days)

        def applies(a: OfficialWarning) -> bool:
            if NATIONAL in a.regions:
                return True
            if a.points and point is not None:
                return any(_km(point, p) <= radius_km for p in a.points)
            return region is not None and region in a.regions

        return [a for a in self.all() if applies(a) and a.valid_to >= start and a.valid_from <= at]
