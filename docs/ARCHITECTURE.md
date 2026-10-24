# Architecture

## System boundary

```text
Browser / PWA
   │
   ├── local MIMU search
   ├── cached UI state
   └── same-origin API
            │
            ├── weather provider adapters
            ├── air-quality provider
            ├── DMH official warning importer
            ├── flood data adapter
            ├── hospital database
            └── risk engine
```

## Core invariants

- A place record is never silently relabelled as a township.
- Forecast values are not averaged across providers.
- Stale data is explicitly marked.
- Official warnings and model signals have separate provenance.
- Provider outages must not create fake alerts.

## Caching

Weather is cached briefly because it changes frequently. Geocoding/location data is cached much longer because place identity is comparatively stable. The frontend also keeps a small local weather cache so a temporary connection failure can still show the last known data.

## Long-term deployment

The current process-local cache is suitable for a small single-instance deployment. For multiple API instances, move cache/rate-limit state to Redis or an equivalent shared store and persist notification subscriptions separately.

## Capacity and forecast model notes (v6.7.4 optimized)
- Primary forecast model is configurable via `WEATHER_MODEL`; default is `ecmwf_ifs` (ECMWF IFS HRES, 9 km).
- Local MIMU place search uses a preloaded immutable in-memory index with 2-character candidate grams and bounded response caching. SQLite remains the source of truth and runtime index creation is avoided.
- Hospital nearest lookup preloads coordinates into memory and uses bounded response caching; SQLite is not scanned per request.
- Production startup pre-warms local indexes. `WEB_CONCURRENCY` controls Uvicorn worker count (default 4 in container/start script).
- The UI uses search-first location discovery plus optional Region/State -> Town quick selection.
- A single host is not treated as proof of 10k/100k/1M concurrent-user capacity. Distributed load generators and production-like networking are required at those scales.

## Code layout and maintenance rules

Myanmar Weather & Disaster Alerts: a FastAPI backend and a no-build browser app (plain ES modules, installable PWA).
This page explains where things live and which rules keep it maintainable. Read it before adding a feature.

### 1. Layers

```
browser (weather.html + ES modules)  ->  /api/*  (FastAPI: main.py, app/, risk_engine/)  ->  providers (Open-Meteo, DMH feeds, ...)
        |                                                    |
   sw.js (offline cache)                                data/*.json, *.db (hand-maintained or built by tools/)
```

- **Backend** (`main.py`, `app/`, `risk_engine/`): all outside requests, caching, rate limiting, provider fallback, alert rules.
  The browser never talks to a weather provider directly.
- **Data** (`data/`): facts the app shows. Each file has an owner tool or an update recipe in `docs/DATA_SOURCES.md`
  and a contract test in `tests/test_data_contracts.py`.
- **Frontend**: no bundler. Files are loaded as `<script type="module">` (only `theme_init.js` is a classic script).

### 2. Frontend modules (weather page)

Dependencies point one way, down. `tests/test_module_graph.py` fails on a cycle, a missing export or a file that is not served.

| layer | file | what it owns |
|---|---|---|
| shared | `i18n.js` | loads `i18n/*.json`; exports `L(key)`, `t(lang,key)`, `SCALES`, `WEATHER_CODES` |
| shared | `core.js` | `state`, `els` (DOM references), `esc`, `temp`, `speed`, `fmtTime`, `weatherInfo`, `setStatus` |
| shared | `net.js` | `apiJSON` (timeout, retry), weather cache, `isSlowNet`, `getWeather`, `loading` |
| cards | `render_cards.js` | current conditions, hourly, forecast, charts, theme |
| cards | `health_tips.js`, `safety.js`, `flood_status.js`, `hospitals.js`, `enso_card.js`, `emergency_card.js`, `scale_ui.js`, `field_guides.js`, `nature.js`, `mm_calendar.js` | one card or helper each (`nature.js` is pure logic: wind names, crop-disease watch, unit-tested in `tests/nature.test.mjs`; `mm_calendar.js` is the Myanmar calendar, checked against mm-cal-js in `tests/mm_calendar.test.mjs`) |
| entry | `weather_script.js` | search, location loading, refresh, tabs, event binding (what is left after the cards were split out) |
| features | `agri.js` (Farming tab: data, navigation, region and tab logic), `views.js` (React screens, built from `frontend/src/`: Farming cards, hourly strip and detail, forecast list, temperature/rain charts, local rain / heat / cyclone cards), `compare.js`, `history.js`, `monthly_compare.js`, `feeds.js`, `help.js`, `risk_panel.js`, `notifications.js`, `app_boot.js`, `theme_init.js` | one tab or service each |
| modules (use `window` hooks) | `brief.js`, `rainlog.js`, `about.js`, `help.js` | today brief, "Did it rain?" log, About dialog and its glossary |

Rule of thumb: a function that only draws a card goes in a card module and receives what it needs; it must not import the entry file.

### 3. Data and text

