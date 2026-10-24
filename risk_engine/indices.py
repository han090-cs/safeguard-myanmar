"""Derived indices. Formulas and category boundaries are taken from the cited standards; nothing is tuned here."""
from __future__ import annotations

import math
from typing import Optional

from .schemas import Localized


def c_to_f(c: float) -> float:
    return c * 9.0 / 5.0 + 32.0


def f_to_c(f: float) -> float:
    return (f - 32.0) * 5.0 / 9.0


def heat_index_c(temp_c: Optional[float], rh: Optional[float]) -> Optional[float]:
    """US NWS heat index (Rothfusz regression with NWS adjustments), returned in °C.

    Algorithm as published by the NWS Weather Prediction Center: use the simple Steadman form first; if the
    average of that result and the temperature is >= 80 °F, use the Rothfusz regression and apply the low-RH or
    high-RH adjustment where applicable.
    """
    if temp_c is None or rh is None:
        return None
    t, r = c_to_f(temp_c), max(0.0, min(100.0, rh))
    simple = 0.5 * (t + 61.0 + (t - 68.0) * 1.2 + r * 0.094)
    if (simple + t) / 2.0 < 80.0:
        return f_to_c(simple)
    hi = (-42.379 + 2.04901523 * t + 10.14333127 * r - 0.22475541 * t * r - 0.00683783 * t * t
          - 0.05481717 * r * r + 0.00122874 * t * t * r + 0.00085282 * t * r * r - 0.00000199 * t * t * r * r)
    if r < 13 and 80 <= t <= 112:
        hi -= ((13 - r) / 4.0) * math.sqrt((17 - abs(t - 95.0)) / 17.0)
    elif r > 85 and 80 <= t <= 87:
        hi += ((r - 85) / 10.0) * ((87 - t) / 5.0)
    return f_to_c(hi)


# Knowledge-base R01 tiers (US NWS categories in °C). Display policy (which tier becomes a notice) is in the KB.
def heat_index_tier(hi_c: Optional[float], tiers: list[dict]) -> Optional[dict]:
    if hi_c is None:
        return None
    match = None
    for tier in sorted(tiers, key=lambda x: x["min"]):
        if hi_c >= tier["min"]:
            match = tier
    return match


AQI_CATEGORIES = [  # US EPA AQI index categories (index values, not concentrations)
    (0, "good", "ကောင်း", "Good"),
    (51, "moderate", "အသင့်အတင့်", "Moderate"),
    (101, "unhealthy_sensitive", "ထိခိုက်လွယ်သူတွေအတွက် မကောင်းပါ", "Unhealthy for sensitive groups"),
    (151, "unhealthy", "ကျန်းမာရေးအတွက် မကောင်းပါ", "Unhealthy"),
    (201, "very_unhealthy", "ကျန်းမာရေးအတွက် အလွန်မကောင်းပါ", "Very unhealthy"),
    (301, "hazardous", "အန္တရာယ်ရှိ", "Hazardous"),
]


def aqi_category(aqi: Optional[float]) -> Optional[tuple[str, Localized]]:
    if aqi is None:
        return None
    code, label = None, None
    for lo, c, my, en in AQI_CATEGORIES:
        if aqi >= lo:
            code, label = c, Localized(my=my, en=en)
    return code, label


def to_myanmar_digits(text: str) -> str:
    return text.translate(str.maketrans("0123456789", "၀၁၂၃၄၅၆၇၈၉"))


def fmt_num(value: float, decimals: int = 0) -> str:
    return f"{value:.{decimals}f}"
