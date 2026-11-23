"""Rebuild data/history.json (the Compare tab's "Long term" view) from ERA5, the same dataset the "Now" and
"This year" views use, instead of the modelled CSV that tools/build_history.py read.

    python tools/prewarm_baseline.py --regions      # optional, do it first: stores 1991-2020 for the 15 region centres,
                                                    # which this script then reuses (saves ~780 of ~1100 request units each)
    python tools/build_history_era5.py              # fetch what is missing (resumable), then write data/history.json
    python tools/build_history_era5.py --build-only # no downloads: build from what is already on disk
    python tools/build_history_era5.py --dry-run    # build and print, do not write
    python tools/build_history_era5.py --loop       # keep going by itself: wait an hour whenever a limit is reached
    python tools/build_history_era5.py --oni oni.ascii.txt   # NOAA ONI file for the El Nino / La Nina classes

What it does
- Downloads daily max/min temperature and rain (Open-Meteo archive API, model "era5", Myanmar time) for the 15
  state/region centres in the existing data/history.json, 1985 to about a week ago, in chunks of at most 10 years.
  Every chunk is stored in tools/.era5_history_cache/, so an interrupted or rate-limited run continues where it stopped.
- Monthly mean temperature is (daily max + daily min) / 2 and monthly rain is the sum of the days, exactly as the
  Compare tab's "Now" / "This year" views compute it. A month counts only when every day of it is present.
- Writes the same file format as before: yearly temperature and rain for full years, the 1991-2020 month-by-month
  normals (now from ERA5, so they match the live views), the temperature trend with a 95% bootstrap interval, June-September
  rain by El Nino / La Nina / neutral years with a permutation test, and the disaster list (kept as it is).
- Also stores each region's 1991-2020 daily data in risk_engine/data/cache/baseline/ (the file the app's own "compared
  with normal" views read), so those views need no 30-year download for the 15 region centres. Commit those files too.
- Refuses to overwrite data/history.json when the result looks wrong (missing years, impossible values).

Open-Meteo's free API allows 600 / 5,000 / 10,000 request units per minute / hour / day, and counts a request as
(days / 14) units. One region for 1985-today is ~1,100 units, so all 15 take about two days. The script pauses between
requests, stops before --max-weight units (default 4,000 per run, under the hourly limit) or at the first HTTP 429, and
tells you when to run it again. It never writes a half-finished history.json.

ENSO classes: each year is El Nino / La Nina / neutral by the majority of the four 3-month ONI seasons centred on
June-September (anomaly >= +0.5 / <= -0.5), from NOAA CPC's oni.ascii.txt. If that file cannot be fetched, the classes
already in data/history.json are kept (and the build stops if a year has none).
"""
from __future__ import annotations

import argparse
import calendar
import gzip
import json
import math
import os
import random
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional

import httpx

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from risk_engine.baseline import ARCHIVE_URL, CACHE_DIR as NORMALS_DIR, VARS, point_key  # noqa: E402

FIRST_YEAR = 1985
NORMAL = (1991, 2020)
ERA5_LAG_DAYS = 6                    # ERA5 trails real time by about five days
CACHE_DIR = ROOT / "tools" / ".era5_history_cache"
HISTORY = ROOT / "data" / "history.json"
ONI_URL = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
SEASONS = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"]
JJAS_SEASON_INDEX = (5, 6, 7, 8)     # MJJ, JJA, JAS, ASO are centred on June, July, August, September
UNITS_PER_REQUEST_LIMIT = 4000.0
MIN_YEARS = 38


class RateLimited(Exception):
    pass


# ------------------------------------------------------------------------------------------------ planning and weights
Chunk = tuple[date, date, bool]      # (first day, last day, may be cached for good)