- **Translations**: `i18n/my.json` and `i18n/en.json` must have the same keys and the same `{placeholders}`.
  Key names say what the text is: `<area>_<what it says>` (for example `wx_no_extreme_heat_expected`, `farm_month`). Never reuse a key
  for a different meaning, and never use hashes. Old hash names are mapped in `docs/i18n_key_renames.json`.
  `python tools/export_strings.py` writes `docs/burmese_strings.csv` for proof-reading.
- **Farming**: `data/agri_research/*.csv` (research bundle) -> `python tools/build_agri_research.py` -> `data/agri_research.json`;
  Burmese text in `data/agri_research_my.json`; older calendar in `data/agri.json`. Unknown stays unknown; no town-to-region guessing.
- **El Nino**: edit `data/enso_status.json` after each NOAA statement. The card warns when it is stale.
- **Scales** (UV, AQI, rain, wind, heat): `i18n/scales.json`. Upper bounds are exclusive; thresholds follow WHO, US EPA and IMD.

### 4. Security and deployment rules

- CSP is `script-src 'self'; style-src 'self'`: no inline scripts, no `style="..."`, no `onclick=`. Set widths with `data-w`.
- `app/web.py` serves only the names in `PUBLIC_FILES`. **A new frontend file must be added in two places:** `PUBLIC_FILES`
  and the `SHELL` list in `sw.js` (`tests/test_module_graph.py` checks both). Behind a proxy set `TRUST_PROXY_HEADERS=true` and `PUBLIC_BASE_URL`.
- Secrets live in `.env` only. `.env.example` lists every setting.

### 5. Global hooks (kept deliberately small)

A few late hooks talk through `window`. The list is the contract; `tests/test_window_contract.py`
fails if a hook is read but never assigned, or assigned but never read.

`renderAgri`, `renderTodayBrief`, `setBriefOfficial`, `renderCompareCharts`, `rainLogSnapshot`, `loadHistory`, `loadFeed`,
`isSlowNet`, `MWR_STATE`, `MWRisk`, `MWRNotifications`, `MW_API_BASE`, `MW_PEOPLE`, `__mwLang`, `__mwRetext`.
Prefer an `import` for anything new.

### 6. Checks (run before every release)

| check | command | catches |
|---|---|---|
| Python tests | `python -m pytest -q` | API, data contracts, Burmese wording, module graph, wiring |
| Lint | `npm run lint` | undefined and unused variables (this found real bugs) |
| Module link test | runs inside pytest (needs Node) | a missing export or bad import path that would blank the page |
| Browser tests | `npx playwright test` | real clicks (CI only; needs a browser) |
| Live data | `python tools/live_check.py` | the real Open-Meteo/DMH responses (needs internet) |

Release: change `VERSION`, run `python tools/sync_version.py`, run the checks, then `python tools/release_zip.py`.

### 7. Add a feature (checklist)

1. Data first: where does it come from, who updates it, what does "unknown" look like? Add a contract test.
2. Text: add both languages with meaningful key names.
3. Code: new file or card module, imports pointing down, no inline style or handlers.
4. Register the file (section 4), run the checks, update this page if a layer changed.

### 8. Known gaps

- `weather_script.js` still holds search and location loading, which call each other, so they stay together.
- Every script in `weather.html` except `theme_init.js` is now an ES module. `risk_panel.js` (`MWRisk`) keeps the requests, cache, offline copy and state, and draws through `risk_view.jsx`.
- Browser tests run in CI only. Check a real phone before a public release.

## Interaction coordination

`interaction.js` owns named-place navigation/history, keyboard tab relationships,
per-section return positions, disclosure/focus preservation and bounded cancellable
reference-data requests. Weather data and official warnings remain provider-controlled.

## React islands (frontend/)

The page stays plain ES modules; screens are moved to React **one at a time**. `frontend/` is a small Vite project
(`npm install && npm run build` inside it) that bundles React + one screen into a single generated file in the app root
(`views.js`, first line `/*! GENERATED ...`). Commit the built file: the server needs no Node at runtime.
Screens moved so far: Farming tab (`agri_view.jsx`), Today/Forecast cards (`weather_view.jsx`, from `render_cards.js`), Compare tab (`compare_view.jsx`, `monthly_view.jsx`, `history_view.jsx`), hazard/river/sea/water cards (`feeds_view.jsx`), hospital list (`hospitals_view.jsx`), "Did it rain?" card (`rainlog_view.jsx`; `rainlog.js` is now a module). All React roots are created in `slots.js`; to empty a card that React draws call `clearSlot(id)` (never `replaceChildren()`). The Farming tab was the first island: `agri.js` still loads data and handles tabs/regions/navigation, and calls
`mountAgriView()` to draw the six cards (`#farmHead`, `#agriRoot`, `#agriCrops`, `#agriBeh`, `#agriSoil`, `#agriSrc`).
Markup, classes and ids are identical to the old string templates, so `styles.css`, `ux.css` and the e2e tests did not change.
Generated files are skipped by the source-level guards in `tests/` (see `tests/_src.py`).
