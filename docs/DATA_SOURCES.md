# Data sources and provenance

| Data | Primary path | Failure behavior |
|---|---|---|
| Myanmar place search | bundled MIMU gazetteer | local search continues without network |
| Weather forecast | **RIMES (when authorised endpoint is configured)** → Open-Meteo → WeatherAPI → OpenWeatherMap (the last two need an API key) | provider failures are recorded; the app never averages incompatible provider values; stale cache is last resort |
| Air quality | Open-Meteo Air Quality | metric becomes unavailable if data is absent |
| Official Myanmar warnings | DMH importer/store | last valid store remains visible and freshness is shown |
| Flood intelligence | configured Flood Hub adapter + official/local data | no fabricated flood level when unavailable |
| Hospitals | bundled local database | lookup remains available offline |

Provider/source details are kept in the backend and exposed where provenance matters. The home screen stays concise rather than repeating source names on every card.

### Hospital data update workflow

The bundled `data/hospitals.db` currently contains the MIMU/CDE-Myanmar Public Hospitals in Myanmar dataset (2020). It is a local lookup database; it is **not** a live DOMS feed. To replace or refresh it with a separately verified source, normalize the source into `data/hospitals.csv` using the columns in `data/hospitals.example.csv`, then run:

```bash
python3 tools/import_hospitals.py data/hospitals.csv --replace
```

Do not paste a DOMS webpage screenshot/iframe into the app. If DOMS is the chosen source, first extract/verify the structured hospital records, including coordinates where available, then import them. Keep the source name and retrieval/update date in the dataset documentation.

### Forecast model
The primary forecast path explicitly requests ECMWF IFS HRES (`ecmwf_ifs`). Open-Meteo documents this as the 9 km global IFS HRES model; its generic API can also dynamically select suitable models when `best_match` is used. The application keeps model selection configurable via `WEATHER_MODEL` so it can be changed without code edits. The app does not claim the numerical model is ground-truth; forecasts remain model estimates and official DMH warnings remain separate.

## Private hospitals from the Manulife Myanmar list (added 2026-10-02)

Source: "Hospital List" PDF supplied by the project owner (Manulife Myanmar partner hospitals). Six entries whose
address names a township were added with `tools/import_hospitals.py` (ids `manulife_01`..`manulife_06`):
Aryu International (Tamwe), Pun Hlaing (Hlaing Tharyar, Mandalay/Chanayethazan, Taunggyi), Grand Hantha (Kamaryut),
Myat Taw Win (Taunggyi). The PDF has no coordinates, so each point is the centroid of its township in the existing
dataset and is labelled `township-level location only`. Not added: hospitals whose logo has no readable name, entries
without a township in the address (Victoria, Mandalar), and Vejthani (Bangkok, outside Myanmar). Verify exact
coordinates before using these for navigation.

## Official warnings

`risk_engine/data/official_alerts.json` only ever holds warnings imported from DMH (moezala.gov.mm) or entered by hand
from an official bulletin. As checked on 2026-10-01 there was no active heavy-rain, river-flood, cyclone or low-water
warning; the latest heavy-rainfall warning was No. 82/2026 (25 Sep 2026). Do not add expired warnings.

## Emergency numbers (Alerts tab)

Hard-coded in `emergency_card.js` (`EMERGENCY_*`). Nationwide: police 199, ambulance 192, fire 191. Local numbers for
Yangon, Mandalay and Nay Pyi Taw come from the Myanmar National Portal (myanmar.gov.mm); the DMH public weather line
(067-411252 / 01-667766) comes from moezala.gov.mm. Checked 2026-10-02. Other regions show only the nationwide numbers
until an official local number is found. Re-verify before each release.

Added 2026-10-02: police-force numbers for Kachin, Kayah, Kayin, Chin, Sagaing, Tanintharyi, Bago, Magway, Mon,
Rakhine, Shan and Ayeyarwady from the Myanmar National Portal "Police Station" list. Fire and ambulance numbers for
these regions were not found in an official source, so only the nationwide 191 / 192 are shown. Region matching uses the
selected place's admin1 name only (so "Monywa" is Sagaing, not Mon).

