"""
MIMU gazetteer — local, offline place search for Myanmar.

Backed by data/mimu_locations.db (from MIMU place codes), which has ~56,000
towns and villages with lat/lon. This lets the app resolve *any* Myanmar
place name instantly, from a local database, with no calls to an external
geocoding API and no per-user rate limits — unlike /api/geocode, which goes
out to Open-Meteo.

Usage:
    from gazetteer import search_places
    results = search_places("ပုသိမ်", limit=8)
"""
from __future__ import annotations

import json
import sqlite3
import threading
import math
from functools import lru_cache
from pathlib import Path
from typing import Any

DB_PATH = Path(__file__).parent / "data" / "mimu_locations.db"
ADMIN1_MAP_PATH = Path(__file__).parent / "data" / "mimu_admin1_map.json"
HOSPITALS_DB_PATH = Path(__file__).parent / "data" / "hospitals.db"

_local = threading.local()
_search_cache: dict[tuple[str, int, tuple[str, ...]], list[dict[str, Any]]] = {}
_search_cache_order: list[tuple[str, int, tuple[str, ...]]] = []
_SEARCH_CACHE_MAX = 512
_search_locks: dict[tuple[str,int,tuple[str,...]], threading.Lock] = {}
_search_locks_guard = threading.Lock()
_hospital_cache: dict[tuple[float,float,int], list[dict[str,Any]]] = {}
_hospital_cache_order: list[tuple[float,float,int]] = []
_hospital_cache_max=512
_place_records: list[dict[str, Any]] | None = None
_place_ngrams: dict[str, set[int]] | None = None
_place_township: dict[tuple[str,str],dict[str,str]] | None = None
_place_lock = threading.Lock()
_hospital_points: list[tuple[float, float, dict[str, Any]]] | None = None
_hospital_lock = threading.Lock()


def _connect() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        _local.conn = conn
    return conn


@lru_cache(maxsize=1)
def _admin1_map() -> dict[str, dict[str, str]]:
    with open(ADMIN1_MAP_PATH, encoding="utf-8") as f:
        data = json.load(f)
    data.pop("_comment", None)
    return data


# ---------------------------------------------------------------------------------------------------------------
# English / old-spelling names for the towns people actually search for. The MIMU place list is Burmese-only, so
# "Mandalay" or "Naypyitaw" used to return nothing locally and the app waited on an external geocoder instead.
# Key = lower-case with spaces, hyphens and apostrophes removed; value = the Burmese Town name in mimu_locations.db.
_ALIASES: dict[str, str] = {
    "mandalay": "မန္တလေး", "yangon": "ရန်ကုန်", "rangoon": "ရန်ကုန်", "naypyitaw": "နေပြည်တော်", "naypyidaw": "နေပြည်တော်",
    "nay pyi taw": "နေပြည်တော်", "pathein": "ပုသိမ်", "bassein": "ပုသိမ်", "bago": "ပဲခူး", "pegu": "ပဲခူး",
    "mawlamyine": "မော်လမြိုင်", "moulmein": "မော်လမြိုင်", "taunggyi": "တောင်ကြီး", "myitkyina": "မြစ်ကြီးနား",
    "sittwe": "စစ်တွေ", "akyab": "စစ်တွေ", "magway": "မကွေး", "magwe": "မကွေး", "monywa": "မုံရွာ", "sagaing": "စစ်ကိုင်း",
    "meiktila": "မိတ္ထီလာ", "pyay": "ပြည်", "prome": "ပြည်", "hpaan": "ဘားအံ", "hpa an": "ဘားအံ", "dawei": "ထားဝယ်",
    "tavoy": "ထားဝယ်", "myeik": "မြိတ်", "mergui": "မြိတ်", "lashio": "လားရှိုး", "loikaw": "လွိုင်ကော်", "hakha": "ဟားခါး",
    "pakokku": "ပခုက္ကူ", "taungoo": "တောင်ငူ", "toungoo": "တောင်ငူ", "pyinmana": "ပျဉ်းမနား", "kalaw": "ကလော",
    "nyaungshwe": "ညောင်ရွှေ", "bagan": "ပုဂံ", "pagan": "ပုဂံ", "nyaungu": "ညောင်ဦး", "pyinoolwin": "ပြင်ဦးလွင်",
    "pyin oo lwin": "ပြင်ဦးလွင်", "maymyo": "ပြင်ဦးလွင်", "kyaukse": "ကျောက်ဆည်", "hinthada": "ဟင်္သာတ",
    "myaungmya": "မြောင်းမြ", "labutta": "လပွတ္တာ", "kawthaung": "ကော့သောင်း", "victoriapoint": "ကော့သောင်း",
    "thanlyin": "သန်လျင်", "syriam": "သန်လျင်", "hlaingtharyar": "လှိုင်သာယာ", "insein": "အင်းစိန်", "dagon": "ဒဂုံ",
    "kyaukpyu": "ကျောက်ဖြူ", "thandwe": "သံတွဲ", "sandoway": "သံတွဲ", "mraukU": "မြောက်ဦး", "mrauku": "မြောက်ဦး",
    "muse": "မူဆယ်", "tachileik": "တာချီလိတ်", "tachilek": "တာချီလိတ်", "kengtung": "ကျိုင်းတုံ", "kyaingtong": "ကျိုင်းတုံ",
    "bhamo": "ဗန်းမော်", "putao": "ပူတာအို", "katha": "ကသာ", "kale": "ကလေး", "kalay": "ကလေး", "tamu": "တမူး",
    "myawaddy": "မြဝတီ", "thaton": "သထုံ", "ye": "ရေး", "mogok": "မိုးကုတ်", "yenangyaung": "ရေနံချောင်း", "chauk": "ချောက်",
    "minbu": "မင်းဘူး", "letpadan": "လက်ပံတန်း", "nyaunglebin": "ညောင်လေးပင်", "shwebo": "ရွှေဘို", "yamethin": "ရမည်းသင်း",
    "tharyarwady": "သာယာဝတီ",
}