def plan_chunks(today: date) -> list[Chunk]:
    end = today - timedelta(days=ERA5_LAG_DAYS)
    chunks: list[Chunk] = [(date(FIRST_YEAR, 1, 1), date(1990, 12, 31), True)]
    chunks += [(date(y, 1, 1), date(y + 9, 12, 31), True) for y in (1991, 2001, 2011)]
    y = 2021
    while y < end.year:
        chunks.append((date(y, 1, 1), date(min(y + 4, end.year - 1), 12, 31), True))
        y += 5
    chunks.append((date(end.year, 1, 1), end, False))       # the running year changes every day: never cached
    return chunks


def units(start: date, end: date) -> float:
    """Open-Meteo counts a request of more than 2 weeks for one place as (days / 14) calls (3 variables is under the 10 limit)."""
    return max(1.0, ((end - start).days + 1) / 14)


def chunk_path(cache_dir: Path, key: tuple[float, float], start: date, end: date) -> Path:
    return cache_dir / f"{key[0]:.2f}_{key[1]:.2f}" / f"{start.isoformat()}_{end.isoformat()}.json.gz"


# ------------------------------------------------------------------------------------------------------------ download
def _daily_ok(payload: dict, start: date, end: date) -> bool:
    d = payload.get("daily") or {}
    n = (end - start).days + 1
    return (all(isinstance(d.get(k), list) and len(d[k]) == n for k in ("time", "temperature_2m_max", "temperature_2m_min", "precipitation_sum"))
            and d["time"][0] == start.isoformat())


def fetch_chunk(client: httpx.Client, key: tuple[float, float], start: date, end: date, sleep: Callable[[float], None] = time.sleep) -> dict:
    last: Optional[Exception] = None
    for attempt in range(3):
        try:
            r = client.get(ARCHIVE_URL, params={"latitude": key[0], "longitude": key[1], "start_date": start.isoformat(),
                                                "end_date": end.isoformat(), "daily": VARS, "timezone": "Asia/Yangon", "models": "era5"})
            if r.status_code == 429:
                try:
                    reason = r.json().get("reason", "")
                except ValueError:
                    reason = ""
                raise RateLimited(reason or "HTTP 429")
            if r.status_code in (500, 502, 503, 504):
                raise httpx.HTTPStatusError(f"transient {r.status_code}", request=r.request, response=r)
            r.raise_for_status()
            payload = r.json()
            if not _daily_ok(payload, start, end):
                raise ValueError("unexpected response shape")
            return {"elevation": payload.get("elevation"), "daily": payload["daily"]}
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            last = exc
            sleep(5 * (2 ** attempt))
    raise last  # type: ignore[misc]


