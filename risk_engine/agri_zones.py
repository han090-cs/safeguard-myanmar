"""Myanmar agricultural zone resolver.

The app deliberately separates administrative boundaries from agricultural zones.
A state/region is not always one farming zone, so this module returns a primary
zone plus an uncertainty note instead of pretending the whole region is uniform.
The broad four-zone layer follows Myanmar agro-climatic/agro-ecological references;
location-level assignment uses the app's local admin-1 boundary data.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any

from .geo import region_at, region_names

ZONE_LABELS = {
    "delta": {"my": "မြစ်ဝကျွန်းပေါ်ဒေသ", "en": "Delta", "short_my": "မြစ်ဝကျွန်းပေါ်", "short_en": "Delta"},
    "dry": {"my": "အလယ်ပိုင်း မိုးနည်းဒေသ", "en": "Central Dry Zone", "short_my": "မိုးနည်းဒေသ", "short_en": "Dry Zone"},
    "hills": {"my": "တောင်ပေါ်/တောင်တန်းဒေသ", "en": "Hilly and Mountainous", "short_my": "တောင်ပေါ်ဒေသ", "short_en": "Hills"},
    "coastal": {"my": "ကမ်းရိုးတန်းဒေသ", "en": "Coastal", "short_my": "ကမ်းရိုးတန်း", "short_en": "Coastal"},
}

# Strong, broad assignments. These are intentionally not presented as exact
# township boundaries. Mixed states/regions are handled below.
REGION_PRIMARY = {
    "Ayeyarwady": "delta", "Yangon": "delta",
    "Sagaing": "dry", "Magway": "dry", "Mandalay": "dry", "Naypyitaw": "dry",
    "Kachin": "hills", "Chin": "hills", "Shan": "hills", "Kayah": "hills",
    "Tanintharyi": "coastal", "Mon": "coastal", "Rakhine": "coastal", "Kayin": "coastal",
}

MIXED = {
    "Bago": {"zones": ["delta", "hills"], "note_my": "ပဲခူးတိုင်းက မြစ်ဝကျွန်းပေါ်ဘက်၊ အလယ်ပိုင်းပြင်နဲ့ တောင်ခြေဘက်တွေ ကွာတာကြောင့် တစ်ဇုန်တည်းလို့ မသတ်မှတ်ထားပါဘူး။", "note_en": "Bago spans lowland/riverine and upland areas, so it is not treated as one uniform zone."},
    "Kayin": {"zones": ["coastal", "hills"], "note_my": "ကရင်ပြည်နယ်မှာ မြေနိမ့်ပိုင်းနဲ့ တောင်တန်းပိုင်း နှစ်မျိုးလုံးရှိလို့ နေရာအလိုက် ကွာနိုင်ပါတယ်။", "note_en": "Kayin contains both lowland and mountainous areas; the local site can differ."},
    "Rakhine": {"zones": ["coastal", "hills"], "note_my": "ရခိုင်ပြည်နယ်မှာ ကမ်းရိုးတန်းနဲ့ တောင်တန်းပိုင်း နှစ်မျိုးလုံးရှိပါတယ်။", "note_en": "Rakhine includes both coastal plains and hilly areas."},
    "Kachin": {"zones": ["hills", "dry"], "note_my": "ကချင်ပြည်နယ်မှာ တောင်တန်းနဲ့ မြစ်ဝှမ်းပြင်ဒေသတွေ ကွာနိုင်ပါတယ်။", "note_en": "Kachin contains mountainous and lower river-valley areas."},
}

# A few stable location cues for mixed regions. These are a safety/usability layer,
# not a substitute for an official township-level AEZ boundary dataset.
@lru_cache(maxsize=4096)
def resolve(lat: float, lon: float, admin1: str | None = None) -> dict[str, Any]:
    region = region_at(lat, lon) or admin1
    if not region:
        return {"zone": None, "zones": [], "confidence": "low", "reason": "no_admin_boundary"}

    region = str(region)
    if region == "Bago":
        # Lower Bago is predominantly delta/riverine; upper/eastern uplands trend hilly.
        if lat < 17.9:
            zones, primary, confidence = ["delta"], "delta", "medium"
            reason = "Bago lower/riverine latitude band"
        elif lat >= 19.0:
            zones, primary, confidence = ["hills"], "hills", "medium"
            reason = "Bago upper/upland latitude band"
        else:
            zones, primary, confidence = ["delta", "hills"], "delta", "low"
            reason = "Bago transition area"
        return _result(region, primary, zones, confidence, reason, MIXED["Bago"])

    if region == "Naypyitaw":
        return _result(region, "dry", ["dry", "hills"], "medium", "Naypyitaw transition between central plains and nearby uplands",
                       {"note_my": "နေပြည်တော်က အလယ်ပိုင်းမိုးနည်းဒေသနဲ့ တောင်ခြေဒေသကြားမှာ ရှိတာကြောင့် မြို့နယ်အလိုက် ကွာနိုင်ပါတယ်။", "note_en": "Naypyitaw sits near the transition between the central plains and nearby uplands."})

    if region in MIXED:
        m = MIXED[region]
        return _result(region, REGION_PRIMARY.get(region, m["zones"][0]), m["zones"], "medium", "mixed administrative region", m)

    zone = REGION_PRIMARY.get(region)
    if zone:
        return _result(region, zone, [zone], "medium", "broad regional agro-climate assignment", None)
    return _result(region, None, [], "low", "region not mapped", None)


def _result(region: str, primary: str | None, zones: list[str], confidence: str, reason: str, note: dict[str, str] | None) -> dict[str, Any]:
    names = region_names().get(region, {})
    return {
        "region": region,
        "region_my": names.get("my") or region,
        "region_en": names.get("en") or region,
        "zone": primary,
        "zones": zones,
        "confidence": confidence,
        "reason": reason,
        "mixed": len(zones) > 1,
        "labels": {z: ZONE_LABELS[z] for z in zones if z in ZONE_LABELS},
        "note_my": (note or {}).get("note_my", ""),
        "note_en": (note or {}).get("note_en", ""),
        "method": "Myanmar broad agro-climate references + local admin boundary; not a township soil survey",
    }