def _norm_latin(s: str) -> str:
    return "".join(ch for ch in s.lower() if ch.isalnum())


_ALIASES_NORM: dict[str, str] = {_norm_latin(k): v for k, v in _ALIASES.items()}
_EN_BY_MY: dict[str, str] = {}
for _k, _v in _ALIASES.items():           # first spelling listed for a town is its display name
    _EN_BY_MY.setdefault(_v, _k.title())


def _is_latin(s: str) -> bool:
    return not any("\u1000" <= ch <= "\u109f" for ch in s)


def _alias_places(q: str, limit: int) -> list[dict[str, Any]]:
    """Towns whose English name starts with (or, for 3+ letters, contains) the query, exact matches first."""
    nq = _norm_latin(q)
    if len(nq) < 2:
        return []
    exact = [v for k, v in _ALIASES_NORM.items() if k == nq]
    starts = [v for k, v in _ALIASES_NORM.items() if k.startswith(nq) and k != nq]
    inside = [v for k, v in _ALIASES_NORM.items() if len(nq) >= 3 and nq in k and not k.startswith(nq)]
    names: list[str] = []
    for n in exact + starts + inside:
        if n not in names:
            names.append(n)
    conn = _connect()
    admin1_map = _admin1_map()
    out: list[dict[str, Any]] = []
    for n in names:
        row = conn.execute("SELECT id, name, admin1, type, lat, lon FROM locations WHERE name = ? AND type = 'Town' LIMIT 1", (n,)).fetchone()
        if not row:
            continue
        info = admin1_map.get(row["admin1"], {})
        region_en = info.get("region", row["admin1"])
        township = _exact_township_for_name(row["name"], region_en)
        item = {"id": row["id"] + f":{row['name']}", "name": row["name"], "region": region_en,
                "region_my": info.get("name_my", ""), "type": "Town", "latitude": row["lat"], "longitude": row["lon"],
                "country": "Myanmar", "country_code": "MM", "source": "mimu-alias",
                "name_en": _EN_BY_MY.get(row["name"])}
        if township:
            item["township"] = township["name"]
            item["township_en"] = township["name_en"]
            item["township_source"] = township["source"]
        out.append(item)
        if len(out) >= limit:
            break
    return out