def _read_gz(path: Path) -> Optional[dict]:
    try:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _write_gz(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
    os.replace(tmp, path)


def normals_file(normals_dir: Path, key: tuple[float, float]) -> Path:
    return normals_dir / f"era5_{key[0]:.2f}_{key[1]:.2f}_{NORMAL[0]}_{NORMAL[1]}.json.gz"


def within_normals(start: date, end: date) -> bool:
    return start.year >= NORMAL[0] and end.year <= NORMAL[1]


def slice_payload(payload: dict, start: date, end: date) -> Optional[dict]:
    """The part of a stored daily payload between start and end (inclusive), or None when it does not cover it."""
    d = payload.get("daily") or {}
    times = d.get("time") or []
    try:
        i, j = times.index(start.isoformat()), times.index(end.isoformat())
    except ValueError:
        return None
    return {"daily": {k: d[k][i:j + 1] for k in ("time", "temperature_2m_max", "temperature_2m_min", "precipitation_sum")}}


def load_chunk(cache_dir: Path, normals_dir: Path, key: tuple[float, float], chunk: Chunk) -> Optional[dict]:
    start, end, _ = chunk
    if within_normals(start, end):
        stored = _read_gz(normals_file(normals_dir, key))
        part = slice_payload(stored, start, end) if stored else None
        if part:
            return part
    return _read_gz(chunk_path(cache_dir, key, start, end))


def store_normals(points: dict[str, tuple[float, float]], cache_dir: Path, normals_dir: Path, chunks: list[Chunk],
                  say: Callable[[str], None] = print) -> int:
    """Join the three 1991-2020 chunks of each region into the file the app's BaselineStore reads (if it is not there)."""
    from risk_engine.baseline import SOURCE
    made = 0
    for rid, key in points.items():
        target = normals_file(normals_dir, key)
        if target.exists():
            continue
        parts = [_read_gz(chunk_path(cache_dir, key, c[0], c[1])) for c in chunks if within_normals(c[0], c[1])]
        if not parts or any(p is None for p in parts):
            continue
        daily = {k: [v for p in parts for v in p["daily"][k]] for k in ("time", "temperature_2m_max", "temperature_2m_min", "precipitation_sum")}
        if daily["time"][0] != f"{NORMAL[0]}-01-01" or daily["time"][-1] != f"{NORMAL[1]}-12-31":
            continue
        _write_gz(target, {"elevation": parts[0].get("elevation"), "daily": daily, "source": SOURCE})
        made += 1
    if made:
        say(f"stored 1991-2020 normals for {made} region centre(s) in {normals_dir}")
    return made


def fetch_missing(points: dict[str, tuple[float, float]], chunks: list[Chunk], cache_dir: Path, normals_dir: Path,
                  client: httpx.Client, max_units: float = UNITS_PER_REQUEST_LIMIT, pause: Optional[float] = None,
                  sleep: Callable[[float], None] = time.sleep, say: Callable[[str], None] = print) -> tuple[int, int, Optional[str]]:
    """Download every chunk that is not on disk. -> (downloaded, still missing, reason it stopped or None)."""
    todo = []
    for rid, key in points.items():
        for ch in chunks:
            if ch[2] and load_chunk(cache_dir, normals_dir, key, ch) is not None:
                continue
            todo.append((rid, key, ch))
    total, spent, done = len(todo), 0.0, 0
    say(f"{total} download(s) needed")
    for rid, key, (start, end, keep) in todo:
        w = units(start, end)
        if spent + w > max_units:
            return done, total - done, f"budget: {spent:.0f} of {max_units:.0f} request units used this run"
        try:
            payload = fetch_chunk(client, key, start, end, sleep)
        except RateLimited as exc:
            return done, total - done, f"Open-Meteo says: {exc}"
        spent += w
        done += 1
        path = chunk_path(cache_dir, key, start, end)
        _write_gz(path, payload)
        if not keep:                                                      # the running year: only the newest copy is kept
            for old in path.parent.glob(f"{start.isoformat()}_*.json.gz"):
                if old != path:
                    old.unlink(missing_ok=True)
        say(f"  {rid} {start}..{end}  ({w:.0f} units, {done}/{total})")
        sleep(pause if pause is not None else w * 0.1 + 1.0)             # 600 units/minute = 10 per second
    return done, 0, None


# ------------------------------------------------------------------------------------------------------- aggregation
def daily_series(payloads: list[dict]) -> dict[date, tuple[Optional[float], Optional[float], Optional[float]]]:
    out = {}
    for p in payloads:
        d = p["daily"]
        for t, hi, lo, pr in zip(d["time"], d["temperature_2m_max"], d["temperature_2m_min"], d["precipitation_sum"]):
            out[date.fromisoformat(t)] = (hi, lo, pr)
    return out


def monthly(series: dict) -> dict[tuple[int, int], dict]:
    """(year, month) -> {"t": mean of (max+min)/2, "p": rain total, "ok": every day present}."""
    acc: dict[tuple[int, int], list] = {}
    for d, (hi, lo, pr) in series.items():
        a = acc.setdefault((d.year, d.month), [0.0, 0.0, 0, 0])
        a[3] += 1
        if hi is not None and lo is not None and pr is not None:
            a[0] += (hi + lo) / 2
            a[1] += pr
            a[2] += 1
    return {k: {"t": a[0] / a[2] if a[2] else None, "p": a[1], "ok": a[2] == a[3] == calendar.monthrange(*k)[1]} for k, a in acc.items()}


def mean(v) -> float:
    v = list(v)
    return sum(v) / len(v)


def slope(xs: list[float], ys: list[float]) -> Optional[float]:
    mx, my = mean(xs), mean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx if sxx else None


def trend_ci(xs: list[float], ys: list[float], rng: random.Random, n: int) -> list[float]:
    """95% bootstrap interval of the slope per decade."""
    vals = []
    for _ in range(n):
        idx = [rng.randrange(len(xs)) for _ in xs]
        s = slope([xs[i] for i in idx], [ys[i] for i in idx])
        if s is not None:
            vals.append(s * 10)
    vals.sort()
    return [round(vals[int(0.025 * (len(vals) - 1))], 2), round(vals[int(math.ceil(0.975 * (len(vals) - 1)))], 2)]


def perm_p(a: list[float], b: list[float], rng: random.Random, n: int) -> Optional[float]:
    """Two-sided permutation p-value for the difference of means."""
    if len(a) < 3 or len(b) < 3:
        return None
    diff, pool, k = mean(a) - mean(b), a + b, len(a)
    hits = 0
    for _ in range(n):
        rng.shuffle(pool)
        if abs(mean(pool[:k]) - mean(pool[k:])) >= abs(diff) - 1e-12:
            hits += 1
    return round((hits + 1) / (n + 1), 3)


# ------------------------------------------------------------------------------------------------------------ ENSO
def phase(anom: float) -> str:
    return "el_nino" if anom >= 0.5 else "la_nina" if anom <= -0.5 else "neutral"


def majority(items: list[str]) -> str:
    counts = {k: items.count(k) for k in set(items)}
    top = max(counts.values())
    best = [k for k, v in counts.items() if v == top]
    return best[0] if len(best) == 1 else "mixed"


def parse_oni(text: str) -> dict[int, str]:
    """NOAA CPC oni.ascii.txt ("SEAS YR TOTAL ANOM" per line) -> {year: class by the June-September seasons}."""
    rows: dict[tuple[int, int], float] = {}
    for line in text.splitlines():
        p = line.split()
        if len(p) >= 4 and p[0] in SEASONS and p[1].isdigit():
            try:
                rows[(SEASONS.index(p[0]), int(p[1]))] = float(p[3])
            except ValueError:
                continue
    out = {}
    for y in sorted({y for _, y in rows}):
        vals = [rows.get((i, y)) for i in JJAS_SEASON_INDEX]
        if None not in vals:
            out[y] = majority([phase(v) for v in vals])      # type: ignore[arg-type]
    return out


def load_oni(source: Optional[str], client: httpx.Client) -> Optional[dict[int, str]]:
    try:
        if source and not source.startswith(("http://", "https://")):
            return parse_oni(Path(source).read_text(encoding="utf-8")) or None
        r = client.get(source or ONI_URL)
        r.raise_for_status()
        return parse_oni(r.text) or None
    except (OSError, httpx.HTTPError):
        return None


# -------------------------------------------------------------------------------------------------------------- build
def build(old: dict, series_by_region: dict[str, dict], enso: dict[int, str], today: date, perm_n: int = 5000,
          boot_n: int = 2000, seed: int = 42) -> dict:
    rng = random.Random(seed)
    monthly_by = {rid: monthly(s) for rid, s in series_by_region.items()}
    full_sets = [{y for y in range(FIRST_YEAR, today.year + 1) if all(m.get((y, mm), {}).get("ok") for mm in range(1, 13))}
                 for m in monthly_by.values()]
    full = set.intersection(*full_sets)
    years = sorted(full)
    if not years or years[0] != FIRST_YEAR or years != list(range(years[0], years[-1] + 1)) or len(years) < MIN_YEARS:
        raise ValueError(f"full years are missing: have {years[:3]}..{years[-3:]}, need {FIRST_YEAR}..last year without gaps")
    last_ok = max(k for m in monthly_by.values() for k, v in m.items() if v["ok"] and all(mm.get(k, {}).get("ok") for mm in monthly_by.values()))
    missing_enso = [y for y in years if y not in enso]
    if missing_enso:
        raise ValueError(f"no El Nino / La Nina class for {missing_enso}; pass --oni with NOAA's oni.ascii.txt")
    regions = {}
    for rid, old_r in old["regions"].items():
        m = monthly_by[rid]
        temp = [round(mean(m[(y, mm)]["t"] for mm in range(1, 13)), 2) for y in years]
        rain = [round(sum(m[(y, mm)]["p"] for mm in range(1, 13))) for y in years]
        slope_dec = slope([float(y) for y in years], temp)
        ci = trend_ci([float(y) for y in years], temp, rng, boot_n)
        base_years = [y for y in years if NORMAL[0] <= y <= NORMAL[1]]
        clim_t = [round(mean(m[(y, mm)]["t"] for y in base_years), 1) for mm in range(1, 13)]
        clim_p = [round(mean(m[(y, mm)]["p"] for y in base_years)) for mm in range(1, 13)]
        jj = {y: sum(m[(y, mm)]["p"] for mm in (6, 7, 8, 9)) for y in years}
        by = {k: [jj[y] for y in years if enso[y] == k] for k in ("el_nino", "la_nina", "neutral")}
        jbe = {k: {"mean_mm": round(mean(v)), "years": len(v)} for k, v in by.items() if v}
        cmp_ = {}
        if len(by["neutral"]) >= 3:
            for k in ("el_nino", "la_nina"):
                if len(by[k]) >= 3:
                    cmp_[k] = {"pct": round((mean(by[k]) / mean(by["neutral"]) - 1) * 100), "p": perm_p(by[k], by["neutral"], rng, perm_n)}
        regions[rid] = {
            "en": old_r["en"], "my": old_r["my"], "zone": old_r["zone"], "lat": old_r["lat"], "lon": old_r["lon"],
            "years": years, "temp": temp, "rain": rain,
            "temp_trend_per_decade": round(slope_dec * 10, 2), "temp_trend_ci95": ci,
            "clim_temp": clim_t, "clim_rain": clim_p, "jjas_by_enso": jbe, "enso_vs_neutral": cmp_,
            "enso_by_year": {y: enso[y] for y in years},
        }
    return {
        "generated": today.isoformat(), "last_full_year": years[-1], "last_month": f"{last_ok[0]}-{last_ok[1]:02d}",
        "kind": "modelled",
        "source": "ERA5 reanalysis (ECMWF/Copernicus) via Open-Meteo, daily max/min temperature and rain at the state/region centre (modelled, not station observations)",
        "baseline": "1991-2020",
        "enso_basis": f"Jun-Sep majority phase of each year (NOAA ONI +/-0.5); permutation test {perm_n}x, bootstrap CI {boot_n}x",
        "regions": regions, "events": old["events"],
    }


def check(doc: dict, regions_expected: int = 15) -> None:
    """Refuse a result that cannot be right, so a bad download never replaces a good file."""
    if len(doc["regions"]) != regions_expected:
        raise ValueError(f"expected {regions_expected} regions, got {len(doc['regions'])}")
    for rid, r in doc["regions"].items():
        n = len(r["years"])
        if n < MIN_YEARS or len(r["temp"]) != n or len(r["rain"]) != n:
            raise ValueError(f"{rid}: wrong number of years")
        if not all(10 <= t <= 35 for t in r["temp"]) or not all(100 <= p <= 8000 for p in r["rain"]):
            raise ValueError(f"{rid}: yearly values outside what is possible for Myanmar")
        if len(r["clim_temp"]) != 12 or len(r["clim_rain"]) != 12 or not r["jjas_by_enso"]:
            raise ValueError(f"{rid}: normals or June-September groups missing")


def summary(old: dict, new: dict) -> list[str]:
    out = []
    for rid, r in new["regions"].items():
        o = old["regions"].get(rid, {})
        out.append(f"{rid} {r['en'][:22]:22} trend {o.get('temp_trend_per_decade', '?')} -> {r['temp_trend_per_decade']} C/decade"
                   f" | latest year {r['years'][-1]}: {r['temp'][-1]} C, {r['rain'][-1]} mm")
    return out


# ----------------------------------------------------------------------------------------------------------------- CLI
def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--build-only", action="store_true", help="no downloads; build from the files already on disk")
    ap.add_argument("--dry-run", action="store_true", help="build and print, but do not write data/history.json")
    ap.add_argument("--oni", help="NOAA oni.ascii.txt (file or URL); default downloads it from NOAA CPC")
    ap.add_argument("--max-weight", type=float, default=UNITS_PER_REQUEST_LIMIT, help="request units to use in this run (default 4000)")
    ap.add_argument("--pause", type=float, help="seconds between requests (default: 1 s + 0.1 s per request unit)")
    ap.add_argument("--cache-dir", type=Path, default=CACHE_DIR)
    ap.add_argument("--normals-dir", type=Path, default=NORMALS_DIR)
    ap.add_argument("--history", type=Path, default=HISTORY)
    ap.add_argument("--loop", action="store_true", help="when a limit is reached, wait and carry on until everything is downloaded")
    ap.add_argument("--wait-seconds", type=float, default=3720, help=argparse.SUPPRESS)
    ap.add_argument("--perm", type=int, default=5000)
    ap.add_argument("--boot", type=int, default=2000)
    args = ap.parse_args(argv)

    old = json.loads(args.history.read_text(encoding="utf-8"))
    points = {rid: point_key(r["lat"], r["lon"]) for rid, r in old["regions"].items()}
    today = datetime.now(timezone.utc).date()
    chunks = plan_chunks(today)
    with httpx.Client(timeout=120, headers={"User-Agent": "myanmar-weather-history/1.0"}, follow_redirects=True) as client:
        if not args.build_only:
            n_cached = sum(normals_file(args.normals_dir, k).exists() for k in points.values())
            print(f"1991-2020 already on disk for {n_cached} of {len(points)} regions (tools/prewarm_baseline.py --regions stores the rest)")
            while True:
                done, left, why = fetch_missing(points, chunks, args.cache_dir, args.normals_dir, client, args.max_weight, args.pause)
                if not why:
                    break
                if not args.loop:
                    print(f"\nStopped: {why}.\n{left} download(s) left; {done} done and kept. Run the same command again later "
                          "(in about an hour for the hourly limit, tomorrow for the daily limit), or add --loop to let it wait by "
                          "itself. Nothing was written to data/history.json.")
                    return 2
                print(f"\n{why}. {left} left; waiting {args.wait_seconds / 60:.0f} minutes, then continuing (Ctrl+C to stop; progress is kept).")
                time.sleep(args.wait_seconds)
            store_normals(points, args.cache_dir, args.normals_dir, chunks)
        enso = load_oni(args.oni, client)
    if enso is None:
        print("NOAA ONI not available; keeping the El Nino / La Nina classes already in data/history.json")
        first = next(iter(old["regions"].values()))
        enso = {int(y): c for y, c in first["enso_by_year"].items()}
    series = {}
    for rid, key in points.items():
        parts = [(ch, load_chunk(args.cache_dir, args.normals_dir, key, ch)) for ch in chunks]
        if any(p is None and ch[2] for ch, p in parts):        # the running year is optional (it only sets "last month")
            print(f"{rid}: some chunks are not on disk yet; run without --build-only")
            return 2
        series[rid] = daily_series([p for _, p in parts if p is not None])
    try:
        new = build(old, series, enso, today, args.perm, args.boot)
        check(new, len(old["regions"]))
    except ValueError as exc:
        print(f"Not written: {exc}")
        return 1
    print("\n".join(summary(old, new)))
    print(f"last full year {new['last_full_year']}, last complete month {new['last_month']}")
    if args.dry_run:
        print("--dry-run: nothing written")
        return 0
    args.history.write_text(json.dumps(new, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"written {args.history} ({args.history.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
