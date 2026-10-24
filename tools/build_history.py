"""Build data/history.json from the modelled 1985-2026 climate CSV + the disaster list.
Usage: python tools/build_history.py <climate.csv> <disasters.csv>
The CSV is modelled (World Bank CKP / Meteoblue simulation), NOT station observation; the output says so.
Future months (after today) are dropped."""
import ast, json, sys
from datetime import date
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
clim_csv, dis_csv = sys.argv[1], sys.argv[2]
d = pd.read_csv(clim_csv)
today = date.today()
d = d[(d.Year < today.year) | ((d.Year == today.year) & (d.Month < today.month))]
last_full = int(d.groupby("Year").Month.nunique().loc[lambda s: s == 12].index.max())

def phase(p):
    p = str(p)
    e, l = "El Ni" in p, "La Ni" in p
    return "mixed" if e and l else "el_nino" if e else "la_nina" if l else "neutral" if p.startswith("Neutral") else "mixed"

d["grp"] = d.ENSO_Phase.map(phase)
# ENSO class of each year = most common class during the monsoon months (Jun-Sep), not the whole-year label
jj_rows = d[d.Month.isin([6, 7, 8, 9])]
year_grp = jj_rows.groupby("Year").grp.agg(lambda s: s.value_counts().index[0])
full = d[d.Year <= last_full]
rng = np.random.default_rng(42)


def perm_p(a, b, n=5000):
    """two-sided permutation p-value for the difference of means (a vs b)"""
    if len(a) < 3 or len(b) < 3:
        return None
    diff, pool, k = a.mean() - b.mean(), np.r_[a, b], len(a)
    hits = sum(abs((lambda x: x[:k].mean() - x[k:].mean())(rng.permutation(pool))) >= abs(diff) for _ in range(n))
    return round((hits + 1) / (n + 1), 3)


regions = {}
for rid, g in d.groupby("Region_ID"):
    f = full[full.Region_ID == rid]
    ann = f.groupby("Year").agg(t=("Avg_Temperature_C", "mean"), p=("Total_Precipitation_mm", "sum"))
    yrs, tv = ann.index.values.astype(float), ann.t.values
    slope = float(np.polyfit(yrs, tv, 1)[0] * 10)
    boots = [np.polyfit(yrs[i], tv[i], 1)[0] * 10 for i in (rng.integers(0, len(tv), len(tv)) for _ in range(2000))]
    ci = [round(float(x), 2) for x in np.percentile(boots, [2.5, 97.5])]
    base = f[(f.Year >= 1991) & (f.Year <= 2020)].groupby("Month").agg(t=("Avg_Temperature_C", "mean"), p=("Total_Precipitation_mm", "mean"))
    jj = f[f.Month.isin([6, 7, 8, 9])].groupby("Year").Total_Precipitation_mm.sum()
    yg = year_grp.reindex(jj.index)
    by = {k: jj[yg == k].values for k in ("el_nino", "la_nina", "neutral")}
    jbe = {k: {"mean_mm": round(float(v.mean())), "years": int(len(v))} for k, v in by.items() if len(v)}
    cmp_ = {}
    if len(by["neutral"]) >= 3:
        for k in ("el_nino", "la_nina"):
            if len(by[k]) >= 3:
                cmp_[k] = {"pct": round(float(by[k].mean() / by["neutral"].mean() - 1) * 100), "p": perm_p(by[k], by["neutral"])}
    r = g.iloc[0]
    regions[rid] = {
        "en": r.Region_EN, "my": r.Region_MM, "zone": r.Climatic_Zone, "lat": float(r.Latitude), "lon": float(r.Longitude),
        "years": [int(y) for y in ann.index], "temp": [round(v, 2) for v in ann.t], "rain": [round(v) for v in ann.p],
        "temp_trend_per_decade": round(slope, 2), "temp_trend_ci95": ci,
        "clim_temp": [round(v, 1) for v in base.t], "clim_rain": [round(v) for v in base.p],
        "jjas_by_enso": jbe, "enso_vs_neutral": cmp_,
        "enso_by_year": {int(y): str(k) for y, k in yg.items()},
    }

ev = pd.read_csv(dis_csv)
events = [{"year": int(r.year), "month": int(r.month), "name": r.disaster_name, "type": r.type,
           "regions": ast.literal_eval(r.affected_regions), "severity": r.severity, "note": r.notes, "source": "dataset"}
          for r in ev.itertuples()]
# verified additions (not in the supplied CSV): ReliefWeb/ECHO, ACAPS, Wikipedia (Mw 7.7, 28 Mar 2025, Sagaing Fault)
events.append({"year": 2025, "month": 3, "name": "Sagaing Fault Earthquake (Mw 7.7)", "type": "Earthquake",
               "regions": ["MM-01", "MM-04", "MM-18", "MM-03", "MM-02"], "severity": "Catastrophic",
               "note": "28 Mar 2025, epicentre ~16 km NNW of Sagaing city; heavy damage around Mandalay and Nay Pyi Taw.",
               "source": "added: ReliefWeb/ECHO, ACAPS"})
events.sort(key=lambda e: (e["year"], e["month"]))

out = {"generated": today.isoformat(), "last_full_year": last_full, "last_month": f"{int(d.Year.max())}-{int(d[d.Year == d.Year.max()].Month.max()):02d}",
       "kind": "modelled", "source": "World Bank Climate Knowledge Portal / Meteoblue simulation (modelled, not station observations)",
       "baseline": "1991-2020", "enso_basis": "Jun-Sep majority phase of each year; permutation test 5000x, bootstrap CI 2000x", "regions": regions, "events": events}
(ROOT / "data" / "history.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("regions", len(regions), "events", len(events), "last_full", last_full, "size", (ROOT / "data" / "history.json").stat().st_size)