def _exact_township_for_name(name: str, region_en: str | None = None) -> dict[str, Any] | None:
    """Return an exact township-name match when the auxiliary township dataset has one.

    The MIMU place gazetteer itself stores place/admin1, not township boundaries.
    Therefore this helper only returns an exact name match from the township dataset;
    it never infers a township from proximity.
    """
    try:
        conn = _hospitals_connect()
        if region_en:
            row = conn.execute(
                """
                SELECT township_my, township_en, region_my, region_en, AVG(lat) lat, AVG(lon) lon
                FROM hospitals
                WHERE township_my = ? AND lower(region_en) LIKE lower(?)
                  AND lat IS NOT NULL AND lon IS NOT NULL
                GROUP BY township_pcode, township_en
                ORDER BY COUNT(*) DESC LIMIT 1
                """,
                (name, f"%{region_en}%"),
            ).fetchone()
        else:
            row = conn.execute(
                """
                SELECT township_my, township_en, region_my, region_en, AVG(lat) lat, AVG(lon) lon
                FROM hospitals
                WHERE township_my = ? AND lat IS NOT NULL AND lon IS NOT NULL
                GROUP BY township_pcode, township_en
                ORDER BY COUNT(*) DESC LIMIT 1
                """,
                (name,),
            ).fetchone()
        if not row:
            return None
        return {
            "name": row["township_my"] or row["township_en"],
            "name_en": row["township_en"] or "",
            "region": row["region_en"] or "",
            "region_my": row["region_my"] or "",
            "latitude": row["lat"], "longitude": row["lon"],
            "source": "mimu-township-exact",
        }
    except sqlite3.Error:
        return None


def _load_place_index() -> tuple[list[dict[str, Any]], dict[str, set[int]]]:
    global _place_records, _place_ngrams, _place_township
    if _place_records is not None and _place_ngrams is not None: return _place_records, _place_ngrams
    with _place_lock:
        if _place_records is not None and _place_ngrams is not None: return _place_records, _place_ngrams
        conn=_connect(); rows=conn.execute("SELECT id,name,admin1,type,lat,lon FROM locations WHERE type IN ('Town','Village')").fetchall()
        amap=_admin1_map(); records=[]; grams={}
        for row in rows:
            info=amap.get(row["admin1"],{})
            rec={"id":row["id"]+":"+row["name"],"name":row["name"],"region":info.get("region",row["admin1"]),"region_my":info.get("name_my",row["admin1"]),"type":row["type"],"latitude":row["lat"],"longitude":row["lon"],"country":"Myanmar","country_code":"MM","source":"mimu"}
            idx=len(records); records.append(rec)
            n=row["name"]
            for i in range(max(0,len(n)-1)):
                g=n[i:i+2]; grams.setdefault(g,set()).add(idx)
        # One-time township map: avoid a second SQLite query for every search result.
        twmap={}
        try:
            hc=_hospitals_connect()
            for r in hc.execute("SELECT township_my,township_en,region_en FROM hospitals WHERE township_my IS NOT NULL GROUP BY township_pcode,township_en").fetchall():
                twmap[(r["township_my"],r["region_en"])]={"name":r["township_my"] or r["township_en"],"name_en":r["township_en"] or "","source":"mimu-township-exact"}
        except sqlite3.Error: pass
        _place_records,_place_ngrams,_place_township=records,grams,twmap
        return records,grams

def search_places(query: str, limit: int = 8, types: tuple[str, ...] = ("Town", "Village")) -> list[dict[str, Any]]:
    q=" ".join(query.split())
    if not q: return []
    key=(q,limit,types)
    cached=_search_cache.get(key)
    if cached is not None: return [dict(x) for x in cached]
    if _is_latin(q):
        hits=_alias_places(q,limit)
        if len(hits)<limit:
            hits.extend(_township_fallback(q,limit-len(hits),{h["name"] for h in hits}))
        _search_cache[key]=hits[:limit]; _search_cache_order.append(key)
        while len(_search_cache_order)>_SEARCH_CACHE_MAX: _search_cache.pop(_search_cache_order.pop(0),None)
        return hits[:limit]
    records,grams=_load_place_index()
    candidates=None
    if len(q)>=2:
        sets=[grams.get(q[i:i+2],set()) for i in range(len(q)-1)]
        if sets and all(sets): candidates=set.intersection(*sets)
        else: candidates=set()
    else: candidates=set(range(len(records)))
    def rank(i):
        r=records[i]; n=r["name"]
        return (0 if n==q else 1 if n.startswith(q) else 2, 0 if r["type"]=="Town" else 1, len(n), n)
    # Towns match anywhere in the name. Villages are a much noisier list (MIMU's ~56,000 village records include
    # look-alike, duplicated and variant spellings), so a village is only offered when its name STARTS with what was typed.
    # Zero-width characters are ignored and one entry is kept per (name, region).
    clean=lambda t:t.replace("\u200b","").replace("\u200c","").replace("\u200d","").replace("\ufeff","")
    qc=clean(q)
    matched=[i for i in candidates if records[i]["type"] in types and (
        qc in clean(records[i]["name"]) if records[i]["type"]=="Town" else clean(records[i]["name"]).startswith(qc))]
    matched.sort(key=rank)
    seen_nr=set(); uniq=[]
    for i in matched:
        k=(clean(records[i]["name"]),records[i]["region"])
        if k in seen_nr: continue
        seen_nr.add(k); uniq.append(i)
    matched=uniq
    out=[]
    for i in matched[:limit]:
        rec=dict(records[i])
        if rec["type"]=="Town" and _place_township is not None:
            tw=_place_township.get((rec["name"],rec["region"]))
            if tw: rec.update({"township":tw["name"],"township_en":tw["name_en"],"township_source":tw["source"]})
        out.append(rec)
    if len(out)<limit:
        out.extend(_township_fallback(q,limit-len(out),{x["name"] for x in out}))
    _search_cache[key]=out[:limit]; _search_cache_order.append(key)
    while len(_search_cache_order)>_SEARCH_CACHE_MAX: _search_cache.pop(_search_cache_order.pop(0),None)
    return out[:limit]