## UV index and the ECMWF model

Open-Meteo's ECMWF (`ecmwf_ifs`) variable list (open-meteo.com/en/docs/ecmwf-api, read 2026-10-02) has no UV index,
so `main.py` asks Open-Meteo's default blend for `uv_index_max` separately and merges it by date (`_merge_uv`).
Run `python tools/live_check.py` on a machine with internet to confirm UV, rain, temperature and AQI come back.

## El Niño card (Farming tab)

`data/enso_status.json` is served at `/api/enso`. Update it once a month after NOAA CPC's ENSO Diagnostic Discussion
(next 2026-11-12): edit `updated`, `next_update`, and the figures. The card shows a "stale" warning after 45 days,
or once `next_update` is more than 7 days overdue. `warning_system_url` is the link shown under the card. El Niño is global, so the card shows the same status for every place; the per-place part is the
7-day rain outlook, which the app computes from the forecast (not an official drought statement). The heat levels
(35 / 37 / 40 °C) and rain tiers are app heuristics, labelled as such in the UI.

## Scattered showers (နေရာကွက်ကျား မိုး) in the Farming card

A forecast model gives one rain total per grid cell, so scattered showers can show as ~0 mm while it rains nearby.
The 7-day card therefore counts a day as "dry" only if rain < 1 mm AND the rain chance is < 30% AND the weather code is
not a shower/thunder code (80-82, 95-99). Days with < 5 mm but a chance >= 30% or a shower code are shown as
"possible scattered showers". `precipitation_probability_max` is not provided by ECMWF IFS, so `main.py` backfills it
(like UV) from Open-Meteo's default blend via `_merge_uv`.

## Poor connections (Myanmar mobile networks)

- Service worker: on 2G/3G, high latency (rtt >= 700 ms) or data saver, the app shell opens instantly from the cache and
  refreshes in the background; otherwise network-first with a 2.5 s deadline. Places/hospital/El Nino API responses fall
  back to the cache after 3-5 s. Warnings and flood data are never served from a stale cache.
- Page: timeouts scale with the connection (x1.6 on 3G, x2.5 on slow/data-saver), one automatic retry on a dropped
  connection, a "slow connection" message after 8 s, and the last saved forecast (up to 24 h) is shown if the network fails.
- Footer switch "Data saver" defers non-essential requests (flood extras, hospitals, conditions).
- Verified offline by stopping the server after one visit: the app opens in ~1.6 s and shows the saved forecast.

## Farming tab (`data/agri.json`, `agri.js`, `/api/agri`, `risk_engine/agri_zones.py`)

