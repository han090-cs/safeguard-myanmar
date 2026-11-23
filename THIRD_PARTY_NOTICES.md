# Third-party data and services

Application code is MIT-licensed (see `LICENSE`). Data and services below keep their own terms.

- **Open-Meteo** (forecast, air quality, geocoding): weather data by Open-Meteo.com, CC BY 4.0. The free API is for non-commercial use; commercial use needs a paid plan. https://open-meteo.com/en/terms
- **ERA5 reanalysis** (climate history): ECMWF/Copernicus data served through Open-Meteo. See Open-Meteo terms above.
- **MIMU** place codes and **MIMU/CDE-Myanmar** public hospitals (2020): CC BY 4.0. https://themimu.info
- **DMH Myanmar** official warnings: https://www.moezala.gov.mm/ (links and attribution retained; check their terms before redistributing bulletins)
- **Google Flood Hub**: only used when API access is configured.
- **WeatherAPI / OpenWeatherMap** (optional fallbacks): subject to each provider's terms and your own key.

## Noto Sans Myanmar (fonts/)
SIL Open Font License 1.1, via @fontsource/noto-sans-myanmar. Bundled so Burmese text renders correctly on every device.

## Leaf photo check in the Lab tab (`vendor/ort/`, `models/leaf/`)

- **ONNX Runtime Web 1.20.1** (Microsoft): MIT licence. Bundled in `vendor/ort/` (the WebAssembly file is stored in four parts).
- **Rice model** (`rice_student_mbv3s.onnx`): a small student distilled from the ixrbhii rice ConvNeXt model (CC-BY-4.0) on photos from the Paddy Doctor dataset (doi 10.21227/hz4v-af08). Credit: ixrbhii; Paddy Doctor authors.
- **Potato and cucurbit model** (`pv_int8.onnx`): int8 export of LourivalGontijo/plantvillage-mobilenetv2 (Apache-2.0), trained on the PlantVillage dataset.
- Provenance, measured numbers and limits are in `models/leaf/MODELS.md`. **The owner should confirm that the training-data licences allow this use before a public launch.**
- The optional AI second look sends the photo to Anthropic using the key the visitor pastes into the Lab (or, only if the owner sets `SG_LEAF_SHARE_SERVER_KEY=1`, the owner's `ANTHROPIC_API_KEY`); Anthropic's terms apply and the cost is the key holder's. Nothing is sent unless a key is in use.

## Agriculture and soil research sources (`data/agri_research/`)

The Farming tab quotes short facts and figures from the sources below, each with its source id and reference date. The app does not
copy or redistribute their datasets, maps or rasters. Each source's own reuse terms apply; the note after each entry is the one
recorded in the research bundle, so check it at the source before reusing anything beyond a cited fact.

| id | publisher | title | reference date | access date | reuse note |
|---|---|---|---|---|---|
| SRC001 | FAO | [FAO GIEWS Country Brief: Myanmar](https://cb.apps.fao.org/country.jsp?code=MMR) | 2026-09-18 | 2026-10-10 | Reuse terms must be checked at source; factual citation and data redistribution are distinct |
| SRC002 | FAO / IIASA | [Global Agro-Ecological Zones (GAEZ) v5](https://www.fao.org/gaez/en) | 2025 | 2026-10-10 | Check portal dataset-specific licence and attribution requirements |
| SRC003 | FAO / IIASA | [GAEZ v4 Data Portal and documentation](https://gaez.fao.org/) | 2021 baseline; portal now points users to v5 | 2026-10-10 | Check dataset-specific terms before redistribution |
| SRC004 | FAO / UNESCO | [FAO/UNESCO Soil Map of the World](https://www.fao.org/soils-portal/data-hub/soil-maps-and-databases/faounesco-soil-map-of-the-world/en/) | 1980s-era map series | 2026-10-10 | Check map/product-specific terms |
| SRC005 | IUSS / FAO Soil Portal | [World Reference Base for Soil Resources](https://www.fao.org/soils-portal/soil-survey/soil-classification/world-reference-base/en) | Current portal; WRB standard | 2026-10-10 | Follow WRB publication/software terms |
| SRC006 | ASEAN / FAOLEX-hosted document | [ASEAN Guidelines on Soil and Nutrient Management (Myanmar soil-map inventory excerpt)](https://faolex.fao.org/docs/pdf/asean214453.pdf) | 2018 document; references Myanmar soil mapping 2004 and 2014–15 | 2026-10-10 | Verify original dataset access and reuse terms; excerpt says some data not published |
| SRC007 | MOALI | [Myanmar Ministry of Agriculture, Livestock and Irrigation (MOALI)](https://www.moali.gov.mm/) | Website; publication date varies | 2026-10-10 | Check each publication's terms |
| SRC008 | DMH | [Myanmar Department of Meteorology and Hydrology (DMH)](https://www.moezala.gov.mm/) | Website; publication date varies | 2026-10-10 | Check site terms and data permissions |