def _township_fallback(q: str, limit: int, seen: set) -> list[dict[str, Any]]:
    """Townships the MIMU Town list misses (spelling variants) and English names such as "Pathein".
    Uses the township names + coordinates in data/hospitals.db (one point per township = mean of its facilities)."""
    try:
        conn = _hospitals_connect()
        like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        rows = conn.execute(
            """
            SELECT township_my, township_en, region_my, region_en, AVG(lat) AS lat, AVG(lon) AS lon
            FROM hospitals
            WHERE lat IS NOT NULL AND lon IS NOT NULL
              AND (township_my LIKE ? ESCAPE '\\' OR township_en LIKE ? ESCAPE '\\')
            GROUP BY township_pcode, township_en
            ORDER BY length(COALESCE(township_en, township_my)) ASC
            LIMIT ?
            """,
            (like, like, limit * 2),
        ).fetchall()
    except sqlite3.Error:
        return []
    out = []
    for row in rows:
        name = (row["township_my"] or row["township_en"] or "").split(",")[0].strip()
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(
            {
                "id": f"township:{row['township_en']}",
                "name": name,
                "region": row["region_en"],
                "region_my": row["region_my"] or "",
                "type": "Township",
                "latitude": row["lat"],
                "longitude": row["lon"],
                "country": "Myanmar",
                "country_code": "MM",
                "source": "mimu-township",
            }
        )
        if len(out) >= limit:
            break
    return out


@lru_cache(maxsize=1)
def list_regions() -> list[dict[str, str]]:
    m = _admin1_map()
    out=[]
    for code, info in sorted(m.items(), key=lambda kv: (kv[1].get("name_my", ""), kv[0])):
        out.append({"id": code, "name": info.get("name_my", code), "name_en": info.get("region", code)})
    return out

def list_towns(admin1: str, limit: int = 250) -> list[dict[str, Any]]:
    if admin1 not in _admin1_map(): return []
    conn=_connect()
    rows=conn.execute("SELECT id,name,lat,lon FROM locations WHERE admin1=? AND type='Town' ORDER BY name LIMIT ?", (admin1, limit)).fetchall()
    info=_admin1_map().get(admin1,{})
    return [{"id":r["id"]+":"+r["name"],"name":r["name"],"region":info.get("region",admin1),"region_my":info.get("name_my",admin1),"type":"Town","latitude":r["lat"],"longitude":r["lon"],"country":"Myanmar","country_code":"MM","source":"mimu"} for r in rows]

def place_count() -> int:
    conn = _connect()
    return conn.execute("SELECT COUNT(*) FROM locations").fetchone()[0]


