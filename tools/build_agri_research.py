"""Build data/agri_research.json from the research-bundle CSVs (data/agri_research/) plus the Burmese overlay.

Rules (from the bundle's own data contract):
- unknown stays unknown: "Unknown ..." -> null + unknown=true; "Not specified/supplied" -> null + not_specified=true
- every record keeps data_quality and source_ids; nothing is inferred or filled in
- rows whose columns are shifted are repaired explicitly and logged under "repairs"
Run:  python tools/build_agri_research.py
"""
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "agri_research"
OUT = ROOT / "data" / "agri_research.json"
MY = json.loads((ROOT / "data" / "agri_research_my.json").read_text(encoding="utf-8"))
SRC_ID = re.compile(r"^SRC\d{3}(;\s*SRC\d{3})*$")

# Existing calendars in data/agri.json were written for four broad zones. Only these exact/containing matches are used.
CALENDAR_ZONE = {"R01": "dry", "R02": "delta", "R03": "coastal", "R04": "hills", "R05": "hills", "R06": "hills"}
BROAD_ZONE = {"R04", "R05", "R06"}  # the 'hills' calendar is a coarser grouping than these regions


REPAIRS = []


def rows(name):
    with open(SRC / name, encoding="utf-8-sig", newline="") as f:
        data = list(csv.reader(f))
    head, out = data[0], []
    for cells in data[1:]:
        cells = [c.strip() for c in cells]
        if len(cells) == len(head) + 1 and name.endswith("crops.csv"):
            # C005/C006: one stray duplicate "Not specified" cell right before area_production_yield shifts every later column
            i = head.index("area_production_yield")
            assert cells[i] == cells[i - 1] == "Not specified", (cells[0], cells[i - 1 : i + 1])
            del cells[i]
            REPAIRS.append({"record_id": cells[0], "issue": "row has one extra cell in the source CSV (duplicate 'Not specified' before area_production_yield), shifting area_production_yield, data_quality and source_ids",
                            "fix": "the duplicate cell was removed; no values were changed"})
        assert len(cells) == len(head), (name, cells[0], len(cells))
        out.append(dict(zip(head, cells)))
    return out


def ids(s):
    return [x.strip() for x in s.split(";") if x.strip()]


def val(s):
    if not s:
        return {"en": None, "state": "empty"}
    if s.startswith("Unknown"):
        return {"en": None, "state": "unknown"}
    if s.startswith(("Not specified", "Not supplied", "Not applicable", "No figure", "No regional figure")):
        return {"en": None, "state": "not_specified"}
    return {"en": s, "state": "value"}


def quality_class(q):
    q = q.lower()
    if q.startswith("general"):
        return "general"
    if "insufficient" in q:
        return "insufficient"
    if "modelled" in q or "mapped" in q:
        return "modelled"
    if "inventory" in q:
        return "inventory"
    return "official" if "official" in q else "general"


def main():
    sources = {r["source_id"]: {k: v for k, v in r.items() if k != "source_id"} for r in rows("myanmar_agriculture_soil_sources.csv")}
    regions_raw = rows("myanmar_agricultural_regions.csv")
    by_name = {r["region_name"]: r["region_id"] for r in regions_raw}

    regions = []
    for r in regions_raw:
        t = MY["regions"][r["region_id"]]
        regions.append({
            "id": r["region_id"], "name_en": r["region_name"], "name_my": t["name"], "type_en": r["region_type"],
            "scope_en": r["geographic_scope"], "scope_my": t["scope"],
            "climate_en": r["climate_context"], "climate_my": t["climate"],
            "main_crops_en": r["main_crops"], "main_crops_my": t["main_crops"],
            "constraints_en": r["key_constraints"], "constraints_my": t["constraints"],
            "evidence_en": r["evidence_note"], "evidence_my": t["evidence"],
            "source_ids": ids(r["source_ids"]),
            "calendar_zone": CALENDAR_ZONE.get(r["region_id"]), "calendar_broad": r["region_id"] in BROAD_ZONE,
        })

    FIELDS = [("season", "season_classification"), ("sowing", "approx_sowing_period"), ("harvest", "approx_harvest_period"),
              ("irrigation", "rainfed_or_irrigated"), ("water", "water_and_drainage"), ("soil", "soil_requirements"),
              ("constraints", "constraints_and_sensitivity"), ("management", "management_notes"), ("yield", "area_production_yield")]
    crops = []
    for r in rows("myanmar_agriculture_crops.csv"):
        rid = r["record_id"]
        assert SRC_ID.match(r["source_ids"]), (rid, r["source_ids"])
        t = MY["crops"][rid]
        fields = {}
        for key, col in FIELDS:
            v = val(r[col])
            v["my"] = t.get(key) if v["state"] == "value" else None
            if v["state"] == "value":
                assert v["my"], f"missing Burmese text for {rid}.{key}"
            fields[key] = v
        crops.append({
            "id": rid, "region_name": r["region_or_zone"], "region_id": by_name.get(r["region_or_zone"]),
            "scope": "region" if r["region_or_zone"] in by_name else "national",
            "crop_en": r["crop_common_name"], "crop_my": t["crop"], "scientific_name": r["scientific_name"] or None,
            "type_en": r["crop_type"], "type_my": t["type"], "fields": fields,
            "quality_en": r["data_quality"], "quality_my": t["quality"], "quality_class": quality_class(r["data_quality"]),
            "source_ids": ids(r["source_ids"]),
        })

    soils = []
    for r in rows("myanmar_soil_agroecology.csv"):
        t = MY["soils"][r["record_id"]]
        soils.append({
            "id": r["record_id"], "coverage_en": r["geographic_coverage"], "type_en": r["record_type"],
            "title_my": t["title"], "text_my": t["text"], "classification_en": r["classification_system"],
            "detail_en": r["sampling_depth_or_resolution"], "quality_en": r["data_quality"], "quality_my": t["quality"],
            "quality_class": quality_class(r["data_quality"]), "source_ids": ids(r["source_ids"]),
            "has_measured_values": False,
        })

    data = {
        "dataset_version": max(s["access_date"] for s in sources.values()),
        "note_en": "Research foundation, not a complete national database. Unknown values are intentional and are shown as unknown.",
        "note_my": "ဒါက သုတေသန အခြေခံဒေတာပါ၊ နိုင်ငံတစ်ခုလုံးရဲ့ ပြည့်စုံတဲ့ ဒေတာဘေ့စ် မဟုတ်ပါဘူး။ မသိရသေးတာတွေကို မသိရသေးဘူးလို့ပဲ ပြထားပါတယ်။",
        "sources": sources, "regions": regions, "crops": crops, "soils": soils, "repairs": REPAIRS,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(regions)} regions, {len(crops)} crops, {len(soils)} soil records, {len(REPAIRS)} repairs")


if __name__ == "__main__":
    main()
