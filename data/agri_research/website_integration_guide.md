# AgriWeather & Relief — Agriculture & Soil Data Integration Guide

## Important data contract
These files are a **research foundation**, not a complete national statistical database. Empty/unknown values are intentional. Do not turn general regional references into precise local recommendations. Keep each record's `data_quality`, `source_ids`, geography, date/reference period, units, and method.

## Recommended architecture
1. Keep the CSV files as versioned source data in the repository (or import them into a database).
2. Convert CSV to JSON during build/deployment, or ingest with a backend ETL job.
3. Keep source metadata in `myanmar_agriculture_soil_sources.csv`; join records through `source_ids`.
4. Add a stable `record_id`; do not use row number as an ID.
5. Add a data update timestamp and dataset version in your API response.
6. Never present a modelled suitability map as a field measurement.

## Suggested API endpoints
- `GET /api/agriculture/crops?region=Central%20Dry%20Zone`
- `GET /api/agriculture/crops?crop_type=Oilseed&season=Rainy`
- `GET /api/soil/profiles?region=Ayeyarwady%20Delta`
- `GET /api/regions`
- `GET /api/sources?source_id=SRC002`

## Browser-side JSON filtering
```js
const [crops, regions, soils] = await Promise.all([
  fetch('/data/myanmar_agriculture_crops.json').then(r => r.json()),
  fetch('/data/myanmar_agricultural_regions.json').then(r => r.json()),
  fetch('/data/myanmar_soil_agroecology.json').then(r => r.json())
]);

const selectedRegion = 'Central Dry Zone';
const regionCrops = crops.filter(row => row.region_or_zone === selectedRegion);
const oilseeds = crops.filter(row => row.crop_type.toLowerCase().includes('oilseed'));
const verifiedOnly = crops.filter(row =>
  ['Verified measurement', 'Official statistics', 'Peer-reviewed research'].includes(row.data_quality)
);
```

## Data model recommendations
- `region_id`: stable region key; maintain a separate region crosswalk for administrative units.
- `region_type`: administrative region/state, production region, AEZ, or system overlay. Never conflate these.
- Soil observations should have `sample_id`, coordinates (if safe to publish), sampling date, depth, method, lab, units, and analytical basis (e.g. available vs total nutrient).
- Modelled layers should have `model_name`, version, resolution, scenario, reference period, and original download URL.
- Numeric fields should be numeric in production schemas and carry explicit units in adjacent fields.
- Store missingness as null/empty plus a `missing_reason`; do not use zero to mean unknown.
- Keep pH, EC/salinity, organic carbon, organic matter, total nutrients and plant-available nutrients as separate fields.

## Suggested display rules
- Show a visible evidence badge (Official statistics / Peer-reviewed / Modelled / General reference).
- Display the data year or reference period beside any production or yield number.
- Use “regional context” labels for broad soil descriptions.
- Avoid displaying crop suitability as a guarantee. Add a local-extension confirmation note.
- Do not publish exact coordinates for sensitive/private farm samples without permission.

## Current limitations
The source inventory identifies useful authoritative sources, but the files do not yet contain a full extraction of GAEZ raster cells, official state/region crop statistics, or the underlying Myanmar soil-profile laboratory table. Obtain and validate those source datasets before claiming complete geographic coverage.
