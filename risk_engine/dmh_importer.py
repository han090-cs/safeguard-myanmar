"""Official warnings importer for Myanmar's Department of Meteorology and Hydrology (DMH).

DMH has no working machine-readable alert feed (its 2016 CAP platform, dmhwarning.gov.mm, no longer responds), so
this module reads the public warning pages on www.moezala.gov.mm:

    discovery   warning category listings (/en/<category>) + the site RSS feed  -> node ids
    fetch       each node in English (/en/warning/<id>) and Burmese (/my/warning/<id>)
    classify    pure function: publish only when every check passes, otherwise keep it out of the dashboard
    write       data/official_alerts.json (read by OfficialAlertStore) and data/official_alerts_state.json (audit)

Publishing rules (all must hold, otherwise the node goes to the review queue with its reasons):
  * both language versions exist and neither is a "Nothing Special" / "မရှိပါ" status post
    (DMH posts these daily in every warning category, and its translations are not always in sync);
  * the title names a known warning type; "Low Pressure Area Condition" style news is not a warning;
  * the issue time is present, the same in both languages, recent, and not far in the future;
  * at least one state/region is named (for heavy rain: only the "heavyfalls in ..." clause counts), or both
    texts say the whole country; and the Burmese text names every state/region taken from the English text.

Nothing here writes health advice or rewrites DMH wording: an alert carries DMH's own title, a link to the page,
the regions it names, and its validity window.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import tempfile
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Optional

import httpx
from bs4 import BeautifulSoup

from .config import DATA_DIR, MYANMAR_TZ
from .official import NATIONAL

log = logging.getLogger("risk_engine.dmh")

BASE = "https://www.moezala.gov.mm"
ISSUER = "Department of Meteorology and Hydrology (DMH), Myanmar"
CATEGORIES = ("heavy-rainfall-warning", "cyclone-warning", "strong-wind-warning", "untimely-rainfall-warning",
              "tsunami-warning", "flood-warning")
USER_AGENT = "MyanmarWeather/2.0 (official-warnings importer; polls every 20 minutes)"
PARSER_VERSION = "2"

MAX_AGE = timedelta(days=5)             # posts issued earlier than this are ignored
MAX_FUTURE = timedelta(hours=18)        # DMH pre-posts some items for 08:00 the next morning
KEEP_AFTER_EXPIRY = timedelta(days=30)  # expired alerts stay in the file for the engine's 28-day flood look-back
REFETCH_AFTER = timedelta(hours=3)      # recent nodes are re-read in case DMH edits them
REQUEST_GAP_S = 0.8                     # politeness delay between requests

TROPICAL = {"cyclone", "depression"}
DEFAULT_VALIDITY = {"cyclone": 12, "depression": 12, "tsunami": 12}   # hours; others 24
MAX_VALIDITY = {"cyclone": 36, "depression": 36}                        # hours; others 5 days

# ------------------------------------------------------------------------------------------------ gazetteer
REGIONS_EN = {
    "Yangon": r"\b(?:Yangon|Rangoon)\b",
    "Mandalay": r"\bMandalay\b",
    "Naypyitaw": r"\b(?:Nay\s?Pyi\s?Taw|Naypyi(?:taw|daw))\b",
    "Bago": r"\b(?:Bago|Pegu)\b",
    "Magway": r"\b(?:Magway|Magwe)\b",
    "Sagaing": r"\bSagaing\b",
    "Ayeyarwady": r"\b(?:Ayeyarwa?dd?y|Ayeyawady|Irrawaddy)\b",
    "Tanintharyi": r"\b(?:Tanintha?r?yi|Tenasserim)\b",
    "Kachin": r"\bKachin\b",
    "Kayah": r"\b(?:Kayah|Karenni)\b",
    "Kayin": r"\b(?:Kayin|Karen)\b",
    "Chin": r"\bChin\b",
    "Mon": r"\bMon\b",
    "Rakhine": r"\b(?:Rakhine|Arakan)\b",
    "Shan": r"\bShan\b",
}
REGIONS_MY = {
    "Yangon": ("ရန်ကုန်",), "Mandalay": ("မန္တလေး",), "Naypyitaw": ("နေပြည်တော်",), "Bago": ("ပဲခူး",),
    "Magway": ("မကွေး",), "Sagaing": ("စစ်ကိုင်း",), "Ayeyarwady": ("ဧရာဝတီ",), "Tanintharyi": ("တနင်္သာရီ",),
    "Kachin": ("ကချင်",), "Kayah": ("ကယား",), "Kayin": ("ကရင်",), "Chin": ("ချင်းပြည်နယ်",), "Mon": ("မွန်ပြည်နယ်",),
    "Rakhine": ("ရခိုင်",), "Shan": ("ရှမ်း",),
}
NATIONAL_EN = re.compile(r"whole country|throughout the country|entire country|all over (?:the country|Myanmar)", re.I)
NATIONAL_MY = ("မြန်မာနိုင်ငံအရပ်ရပ်", "တစ်နိုင်ငံလုံး")

TYPE_RULES = (   # checked against the English title, in order
    ("tsunami", re.compile(r"tsunami", re.I)),
    ("cyclone", re.compile(r"cyclonic\s+storm", re.I)),
    ("depression", re.compile(r"depression", re.I)),
    ("heavy_rain", re.compile(r"heavy\s*rain", re.I)),
    ("strong_wind", re.compile(r"strong\s*wind", re.I)),
    ("untimely_rain", re.compile(r"untimely\s*rain", re.I)),
    ("flood", re.compile(r"flood\s+warning|river\s+flood", re.I)),
    ("weather_early_warning", re.compile(r"early\s+warning\s+for\s+weather\s+events", re.I)),
    ("cyclone_generic", re.compile(r"\bcyclone\b|\bstorm\b", re.I)),       # e.g. "Cyclone Warning" / "Cyclone Warming"
)
NOT_A_WARNING = re.compile(r"low\s+pressure\s+area|bay\s+of\s+bengal\s+condition|well\s+marked", re.I)
STATUS_BODY = re.compile(r"no\w*thing\s+special|\bno\s+warning\b|\bno\s+(?:\w+\s+){1,3}warnings?\s+(?:is\s+|has\s+been\s+)?issued"
                         r"|\bthere\s+is\s+no\s+[\w\s]{1,40}?\s+issued|မရှိပါ|ထုတ်ပြန်ထားမှု\s*မရှိ", re.I)
HEAVY_CLAUSE = re.compile(r"heavy\s?falls?|heavy\s+rain(?:fall)?s?", re.I)
CLAUSE_END = re.compile(r"\b(?:during|from|with|for|until|till)\b|[.;:]", re.I)
DATE_AFTER_TO = re.compile(r"\bto\s*\(?\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{4})\s*\)?", re.I)
TO_NEXT_HOURS = re.compile(r"\bto\s+(?:the\s+)?next\s*\(?\s*(\d{1,3})\s*\)?\s*hours?", re.I)
MYANMAR_CHARS = re.compile(r"[က-႟]")
INVISIBLE = dict.fromkeys(map(ord, "​﻿­"), None)


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("\xa0", " ").translate(INVISIBLE)).strip()


# ------------------------------------------------------------------------------------------------ page parsing
@dataclass
class NodePage:
    nid: str
    lang: str
    title: str
    issued: Optional[datetime]      # UTC, from <time datetime>
    lines: list[str]                # body lines without the date line

    @property
    def text(self) -> str:
        return " ".join(self.lines)

    def body_without_title(self) -> str:
        t = self.text
        # the Burmese title is often the first body line; never strip the only line (it may be "Nothing Special")
        for prefix in (self.title, self.lines[0] if len(self.lines) > 1 else ""):
            if prefix and t.startswith(prefix):
                t = t[len(prefix):].strip()
        return t


def parse_node(html: str, nid: str, lang: str) -> Optional[NodePage]:
    """A DMH warning page -> NodePage, or None when the page has no warning article (e.g. missing translation)."""
    s = BeautifulSoup(html, "html.parser")
    art = s.find("article", class_=lambda c: c and "node--type-warning" in c)
    if art is None:
        return None
    h1 = s.find("h1")
    t = art.find("time")
    issued = None
    if t is not None and t.get("datetime"):
        try:
            issued = datetime.fromisoformat(t["datetime"].replace("Z", "+00:00")).astimezone(timezone.utc)
        except ValueError:
            issued = None
    content = art.select_one(".node__content") or art
    date_text = _clean(t.get_text(" ", strip=True)) if t is not None else None
    lines = [_clean(x) for x in content.get_text("\n", strip=True).split("\n")]
    lines = [x for x in lines if x and x != date_text]
    return NodePage(nid=nid, lang=lang, title=_clean(h1.get_text(" ", strip=True)) if h1 else "", issued=issued, lines=lines)


def parse_listing(html: str) -> list[tuple[str, str, Optional[datetime]]]:
    """Category listing page -> [(node id, title, issued UTC)]."""
    s = BeautifulSoup(html, "html.parser")
    out, seen = [], set()
    for a in s.select("a[href*='/warning/']"):
        m = re.search(r"/warning/(\d+)", a.get("href", ""))
        if not m or m.group(1) in seen:
            continue
        seen.add(m.group(1))
        row = a.find_parent(class_="views-row")
        t = row.find("time") if row is not None else None
        issued = None
        if t is not None and t.get("datetime"):
            try:
                issued = datetime.fromisoformat(t["datetime"].replace("Z", "+00:00")).astimezone(timezone.utc)
            except ValueError:
                pass
        out.append((m.group(1), _clean(a.get_text(" ", strip=True)), issued))
    return out


def parse_rss(xml: str) -> list[str]:
    """Site RSS feed -> node ids of items under /warning/."""
    ids = []
    for link in re.findall(r"<link>([^<]+)</link>", xml):
        m = re.search(r"/warning/(\d+)", link)
        if m and m.group(1) not in ids:
            ids.append(m.group(1))
    return ids


# ------------------------------------------------------------------------------------------------ classification
@dataclass
class Decision:
    nid: str
    status: str                      # published | needs_review | status_post | not_a_warning | too_old | unavailable
    reasons: list[str] = field(default_factory=list)
    type: Optional[str] = None
    regions: list[str] = field(default_factory=list)
    region_basis: str = ""
    issued: Optional[str] = None
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    title_en: str = ""
    title_my: str = ""
    url_en: str = ""
    url_my: str = ""
    stations: list[str] = field(default_factory=list)          # river flood warnings only
    points: list[list[float]] = field(default_factory=list)    # [lat, lon] of located stations


def _deglue(text: str) -> str:
    """DMH text sometimes loses spaces ('AyeyarwadyRegions', 'heavy falls inNaypyitaw'); split lower→Upper joins."""
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", text)


def regions_en(text: str) -> list[str]:
    text = _deglue(text)
    return [r for r, pat in REGIONS_EN.items() if re.search(pat, text, re.I)]


def regions_my(text: str) -> set[str]:
    t = text.replace(" ", "")
    return {r for r, names in REGIONS_MY.items() if any(n.replace(" ", "") in t for n in names)}


def heavy_rain_regions(text: str) -> list[str]:
    """States/regions in the 'heavyfalls in ...' clauses only (the general rain forecast names most of the country)."""
    found: list[str] = []
    text = _deglue(text)
    for m in HEAVY_CLAUSE.finditer(text):
        rest = text[m.end():m.end() + 400]
        end = CLAUSE_END.search(rest)
        for r in regions_en(rest[:end.start()] if end else rest):
            if r not in found:
                found.append(r)
    return found


def is_status_post(page: NodePage) -> bool:
    body = page.body_without_title()
    return len(body) <= 80 and bool(STATUS_BODY.search(body))


def warning_type(title: str, body: str) -> Optional[str]:
    for name, pat in TYPE_RULES:
        if pat.search(title):
            if name != "cyclone_generic":
                return name
            # generic "Cyclone Warning" titles: decide from the text
            if re.search(r"cyclonic\s+storm", body, re.I):
                return "cyclone"
            if re.search(r"depression", body, re.I):
                return "depression"
            if NOT_A_WARNING.search(body):
                return "not_a_warning"
            return None
    if NOT_A_WARNING.search(title):
        return "not_a_warning"
    return None


def validity(kind: str, issued: datetime, text: str) -> tuple[datetime, str]:
    """End of validity: the latest 'to DD-MM-YYYY' date (end of that day, MST), else 'to next (N) hours', else a default."""
    ends = []
    for d, mth, y in DATE_AFTER_TO.findall(text):
        try:
            ends.append(datetime(int(y), int(mth), int(d), 23, 59, tzinfo=MYANMAR_TZ).astimezone(timezone.utc))
        except ValueError:
            continue
    basis = "date in text"
    if ends:
        end = max(ends)
    else:
        m = TO_NEXT_HOURS.search(text)
        if m:
            end, basis = issued + timedelta(hours=int(m.group(1))), "'next N hours' in text"
        else:
            end, basis = issued + timedelta(hours=DEFAULT_VALIDITY.get(kind, 24)), "default for this warning type"
    cap = issued + timedelta(hours=MAX_VALIDITY.get(kind, 24 * 5))
    if end > cap:
        end, basis = cap, basis + " (capped)"
    if end < issued + timedelta(hours=3):
        end, basis = issued + timedelta(hours=DEFAULT_VALIDITY.get(kind, 24)), "default (text date before issue time)"
    return end, basis


def _title_my(page: NodePage) -> str:
    if MYANMAR_CHARS.search(page.title):
        return page.title
    for line in page.lines:
        if MYANMAR_CHARS.search(line):
            return line if len(line) <= 160 else line[:157].rsplit(" ", 1)[0] + "…"
    return page.title


# ------------------------------------------------------------------------------------------------ river floods
FLOOD_TITLE_EN = re.compile(r"flood\s+warning", re.I)
FLOOD_TITLE_MY = ("ရေကြီးခြင်းသတိပေးချက်",)
FLOOD_HORIZON = re.compile(r"during\s+the\s+next\s*\(?\s*(\d{1,2})\s*\)?\s*(hours?|days?)", re.I)
FLOOD_MIN_H, FLOOD_MAX_H = 24, 72
AT_NAME = re.compile(r"\bat\s+([A-Z][a-z]+(?:[\s-]?[A-Z][a-z]+)?)")


@dataclass(frozen=True)
class Station:
    id: str
    name_en: str
    name_my: Optional[str]
    river: str
    lat: Optional[float]
    lon: Optional[float]
    region: Optional[str]
    variants: tuple[str, ...]


_STATIONS: Optional[list[Station]] = None


def stations(data_dir: Path = DATA_DIR) -> list[Station]:
    global _STATIONS
    if _STATIONS is None:
        raw = _read(data_dir / "dmh_river_stations.json", {"stations": []})["stations"]
        _STATIONS = [Station(s["id"], s["name_en"], s.get("name_my"), s["river"], s.get("lat"), s.get("lon"),
                             s.get("region"), tuple(s["variants"])) for s in raw]
    return _STATIONS


def _variant_re(v: str) -> str:
    return r"(?<![A-Za-z])" + r"\s*".join(re.escape(ch) for ch in v.replace(" ", "")) + r"(?![a-z])"


def _normalise_flood_text(text: str) -> str:
    t = _deglue(text)
    t = re.sub(r"\b(is|are|was|were)(observed|expected|likely)", r"\1 \2", t, flags=re.I)
    return re.sub(r"\bits(danger)", r"its \1", t, flags=re.I)


def flood_stations(text: str) -> tuple[list[Station], list[str]]:
    """Stations named in the 'water level of <river> at <station>' sentences, and names that are not in the table."""
    t = _normalise_flood_text(text)
    sentences = [x for x in re.split(r"(?<=[.])\s+", t) if re.search(r"water\s+levels?\s+of", x, re.I)]
    known: list[Station] = []
    unknown: list[str] = []
    for sent in sentences:
        for st in stations():
            if st not in known and any(re.search(_variant_re(v), sent, re.I) for v in st.variants):
                known.append(st)
        for name in AT_NAME.findall(sent):
            if not any(re.fullmatch(_variant_re(v), name, re.I) or re.search(_variant_re(v), name, re.I)
                       for st in stations() for v in st.variants):
                if name not in unknown:
                    unknown.append(name)
    return known, unknown


def _is_flood_page(p: NodePage) -> bool:
    head = p.title + " " + (p.lines[0] if p.lines else "")
    return bool(FLOOD_TITLE_EN.search(p.title)) or any(x in head.replace(" ", "") for x in FLOOD_TITLE_MY)


def _mostly_burmese(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    return bool(letters) and sum(1 for c in letters if MYANMAR_CHARS.match(c)) / len(letters) > 0.3


def classify_flood(en: Optional[NodePage], my: Optional[NodePage], now: datetime, d: Decision) -> Decision:
    """River flood warnings: DMH publishes each one in a single language, so there is no bilingual cross-check;
    instead every station named must be in the station table and at least one must have a location."""
    pages = [p for p in (en, my) if p is not None]
    d.type = "flood"
    if all(is_status_post(p) for p in pages):
        d.status, d.reasons = "status_post", ["'no flood warning issued' status post"]
        issued = [p.issued for p in pages if p.issued]
        d.issued = min(issued).isoformat() if issued else None
        return d
    page = next(p for p in (en, my) if p is not None and not is_status_post(p))
    if page.issued is None:
        d.reasons.append("no issue time")
        return d
    d.issued = page.issued.isoformat()
    if now - page.issued > MAX_AGE:
        d.status, d.reasons = "too_old", ["issued more than 5 days ago"]
        return d
    if page.issued - now > MAX_FUTURE:
        d.reasons.append("issue time is far in the future")
        return d
    if _mostly_burmese(page.text):
        d.reasons.append("Burmese-only flood warning; stations are read from English text only")
        return d
    known, unknown = flood_stations(page.text)
    if unknown:
        d.reasons.append("station(s) not in the station table: " + ", ".join(unknown))
        return d
    if not known:
        d.reasons.append("no river station found (the warning text may be an image)")
        return d
    located = [s for s in known if s.lat is not None]
    if not located:
        d.reasons.append("none of the named stations has a known location: " + ", ".join(s.name_en for s in known))
        return d

    hours = [int(n) * (24 if u.lower().startswith("day") else 1) for n, u in FLOOD_HORIZON.findall(page.text)]
    span = min(max([FLOOD_MIN_H] + hours), FLOOD_MAX_H)
    d.valid_from, d.valid_to = page.issued.isoformat(), (page.issued + timedelta(hours=span)).isoformat()
    d.stations = [s.name_en for s in known]
    d.points = [[s.lat, s.lon] for s in located]
    d.regions = sorted({s.region for s in located if s.region})
    names_en = ", ".join(s.name_en for s in known)
    d.title_en = f"Flood Warning – {names_en}"
    d.title_my = "ရေကြီးခြင်းသတိပေးချက် – " + "၊ ".join(s.name_my or s.name_en for s in known)
    d.region_basis = "river stations: " + ", ".join(f"{s.name_en} ({s.river})" for s in known)
    d.reasons = [f"validity: {span} h from the forecast horizon in the text (min {FLOOD_MIN_H}, max {FLOOD_MAX_H})"]
    unlocated = [s.name_en for s in known if s.lat is None]
    if unlocated:
        d.reasons.append("shown around the located stations only; not located: " + ", ".join(unlocated))
    d.status = "published"
    return d


def classify(en: Optional[NodePage], my: Optional[NodePage], now: datetime) -> Decision:
    nid = (en or my).nid if (en or my) else "?"
    d = Decision(nid=nid, status="needs_review", url_en=f"{BASE}/en/warning/{nid}", url_my=f"{BASE}/my/warning/{nid}")
    if en is None and my is None:
        d.status, d.reasons = "unavailable", ["page not found in either language"]
        return d
    if any(_is_flood_page(p) for p in (en, my) if p is not None):
        return classify_flood(en, my, now, d)
    en_status = en is not None and is_status_post(en)
    my_status = my is not None and is_status_post(my)
    if (en is None or en_status) and (my is None or my_status):
        d.status, d.reasons = "status_post", ["'no warning' status post"]
        return d
    if en is None or my is None:
        d.reasons.append("only one language version exists")
        return d
    if en_status != my_status:
        d.reasons.append("English and Burmese versions disagree (one is a 'no warning' post)")
        return d

    d.title_en, d.title_my = en.title, _title_my(my)
    if en.issued is None:
        d.reasons.append("no issue time")
        return d
    d.issued = en.issued.isoformat()
    if my.issued is not None and abs(my.issued - en.issued) > timedelta(hours=1):
        d.reasons.append("issue times differ between languages")
        return d
    if now - en.issued > MAX_AGE:
        d.status, d.reasons = "too_old", ["issued more than 5 days ago"]
        return d
    if en.issued - now > MAX_FUTURE:
        d.reasons.append("issue time is far in the future")
        return d

    kind = warning_type(en.title, en.text)
    if kind == "not_a_warning":
        d.status, d.reasons = "not_a_warning", ["news/condition report, not a warning"]
        return d
    if kind is None:
        d.reasons.append(f"unrecognised title: {en.title!r}")
        return d
    d.type = kind

    regs = heavy_rain_regions(en.text) if kind == "heavy_rain" else regions_en(en.text)
    d.region_basis = "heavy-rain clause" if kind == "heavy_rain" else "all states/regions named"
    if not regs:
        if NATIONAL_EN.search(en.text) and any(p in my.text.replace(" ", "") for p in NATIONAL_MY):
            regs, d.region_basis = [NATIONAL], "whole country"
        else:
            d.reasons.append("no state/region could be identified")
            return d
    if regs != [NATIONAL]:
        missing = [r for r in regs if r not in regions_my(my.text)]
        if missing:
            d.reasons.append("Burmese text does not name: " + ", ".join(missing))
            return d
    d.regions = regs

    end, basis = validity(kind, en.issued, en.text)
    d.valid_from, d.valid_to = en.issued.isoformat(), end.isoformat()
    d.status, d.reasons = "published", [f"validity: {basis}"]
    return d


def supersede(decisions: Iterable[Decision]) -> dict[str, str]:
    """When a published warning ends early. Returns nid -> adjusted valid_to.
    - Most kinds: a newer warning of the same family ends the previous one at its issue time.
    - River floods (several stations can be under warning at once): a newer warning ends an older one only if they
      share a station; a later 'no flood warning issued' post ends every earlier flood warning."""
    decisions = list(decisions)
    def fam(t):
        return "tropical" if t in TROPICAL else t
    groups: dict[str, list[Decision]] = {}
    for d in decisions:
        if d.status == "published" and d.type != "flood":
            groups.setdefault(fam(d.type), []).append(d)
    out = {}
    for items in groups.values():
        items.sort(key=lambda d: d.valid_from)
        for older, newer in zip(items, items[1:], strict=True):
            out[older.nid] = min(older.valid_to, newer.valid_from)

    floods = sorted((d for d in decisions if d.status == "published" and d.type == "flood"), key=lambda d: d.valid_from)
    all_clear = sorted(d.issued for d in decisions if d.status == "status_post" and d.type == "flood" and d.issued)
    for i, d in enumerate(floods):
        end = d.valid_to
        for later in floods[i + 1:]:
            if later.valid_from > d.valid_from and set(later.stations) & set(d.stations):
                end = min(end, later.valid_from)
                break
        for t in all_clear:
            if t > d.valid_from:
                end = min(end, t)
                break
        if end != d.valid_to:
            out[d.nid] = end
    return out


def to_alert(d: Decision, valid_to: str, retrieved_at: str) -> dict:
    return {
        "id": f"DMH-{d.nid}", "source": "dmh", "issuer": ISSUER, "type": d.type, "regions": d.regions,
        "valid_from": d.valid_from, "valid_to": valid_to, "url": d.url_my,
        "links": {"my": d.url_my, "en": d.url_en}, "title": {"my": d.title_my, "en": d.title_en},
        "retrieved_at": retrieved_at, "region_basis": d.region_basis, "parser_version": PARSER_VERSION,
        **({"stations": d.stations, "points": d.points} if d.points else {}),
    }


# ------------------------------------------------------------------------------------------------ files
def _atomic_write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, path)


def _read(path: Path, default: dict) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def write_outputs(data_dir: Path, state: dict, now: datetime) -> dict:
    """Rebuild official_alerts.json: manual entries are kept as they are; DMH entries come from the state."""
    alerts_path = data_dir / "official_alerts.json"
    current = _read(alerts_path, {"alerts": []})
    manual = [a for a in current.get("alerts", []) if a.get("source") != "dmh"]
    decisions = [Decision(**n["decision"]) for n in state.get("nodes", {}).values() if "decision" in n]
    adjusted = supersede(decisions)
    dmh = []
    for d in decisions:
        if d.status != "published":
            continue
        valid_to = adjusted.get(d.nid, d.valid_to)
        if datetime.fromisoformat(valid_to) < now - KEEP_AFTER_EXPIRY:
            continue
        dmh.append(to_alert(d, valid_to, state["nodes"][d.nid]["fetched_at"]))
    dmh.sort(key=lambda a: a["valid_from"], reverse=True)
    out = {"_comment": current.get("_comment", "Official warnings. Entries with source 'dmh' are written by "
                                                 "risk_engine/dmh_importer.py; other entries are kept as they are."),
           "updated_at": now.isoformat(), "alerts": manual + dmh}
    _atomic_write(alerts_path, out)
    return out


# ------------------------------------------------------------------------------------------------ network
async def _get(client: httpx.AsyncClient, url: str) -> Optional[str]:
    r = await client.get(url)
    await asyncio.sleep(REQUEST_GAP_S)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.text


async def run_once(client: Optional[httpx.AsyncClient] = None, data_dir: Path = DATA_DIR,
                   now: Optional[datetime] = None) -> dict:
    """One import cycle. Never removes published alerts because of a network failure."""
    now = now or datetime.now(timezone.utc)
    own = client is None
    client = client or httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, timeout=30, follow_redirects=True)
    state_path = data_dir / "official_alerts_state.json"
    state = _read(state_path, {"source": {}, "nodes": {}})
    state.setdefault("nodes", {})
    src = state.setdefault("source", {})
    src.update({"name": ISSUER, "base_url": BASE, "parser_version": PARSER_VERSION, "last_attempt_at": now.isoformat()})
    errors, candidates = [], {}
    try:
        for slug in CATEGORIES:
            try:
                html = await _get(client, f"{BASE}/en/{slug}")
                for nid, _title, issued in parse_listing(html or ""):
                    if issued is None or now - issued <= MAX_AGE:
                        candidates[nid] = issued
            except httpx.HTTPError as exc:
                errors.append(f"{slug}: {type(exc).__name__}")
        try:
            for nid in parse_rss(await _get(client, f"{BASE}/rss.xml") or ""):
                candidates.setdefault(nid, None)
        except httpx.HTTPError as exc:
            errors.append(f"rss: {type(exc).__name__}")

        discovered_ok = len(errors) < len(CATEGORIES) + 1
        for nid in sorted(candidates, key=int, reverse=True):
            prev = state["nodes"].get(nid)
            if prev and prev.get("decision", {}).get("status") in ("too_old",):
                continue
            if prev and now - datetime.fromisoformat(prev["fetched_at"]) < REFETCH_AFTER:
                continue
            try:
                en_html = await _get(client, f"{BASE}/en/warning/{nid}")
                my_html = await _get(client, f"{BASE}/my/warning/{nid}")
            except httpx.HTTPError as exc:
                errors.append(f"node {nid}: {type(exc).__name__}")
                continue
            en = parse_node(en_html, nid, "en") if en_html else None
            my = parse_node(my_html, nid, "my") if my_html else None
            d = classify(en, my, now)
            state["nodes"][nid] = {"fetched_at": now.isoformat(), "decision": asdict(d)}
        # forget nodes that are long gone from the listings
        for nid in [n for n, v in state["nodes"].items()
                    if n not in candidates and now - datetime.fromisoformat(v["fetched_at"]) > KEEP_AFTER_EXPIRY]:
            del state["nodes"][nid]
        if discovered_ok:
            src["last_success_at"] = now.isoformat()
        src["last_error"] = "; ".join(errors) or None
    finally:
        if own:
            await client.aclose()
    _atomic_write(state_path, state)
    write_outputs(data_dir, state, now)
    counts: dict[str, int] = {}
    for v in state["nodes"].values():
        s = v["decision"]["status"]
        counts[s] = counts.get(s, 0) + 1
    return {"checked_at": now.isoformat(), "candidates": len(candidates), "errors": errors, "nodes_by_status": counts}


def source_status(data_dir: Path = DATA_DIR, now: Optional[datetime] = None, stale_after: timedelta = timedelta(hours=2)) -> dict:
    """What the dashboard shows about the official-warnings source."""
    now = now or datetime.now(timezone.utc)
    state = _read(data_dir / "official_alerts_state.json", {})
    src = state.get("source", {})
    last = src.get("last_success_at")
    review = [dict(nid=n, title=v["decision"].get("title_en") or v["decision"].get("title_my"),
                   reasons=v["decision"].get("reasons", []))
              for n, v in state.get("nodes", {}).items() if v.get("decision", {}).get("status") == "needs_review"]
    return {
        "name": ISSUER, "url": BASE, "importer_enabled": importer_enabled(),
        "last_success_at": last, "last_attempt_at": src.get("last_attempt_at"), "last_error": src.get("last_error"),
        "stale": last is None or now - datetime.fromisoformat(last) > stale_after,
        "review_queue": review,
    }


def importer_enabled() -> bool:
    return os.getenv("DMH_IMPORT", "on").lower() not in ("0", "off", "false", "no")


async def run_forever(interval_minutes: Optional[float] = None, data_dir: Path = DATA_DIR) -> None:
    interval = 60 * float(interval_minutes or os.getenv("DMH_IMPORT_INTERVAL_MIN", "20"))
    await asyncio.sleep(5)
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, timeout=30, follow_redirects=True) as client:
        while True:
            try:
                summary = await run_once(client, data_dir)
                log.info("DMH import: %s", summary)
            except asyncio.CancelledError:
                raise
            except Exception:                       # never let the loop die; the error is recorded on next attempt
                log.exception("DMH import failed")
            await asyncio.sleep(interval)


def start_background_import() -> Optional[asyncio.Task]:
    """Call from the FastAPI lifespan. Disabled with DMH_IMPORT=off."""
    return asyncio.create_task(run_forever()) if importer_enabled() else None


def main() -> None:
    ap = argparse.ArgumentParser(description="Import official warnings from DMH Myanmar (moezala.gov.mm).")
    ap.add_argument("--data-dir", type=Path, default=DATA_DIR)
    ap.add_argument("--review", action="store_true", help="list items waiting for review and exit")
    args = ap.parse_args()
    if args.review:
        print(json.dumps(source_status(args.data_dir)["review_queue"], ensure_ascii=False, indent=1))
        return
    logging.basicConfig(level=logging.INFO)
    print(json.dumps(asyncio.run(run_once(data_dir=args.data_dir)), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