Flow (from the owner's workflow chart): location -> crops usually grown in that zone -> what the next 7 days of weather
mean for those crops -> usual seasonal behaviour -> soil and fertilizer. Every crop and statement carries a mark:
v = confirmed in a published source, p = partly confirmed, u = only in the owner's own documents (AI-generated drafts).
Sources S1-S14 are listed inside the data file and shown in the app.

- Zones: delta (Ayeyarwady, Yangon, Bago), dry zone (Mandalay, Magway, Sagaing, part of Nay Pyi Taw), hills (Shan,
  Kachin, Chin, Kayah), coastal (Rakhine, Tanintharyi, Mon). Kayin and Nay Pyi Taw are not fully covered.
- Hills only have potato calendars (FFTC / Wageningen). Tea, coffee, garlic etc. have no checked calendar yet.
- The owner's documents disagree with each other on some months and give no kg/ha rates. IFDC (2018) states there is
  no national fertilizer recommendation by crop and agro-ecological zone, so the owner's N:P:K ratios are shown only
  as "reference (not verified)". The verified fertilizer facts are MOALI's three-split urea advice (S8).
- Weather advice per crop is an app heuristic on the 7-day forecast and is labelled as such.
- GPS places have no state/region, so `/api/region-at` finds the nearest MIMU place (within 120 km) and the zone card and
  regional emergency numbers use that.
- To add data: edit `data/agri.json` (keep `src` ids valid; `tests/test_agri.py` checks months, zones and sources).

## Two modes (mode refinement)

The app has two separate modes chosen with the switch under the header: Weather (today, 7 days, flood, hospitals,
alerts) and Farming (its own bottom bar: Now / Crops / Season / Soil). The mode is remembered. In farming mode the
weather dashboard is hidden, the search hero folds away once a place is chosen (the "Change" button brings it back), and
the farming screens use the same place and the same forecast. `agri.js` owns the farming screens; `render_cards.js`
supplies the 7-day rain summary (`#agriLocal`) and `enso_card.js` the El Nino card (`#agriEnso`).

7-day table: the legacy phone CSS set `.rain-cell{display:none}`, so the rain chance never showed on phones. Fixed in
`styles.css` (responsive forecast column rule).

## Calmer weather screen (weather screen refinement)

No text-size (A+) switch (removed on request). Top bar stays on one row on phones (the alerts button shows only its icon
below 480 px). Weather mode order: place -> current weather -> today's warnings -> 4 key numbers (+ "more") -> tabs.
Health tips are a fold-away card (open on wide screens). Once a place is chosen the big search block folds away in both
modes; the "Change" button brings it back.

## El Niño in both modes

The El Niño card appears at the bottom of the weather "Today" tab and in the farming "Season" tab (same data,
`data/enso_status.json`). Figures checked against NOAA CPC's ENSO Diagnostic Discussion of 8 Oct 2026 (read 2026-10-10):
El Niño Advisory; strong-to-very-strong El Niño likely through Jan-Mar 2027 (> 83% chance); 83% chance that Oct-Dec 2026
exceeds all El Niño events since 1950 (75% in September). Next statement: 12 Nov 2026 - update the JSON then.

## Updating a running copy (stale files)

Static files are now sent with `Cache-Control: no-cache` (always revalidated, cheap 304) and the service worker fetches
the app shell with `cache: "no-cache"` / `"reload"`. Before this, Firefox could keep an old `styles.css` for hours (heuristic
caching) while showing a new page, which looked like unstyled buttons. After replacing the files, hard-refresh once
(Ctrl+Shift+R) so the browser picks up the new service worker.

Farming screens no longer wait for the weather call: the crop calendar shows as soon as a place is chosen, and the
weather-based advice appears when the forecast arrives (or a note says it is not available).

## Clean-up (2026-10-03)

Removed after checking every file for references: five JS functions nobody called (`dedupeByName`, `fetchClimate`,
`loadCityDirectory`, `localSearch`, `renderClimateLoading`) and the three constants only they used; 17 lines of CSS for
`.smart-*`, `.safety-hub*`, `.safety-card*` and `.dmh-data-grid` (no HTML or JS uses those classes); the lint cache folder.
Kept on purpose: all `risk_engine` modules and data files (each is imported or read somewhere), `styles.css`
(still the base stylesheet that `styles.css` builds on), and the dev tools in `tools/`.

## Review notes (2026-10-03)

- Colour audit in a browser over 21 screens (day, night, rain, storm, hot; every weather tab; every farming tab): all
  backgrounds and borders are teal/green, neutral, or amber/red for severity. No blue, purple or orange is left.
  Text contrast: 0 items under WCAG AA (one 2.5:1 caption fixed). Text drawn on gradients was not measured.
- Service worker now registers on any secure context (https, localhost, 127.0.0.1); before, 127.0.0.1 was skipped.
- Error messages are one short sentence in the user's language; raw English server text is no longer shown.
- Firefox itself could not be launched in the test environment; all checks ran in Chromium.

## International hazard feeds (feed refinement)
USGS FDSN event service, GDACS event search (queried one alert level at a time because the combined filter is
unreliable) and the Open-Meteo Flood API (GloFAS). Endpoint `/api/hazard-feed` caches the regional feeds for 10 minutes
(shared by all visitors) and each river lookup for 3 hours; if all sources fail it keeps the last good copy and says so.
The service worker never answers this endpoint from a cache. See docs/RIMES.md for why DataEx is not scraped.
Not tested against the live services from the build environment (its network blocks them): the parsers are tested with
sample payloads shaped like the documented responses, so run `python tools/pull_feeds.py` once on your server.

## Coast and field water (water refinement)
`/api/local-extras` (cached 3 h per place, never caches a total failure): coastal wave outlook (flood tab, hidden for inland
points) and the farming water balance. Variables checked in published Open-Meteo documentation: `wave_height_max`,
`wave_period_max` (marine), `et0_fao_evapotranspiration` (daily/hourly), `soil_moisture_0_to_7cm` (hourly). The 1 m / 2 m wave
levels and the +-15 mm water-balance level are app heuristics and the UI says so. Skipped when data saver is on.
Considered and left out: NASA FIRMS fires (needs a registered key), ReliefWeb (needs an approved app name), RIMES DataEx (login).

## Burmese wording (2026-10-04)
The interface mixed formal written Burmese (နေသည်၊ ပါသည်၊ သဖြင့်၊ ၍၊ ၏) with spoken-polite Burmese (ပါတယ်၊ မယ်၊ လို့).
Everything now uses spoken-polite Burmese (ပါတယ်/ပါ/လို့/ရဲ့), plain words (အခု, ဒီနေ့, ခန်းမယ့်ရေ) and short sentences.
The rewrite was done by an AI, so it still needs a native reader: run `python tools/export_strings.py`, correct the
`corrected_text` column in `docs/burmese_strings.csv`, and send it back to apply in bulk.


## RIMES-first forecast path (2026-10-04)

RIMES DataEx is the preferred source for this project because RIMES operates a regional meteorological data exchange and provides access to observation and forecast products, including ECMWF and other model products. RIMES documentation also describes data quality control, model comparison/verification and localized forecasting support.

The application does **not** scrape the DataEx login page or reuse a personal account. The current DataEx web portal requires an account, while RIMES's public material does not provide a stable anonymous API contract for this application.

When RIMES/DMH provides an authorised server-side JSON/API endpoint, set `RIMES_API_URL` (and `RIMES_API_TOKEN` if required) in `.env`. The backend then tries RIMES first. If that provider fails, it falls back to the documented public chain. This keeps the app working now while making the RIMES path ready for an authorised integration.

RIMES has also worked directly with Myanmar's Department of Meteorology and Hydrology on NWP, flood forecasting, agro-advisory services, data management and impact-based forecasting, so official DMH warnings remain a separate higher-trust warning layer rather than being replaced by a model forecast.


## Climate history (v6.10.0)
- `data/history.json` is built by `python tools/build_history.py <climate.csv> <disasters.csv>` from the supplied 1985-2026 CSVs. It is **modelled** (World Bank CKP / Meteoblue simulation), not station data; future and partial months are dropped.
- Disaster list: the supplied CSV plus one verified addition, the 28 Mar 2025 Mw 7.7 Sagaing Fault earthquake (ReliefWeb/ECHO, ACAPS) that the CSV omitted.
- `data/enso_status.json -> sascof`: SASCOF-34 JJAS 2026 outlook, marked expired. The supplied healthcare CSV (114 rows, mostly generic clinics) was not merged; `hospitals.db` (1,136 facilities) stays the source.

## Hospital CSV check (v6.10.2)
`myanmar_healthcare_facilities_comprehensive.csv` (114 rows) was compared with `hospitals.db`: 103 rows sit within 3 km of an existing facility. The two hospitals farther away (Kale General, Kengtung General) already exist in the DB, and the CSV's bed counts for them are the reverse of the DB's (Kale 200 vs 300, Kengtung 300 vs 200). The CSV is therefore not merged; do not use it to overwrite beds or coordinates.

## Statistics and verification (v6.14.0)
- `tools/build_history.py`: each year's ENSO class is the majority phase in Jun-Sep (not the annual label). El Nino vs neutral monsoon rain is tested with a 5000-shuffle permutation test (two-sided p); the temperature trend gets a 95% bootstrap interval (2000 resamples, fixed seed). The UI calls a gap "significant" only when p < 0.05. Sample sizes are small (10 El Nino, about 18 neutral years) and the data is modelled.
- `/api/recent-rain` returns the last 7 days of model-analysis rain (Open-Meteo, not gauges). `rainlog.js` uses it to auto-check saved forecasts (rain = 0.1 mm or more), prefers the user's own answer, and shows Brier score and skill vs the local base rate once 10 days exist. Needs live network on the server; offline tests stub the provider.
- Farming planner and Today brief thresholds are general rules of thumb (spray wind under 15 km/h, heat guidance from NWS heat index); not validated against Myanmar field data.

## Farming tab: research bundle (since 6.16.0)
The Farming tab no longer asks for a town. The person picks one of 8 farming regions and only data on file is shown.

- Source CSVs: `data/agri_research/` (regions, crops, soil records, sources + the bundle's own README and integration guide).
- Burmese text: `data/agri_research_my.json` (restates each English row, adds no claim; numbers must stay identical).
- Build: `python tools/build_agri_research.py` writes `data/agri_research.json`; the test suite fails if it is out of date.
- API: `GET /api/agri/research` (optional `?region=R01`).
- Unknown values stay unknown ("not known yet"); soil rows hold no measured pH/N-P-K, so none is shown.
- Source-file defect found and repaired in the build: rows C005 and C006 had one extra cell that shifted
  `area_production_yield`, `data_quality` and `source_ids`. The duplicate cell is removed; no values are changed (logged under `repairs`).
- FAO GIEWS figures (30 Mt paddy and 2.1 Mt maize for 2026/27; main harvest from end-October; secondary crop about 20%)
  were checked against the brief dated 18 Sep 2026 on 2026-10-10.
- Calendar link: only R01→dry, R02→delta, R03→coastal and R04/R05/R06→hills (marked "broad zone") use the older
  `data/agri.json` calendar. R07 and R08 have none, because the bundle says not to generalise them.
- To add data: add rows to the CSVs (keep `data_quality` and `source_ids`), add Burmese text to `agri_research_my.json`, rebuild.

## Month by month vs normal (Compare tab, `/api/v1/monthly-compare`)

- This year's daily ERA5 (1 Jan to yesterday, Open-Meteo archive, `models=era5`) against the 1991–2020 ERA5 normals already used by the Compare tab. Both come from the same reanalysis, so there is no source mismatch.
- Mean temperature = (daily max + daily min) / 2. Rain = monthly total. A month still in progress is compared with the normal for the same days of the month, never with the whole month.
- ERA5 runs several days behind real time; the response says which day the data reaches (`data_through`).
- `region=MM-xx` uses that state/region's centre from `data/history.json`. The first request for a centre downloads 30 years of ERA5; run `python tools/prewarm_baseline.py --regions` once so visitors never wait for it.
- Descriptive information only: modelled data, not a station record, and never a warning.

## Myanmar calendar (`mm_calendar.js`)

Gregorian date to Myanmar year / month / waxing-waning day (လဆန်း, လပြည့်, လဆုတ်, လကွယ်) for the Today moon card and the 7-day forecast. Algorithm: Yan Naing Aye's Myanmar calendar (MIT) via mm-cal-js (MIT), Myanmar Era 1316 onward; verified day by day against mm-cal-js for 2000–2059. The traditional calendar can differ by a day from the astronomical full moon.