def _hospitals_connect() -> sqlite3.Connection:
    conn = getattr(_local, "hosp_conn", None)
    if conn is None:
        conn = sqlite3.connect(str(HOSPITALS_DB_PATH), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        _local.hosp_conn = conn
    return conn


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    from math import radians, sin, cos, atan2, sqrt

    r = 6371.0
    p1, p2 = radians(lat1), radians(lat2)
    dp, dl = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * r * atan2(sqrt(a), sqrt(1 - a))


_LEVEL_RANK = {"General": 0, "District": 1, "Township": 2, "Station": 3, "NA": 4}


def hospital_count() -> int:
    """Return the number of hospital records bundled in the local database."""
    conn = _hospitals_connect()
    row = conn.execute("SELECT COUNT(*) AS n FROM hospitals").fetchone()
    return int(row["n"] or 0)


def _load_hospital_points() -> list[tuple[float, float, dict[str, Any]]]:
    global _hospital_points
    if _hospital_points is not None: return _hospital_points
    with _hospital_lock:
        if _hospital_points is not None: return _hospital_points
        conn=_hospitals_connect()
        rows=conn.execute("SELECT id,name_my,name_en,level_my,level_en,beds,region_en,region_my,township_my,township_en,lat,lon,confidence FROM hospitals WHERE lat IS NOT NULL AND lon IS NOT NULL").fetchall()
        pts=[]
        for row in rows:
            d=dict(row); lat=float(d.pop("lat")); lon=float(d.pop("lon")); d["lat"]=lat; d["lon"]=lon; pts.append((lat,lon,d))
        _hospital_points=pts
        return pts


def nearest_region(lat: float, lon: float, max_km: float = 120.0) -> dict[str, Any] | None:
    """State/region of the nearest MIMU place. Used to give GPS users a zone (crop calendar, emergency numbers)."""
    import math
    records, _ = _load_place_index()
    k = math.cos(math.radians(lat))
    best, bd = None, float("inf")
    for r in records:
        try:
            dy = float(r["latitude"]) - lat
            dx = (float(r["longitude"]) - lon) * k
        except (TypeError, ValueError):
            continue
        d = dx * dx + dy * dy
        if d < bd:
            best, bd = r, d
    if best is None:
        return None
    km = math.sqrt(bd) * 111.0
    if km > max_km:
        return None
    return {"region": best["region"], "region_my": best["region_my"], "place": best["name"], "distance_km": round(km, 1)}


def nearest_hospitals(lat: float, lon: float, limit: int = 8, max_km: float = 200.0) -> list[dict[str, Any]]:
    """Nearest hospitals using an in-memory immutable coordinate set, avoiding a full SQLite scan per request."""
    pts=_load_hospital_points()
    rlat=math.radians(lat); scored=[]
    for hlat,hlon,d in pts:
        dlat=math.radians(hlat-lat); dlon=math.radians(hlon-lon)
        a=math.sin(dlat/2)**2+math.cos(rlat)*math.cos(math.radians(hlat))*math.sin(dlon/2)**2
        km=6371.0*2*math.atan2(math.sqrt(a),math.sqrt(max(0.0,1-a)))
        if km<=max_km: scored.append((km,d))
    scored.sort(key=lambda x:(x[0],_LEVEL_RANK.get(x[1]["level_en"],5)))
    out=[]
    for km,row in scored[:limit]:
        out.append({"id":row["id"],"name":row["name_my"] or row["name_en"],"name_en":row["name_en"],"level":row["level_my"] or row["level_en"],"level_en":row["level_en"],"beds":row["beds"],"region":row["region_en"],"region_my":row["region_my"],"township":row["township_my"] or row["township_en"],"township_en":row["township_en"],"distance_km":round(km,1),"latitude":row.get("lat"),"longitude":row.get("lon"),"confidence":row["confidence"]})
    return out


def search_hospitals(query: str, limit: int = 10) -> list[dict[str, Any]]:
    """Search hospitals by name (Burmese or English) or township."""
    q = f"%{' '.join(query.split())}%"
    conn = _hospitals_connect()
    rows = conn.execute(
        """
        SELECT * FROM hospitals
        WHERE name_my LIKE ? OR name_en LIKE ? OR township_my LIKE ? OR township_en LIKE ?
        ORDER BY length(COALESCE(name_my, name_en)) ASC
        LIMIT ?
        """,
        (q, q, q, q, limit),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "name": row["name_my"] or row["name_en"],
            "name_en": row["name_en"],
            "level": row["level_my"] or row["level_en"],
            "beds": row["beds"],
            "region": row["region_en"],
            "region_my": row["region_my"],
            "township": row["township_my"] or row["township_en"],
            "latitude": row["lat"],
            "longitude": row["lon"],
            "confidence": row["confidence"],
        }
        for row in rows
    ]
