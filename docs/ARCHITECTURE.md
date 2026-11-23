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
| cards | `health_tips.js`, `safety.js`, `flood_status.js`, `hospitals.js`, `enso_card.js`, `emergency_card.js`, `scale_ui.js`, `field_guides.js`, `pests.js`, `nature.js`, `mm_calendar.js`, `wxicon.js`, `swipe_tabs.js` | one card or helper each (`nature.js` is pure logic: wind names, crop-disease watch, unit-tested in `tests/nature.test.mjs`; `mm_calendar.js` is the Myanmar calendar, checked against mm-cal-js in `tests/mm_calendar.test.mjs`) |
| entry | `weather_script.js` | search, location loading, refresh, tabs, event binding (what is left after the cards were split out) |
| features | `agri.js` (Farming tab: data, navigation, region and tab logic), `lazy_views.js` (loads the Compare, Farming and Alerts/Hospitals/About screens only when first needed), `views.js` (Preact screens for the first screen, built from `frontend/src/`: Farming cards, hourly strip and detail, forecast list, temperature/rain charts, local rain / heat / cyclone cards), `compare.js`, `history.js`, `monthly_compare.js`, `world.js` (World tab: worldwide hazards from /api/world-hazards), `feeds.js`, `help.js`, `risk_panel.js`, `notifications.js`, `app_boot.js`, `theme_init.js` | one tab or service each |
| features | `leaf.js` (Lab tab controller: crop, signs, photo, optional AI, saved record), `leaf_data.js` (pure rules: sign ranking, confidence wording, record table and CSV; unit-tested in `tests/leaf_data.test.mjs`), `leaf_models.js` (which model reads which crop, class names, measured numbers), `leaf_prep.js` (Pillow-exact image preparation; `tests/leaf_prep.test.mjs`), `leaf_engine.js` (loads ONNX Runtime Web from `vendor/ort/` and the models from `models/leaf/`, checks their hashes), `views_lab.js` (the Preact screen, built from `frontend/src/leaf_view.jsx`) | Lab tab: leaf check with three independent looks (sign checklist, on-device photo check, optional server AI second look via `app/leaf.py`); see `models/leaf/MODELS.md` |
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

## Preact islands (frontend/)

The page stays plain ES modules; screens are moved to JSX/Preact **one at a time** (Preact, not React: 3 KB instead of 72 KB gzipped, same JSX; screens use no hooks, so nothing else changes). `frontend/` is a small Vite project
(`npm install && npm run build` inside it) that bundles Preact + one screen into a single generated file in the app root
(`views.js`, first line `/*! GENERATED ...`). Commit the built file: the server needs no Node at runtime.
Screens moved so far: Farming tab (`agri_view.jsx`), Today/Forecast cards (`weather_view.jsx`, from `render_cards.js`), Compare tab (`compare_view.jsx`, `monthly_view.jsx`, `history_view.jsx`), hazard/river/sea/water cards (`feeds_view.jsx`), hospital list (`hospitals_view.jsx`), "Did it rain?" card (`rainlog_view.jsx`; `rainlog.js` is now a module), Lab tab leaf check (`leaf_view.jsx` -> `views_lab.js`, lazy-loaded; `leaf.js` is the controller). All Preact roots are created in `slots.js`; to empty a card that Preact draws call `clearSlot(id)` (never `replaceChildren()`). The Farming tab was the first island: `agri.js` still loads data and handles tabs/regions/navigation, and calls
`mountAgriView()` to draw the six cards (`#farmHead`, `#agriRoot`, `#agriCrops`, `#agriBeh`, `#agriSoil`, `#agriSrc`).
Markup, classes and ids are identical to the old string templates, so `styles.css`, `ux.css` and the e2e tests did not change.
Generated files are skipped by the source-level guards in `tests/` (see `tests/_src.py`).

## Look and feel: `pro.css`

`styles.css` (base) → `ux.css` (layout layer) → `pro.css` (the look; loaded last). `pro.css` only changes appearance:
tokens (`--pro-*`, with the OLED dark palette under `html.sg-dark`), one radius scale, hairline borders instead of shadows, small segmented
Weather | Farming switch, header with two icon buttons plus a settings menu (text size, °C, alerts, about) on screens wider than 650 px, and extra
Burmese line height. v9.14 adds the identity: ONE bold element, the weather band at the top, whose colours follow `body.weather-*` (set by
`render_cards.js`: clear, rain, storm, fog, heat, night; white text is at least 4.5:1 on every stop and a test checks it); a coloured line icon per
key number (CSS masks, order of the cards in `weather.html`); an icon tile and a status stripe on the two decision cards; tinted show-more buttons.
Every rule starts with `body` (dark rules with `html body.sg-dark`) because the older files use `!important` widely.
v9.15 softens the page: the white surfaces are a light green-grey tint (`--pro-bg`, `--pro-surface`, `--pro-sunken`, `--pro-line`) with a faint
wash under the weather band, so cards are separated by tone, not by pure white. The Compare tab (`frontend/src/compare_view.jsx`,
`monthly_view.jsx`) shows every number once, as HTML text (big value, signed change chip, usual range); the picture is a plain HTML track
(band, usual mark, dot) with no numbers inside it. (v9.17 replaced the monthly SVG chart; see below.)
v9.16: `wxicon.js` draws the weather icons as inline SVG (one per WMO code, sun or moon), so they look the same on every phone; it is used by the
hero (`weather_script.js`), the hourly strip, the hour detail and the 7-day list (through `render_cards.js` -> `weather_view.jsx`). The weather band has
a decorative `.sky-fx` layer (four empty `<i>`; `pro.css`) whose rain, clouds, stars, mist and lightning follow the same `body.weather-*` classes and animate
only transform and opacity; it is off for `prefers-reduced-motion` and data saving (`html.no-fx`) and paused when scrolled out of view. `swipe_tabs.js` turns a
sideways swipe into a press of the next / previous tab button (weather tabs, or the four farming tabs); it ignores edge swipes, scrolling strips, fields,
dialogs and pinch-zoom.
v9.17: the Compare tab shows one question at a time. `#cmpSeg` (Now / This year / Long term; wired in `app_boot.js`, section 8) sets `data-view` on the panel and
`pro.css` hides every card whose `data-seg` is another view: Now = `#compareCharts` + the rain log, This year = `#monthlyCompareCard`, Long term = `#historyCard`.
Months (`monthly_view.jsx`, and the typical year in `history_view.jsx`) are rows of text (`.mc-rows`: name, a plain HTML bar from a zero line, the number as text; two columns
from 768 px), so no number is drawn inside a picture and nothing can overlap. The long-term line and bar charts label only the first, middle and last year. Statistics words
(p-values, confidence ranges, Brier score) sit inside `<details>`. Preact keeps SVG attribute names as typed, so SVG attributes in `frontend/src/*.jsx` must be dashed
(`text-anchor`, `stroke-width`); `tests/test_frontend_svg_attrs.py` checks it. A `<details>` that can appear after a redraw needs `data-detail-key`, because
`preserveView()` (`interaction.js`) otherwise restores open/closed state by position.
The two "show more details" buttons (`#metricFold`, `#todayBriefFold`) share one delegated click listener in `weather_script.js`; do not add
`onclick` handlers to them (that would toggle twice).
The last block of `pro.css` is the **device layer** (v9.19.0), written from a measured sweep of 13 screen sizes x 3 languages (320 px phones, foldable widths, tablets, laptops, 1920 px, phones on their side). Its rules, in order: controls are at least 44 px on touch and small screens (the small "Scale" link grows only its hit area, with `::after`); no text under 12 px (`--fs-floor`, it still grows with A+; the five tab labels on a 320 px phone stay at 11 px); the hero card wraps instead of cutting the condition off below 400 px; tablet tabs sit in two even rows of four; tiles are at least 172 px wide and at most five across; phones on their side hide the eyebrow and coordinates so the weather is on the first screen. From 651 px the header is exactly as wide as the page below (its edge-to-edge band is drawn by `.topbar::before`), so the logo, the buttons and the settings menu line up with the content; the settings menu is as wide as its longest label (the Burmese "Alerts" label did not fit the old fixed 252 px). `tests/e2e/ux.spec.js` ("Device matrix") repeats the sweep and fails on overflow, a small control, small text, a label wider than its own button or a header that does not line up; it fails when the layer is removed.

The very last block of `pro.css` is the **calm layer** (v9.20.0), added because the additions of v9.19-v9.20 had made the page busy. It adds no content. (1) Secondary cards are **folds**: a native `<details class="fold-card">` whose summary is a title plus one quiet line (and a count where it helps). Folds are closed by default and open themselves when the card matters: the heat card opens above "low risk", the international-sources card opens when it has an alert or an error. Open/closed state survives re-renders through `data-detail-key` (`interaction.js`). Folded in this release: heat notice and its hydration advice, cyclone season, prep checklist, international sources, El Niño, and in the Lab the signs step (with a count of ticked signs), "not every sign is a disease" and the whole health-and-safety section. The Lab step 3 chips (`#leafSigns`) are therefore hidden until opened: tests call `unfold(page, '#leafSigns')`. (2) **One surface per card**: lists, hour details, Lab steps and results lose their inner frame and fill and are split by a hairline. (3) **One type scale**: 14 / 16 / 18 / 22 / 28 px, plus the 54 px temperature. Small print is 14 px (12 px stays only in pills and tab labels), card titles 18 px, body 16 px; the odd sizes (13, 13.5, 15, 15.5, 17, 18.4, 25.6, 26, 30) were mapped onto it. Emergency numbers are outlined pills, not solid dark ones.

**Simple and familiar (v9.21.0).** The same layer was carried through the rest of the site with three rules: fewer things at once, the familiar weather-app order (the answer first, the background after), plain words before numbers. Compare "now" (`compare_view.jsx`) shows per card: the number, one plain sentence (`.cmp-say`, keys `cmp_say_*`, e.g. "5.2 °C warmer than usual"), a five-step meter (`.cmp-meter`, one lit step; cool / normal / warm for temperature, low / normal / high otherwise) and the usual range. The old "how to read" legend and the track graphic are gone, and the method text and the table stay as folds. "This year" and "Long term" put their captions, data dates and source lines into one fold "About these charts" (`data-detail-key` `mc-about` / `hist-about`). Farming "now" (`agri_view.jsx`) starts with this month's work; the zone background (type, climate, evidence, sources) is one fold (`farm-about`) and the zone name appears only in the card above (`#farmHead h3`), so tests read it there, not in `#agriRoot`. The text sizes follow the v9.20 scale: sentence 18 px, meter labels 14 px, values 32 px.

**v9.22.0**: the four first-screen tiles (`.metric-grid > .metric`) put the icon on top on phones (`pro.css` section 5), so a value such as "1.4 မီလီမီတာ" stays on one line instead of wrapping to three next to the icon. Note for audits: `tests/e2e/ux-fixtures.mjs` opens the ⚙️ menu (`#topMore.open`) on load so tests can reach its buttons, so a screenshot taken with the fixtures shows the top bar about 160 px taller than a real phone.

**v9.23.0 — one tab, one subject.** Before, the Today summary (`.decision-grid` warnings and health card, `.current-card`, `.metric-grid` with its `#metricFold`, `#scalePanel`) sat above every tab, so Compare, 7-Day and the rest started about 1400 px down the page and a tap on a tab had to scroll past it. `switchTab()` in `weather_script.js` now sets `body[data-wtab]` (not `data-tab`: the tab buttons use that name and tests select `[data-tab=…]`), and the last block of `pro.css` (section 6) hides those five blocks whenever `data-wtab` is set and is not `today`. The place row (`.location-row`: name, time, change place, share) stays on every tab. Nothing is removed from the DOM, so scripts that fill the tiles keep working; scroll memory per tab (`interaction.js`) and swipe between tabs are unchanged. Phone: the Compare tab starts at 429 px instead of 1642 px, and the page is 1489 px instead of 2707 px (fixtures, ⚙️ menu closed). Desktop uses the same rule.

**v9.24.0 — Today in the usual order.** The hourly card (`.hourly-card`, with `#hourlyForecast` and `#hourlyDetail`) moved in `weather.html` out of the Today panel to sit in `#dashboard` after the current-weather card. Order on Today is now: temperature, warnings card (`.decision-grid`), next hours, the four tiles, then the Today panel; on a phone the hours start at about 930 px instead of 1900 px. Warnings stay above the hours on purpose, so an active warning is never pushed down by a 580 px card. The card is hidden on the other tabs together with the rest of the Today summary (`pro.css` sections 6–7). On desktop (≥1024 px) `grid-template-areas` gained an `hourly` row, and on the other tabs the template collapses to two rows (`nav loc` / `nav panel`) so hidden rows leave no gaps. In the "no notices" state (`.mwr-sum-none` present, matched with `:has()`), the pill `.brief-main` is hidden because the grey "no official warning" strip says the same, and the footer shows the freshness line and the details button on one row; with any notice in the list the pill returns. Tests select `.hourly-card` as `#dashboard > .hourly-card`.

**v9.25.0 — DMH warnings and storm news on Vercel, and items that expire.** Three parts.
(1) `.github/workflows/dmh-import.yml` runs `python -m risk_engine.dmh_importer` every 20 minutes on GitHub, keeping its state in the assets of the release `dmh-data` (download, run, upload with `--clobber`; no commits, so no Vercel deploy), then `tools/dmh_check.py` fails the run when DMH could not be read. `risk_engine/remote_official.py` downloads the two files with a 5-minute TTL (a failed refresh keeps the last good copy; retry after 60 s); `app.py` calls it in a middleware for the routes that read official warnings (`OFFICIAL_PREFIXES`). `OfficialAlertStore._raw()` uses the snapshot's `source: dmh` entries when the snapshot's `updated_at` is newer than the file, and always keeps manual entries from the file. `dmh_importer.source_status()` prefers the snapshot's state when its `last_success_at` is newer, reports `update_mode` (`remote`, `local`, `off`) and treats a remote snapshot as "updates enabled". On Vercel (`VERCEL` set) the in-process importer is off unless `DMH_IMPORT=on`.
(2) The importer also reads DMH's "Top Announcement" (`/en/top-announcement/<id>`, found through links on the DMH home page, plus the Burmese page): `parse_announcement`, `announcement_issued`, `classify_announcement`, `import_announcements`, stored in `state["announcements"]`. Only text with storm wording (cyclone, depression, low pressure, storm / Burmese equivalents) becomes a "watch" item (≤ 36 h), carrying DMH's own sentence; the parser is lenient and a failure there never stops the warnings. `feeds.js` shows the item with its date and drops it when it is too old, even if the page stays open; `#watchCard` is now the first card of the Hazards panel.
(3) Expiry: `risk_engine/feeds.py::drop_expired` removes GDACS events that are no longer current and earthquakes older than 3 days from the regional and world feeds. The table of lifetimes is in `docs/DATA_SOURCES.md`.

**v9.26.0 — Long-term history from ERA5.** `tools/build_history_era5.py` rebuilds `data/history.json` (same file format, so `/api/history` and `history_view.jsx` are unchanged) from the same ERA5 source as the live "Now" / "This year" views. Resumable chunked download (cache in `tools/.era5_history_cache/`, 600/5,000/10,000 unit limits respected, stops at the first HTTP 429 or at `--max-weight`, `--loop` waits), 1991-2020 normals reused from or written to the baseline cache, pure-Python statistics (no numpy), `check()` refuses implausible results. Covered by `tests/test_build_history_era5.py` against a fake archive server. The old `tools/build_history.py` (modelled CSV) is kept for reference.

**v9.27.0 — Visitors bring their own AI key.** The Lab's AI second look no longer runs on the owner's key. `leaf.js` / `frontend/src/leaf_view.jsx` have a separate key card (password field outside a form; key kept in `sessionStorage`, or `localStorage` only on request; only the last four characters are ever shown) and send the key in the `X-User-Api-Key` header; `app/leaf.py` validates its shape, forwards one call and forgets it (`401 bad_key` / `need_key`, separate per-visitor hourly budget `SG_LEAF_BYOK_PER_HOUR`, no draw on the owner's daily budget). `ANTHROPIC_API_KEY` serves visitors only when `SG_LEAF_SHARE_SERVER_KEY=1`. Also fixed in this release (found by the full end-to-end test): a crash when writing a published DMH warning (`zip(strict=True)` in `supersede`), old-dated Top Announcements that looked fresh, and a 60-second refresh stall in `risk_engine/remote_official.py`.

**v9.28.0 — The visitor's key can be a free Gemini key.** The Lab key card gains a provider pick (Claude / Gemini). `leaf.js` keeps each provider's key in its own store (`mw_leaf_key_v1` / `mw_leaf_gkey_v1`, picked provider in `mw_leaf_provider_v1`) and sends `X-Ai-Provider` beside `X-User-Api-Key`; `app/leaf.py` shape-checks the key against the chosen provider (a mismatch, or an unknown provider, is refused as `bad_key` before any call), and `call_gemini` forwards one `generateContent` call with the key in the `x-goog-api-key` header — never in the URL — mapping a rejected key (400/401/403) to the same `bad_key` answer and everything else to the same generic failures as the Anthropic path. The reply is parsed by the same `parse_answer`, and the spend comes out of the same per-visitor BYOK budget, never the owner's. Default Gemini model `gemini-2.5-flash` (`SG_LEAF_GEMINI_MODEL`). The owner's shared key, when enabled, stays Anthropic-only.

To return to the previous look, delete the `pro.css` link in `weather.html`. Do not turn off `backdrop-filter` there: it makes the scrolling
hourly strip widen the whole page (guarded by the "never scrolls sideways" e2e test).

## Leaf check engines (Lab tab)

Two engines read a leaf photo and both stay: (1) on the phone, ONNX Runtime Web with the small models in `models/leaf/` (no setup, photo stays on the device; engine files in `vendor/ort/`, wasm in four parts because of the serverless response limit); (2) optionally through the server, `POST /api/v1/leaf` in `app/leaf.py`, which runs on the **visitor's own Anthropic key** (v9.27: a separate key card in the Lab, `leaf.js` keeps it in `sessionStorage` or, if asked, `localStorage` and sends it only in the `X-User-Api-Key` header; the server forwards one call and forgets it; the owner's `ANTHROPIC_API_KEY` serves visitors only with `SG_LEAF_SHARE_SERVER_KEY=1`). The sign checklist needs neither. The three results are shown separately and never merged.
`/models/leaf/{name}` and `/vendor/ort/{name}` are served by `app/web.py` with a strict name pattern; `sw.js` keeps them cache-first in `sg-leaf-v1`. The page policy allows `'wasm-unsafe-eval'` (WebAssembly only; no inline scripts or styles).
The saved record (`mw_leaf_log_v1`, max 300 rows) lives in this browser only.

### v9.20.0 additions to the Lab (all in `leaf_data.js` / `leaf.js` / `leaf_view.jsx`, texts in the four `i18n/*.json`)
- **Photo check before reading** (`assessPhoto`, on the phone): mean brightness, share of blown-out pixels, leaf-coloured share of the middle of the frame, and Laplacian variance on a 160 px copy. `dark`, `bright` and `far` stop the photo model from saying "fairly sure" (`capByQuality`; the reading is shown as "not sure"); `blurry` only warns. **The thresholds (`QUAL`) are cautious guesses checked on made-up pictures only, not on real Myanmar field photos**; change them only with real photos at hand. It does not change what the models say, so it is not a measured accuracy gain.
- **How to take a good leaf photo**: six short tips, folded under the photo buttons.
- **Looks similar to** (`lookAlikes`): from the guide's own sign tags, up to three other problems of the same crop that share a typical sign; shown inside each guide card with their own sign text. No new disease facts were added.
- **Not every sign is a disease** (`otherCauses`, `OTHER`): ten non-disease causes (nitrogen, zinc, iron, potassium, water, waterlogging, heat, spray burn, dust or dew, ageing) matched to the ticked signs, plus the clue for telling disease from other causes and when to ask an extension office.
- **Staying healthy in the field**: spraying, heat, water/mosquitoes/floods and snakebite, plus two weather-linked tips (`health_tips.js`: mosquitoes after rain, floodwater and safe water on heavy-rain days). General advice, never a diagnosis, no pesticide names or doses.

| topic | source |
|---|---|
| pesticide safety | FAO, https://www.fao.org/3/x5048e/x5048E0j.htm (the page's advice to induce vomiting is **not** repeated: current poison-centre advice is to get medical help and take the label) |
| snakebite first aid | WHO, https://www.who.int/teams/control-of-neglected-tropical-diseases/snakebite-envenoming/treatment ; the Myanmar-relevant MIMU snakebite guideline (2008) for the hospital warning signs |
| dengue prevention and warning signs | WHO, https://www.who.int/news-room/fact-sheets/detail/dengue-and-severe-dengue |
| leptospirosis (floodwater, wet soil) | CDC, https://www.cdc.gov/leptospirosis/about/index.html (the page does not mention rice fields; the app says "floodwater or wet soil") |
| diarrhoea, ORS, safe water | WHO, https://www.who.int/news-room/fact-sheets/detail/diarrhoeal-disease |
| heat while working | WHO, https://www.who.int/news-room/fact-sheets/detail/climate-change-heat-and-health (it has no outdoor-worker section; the app uses its general advice) |
| rice nutrient disorders | TNAU, https://agritech.tnau.ac.in/agriculture/agri_cropproduction_cereals_rice_tranpudlow_mainfield_nutrient_mgmt_deficiency.html |
| disease vs environmental stress | Iowa State Extension, https://yardandgarden.extension.iastate.edu/how-to/biotic-vs-abiotic-distinguishing-disease-problems |

Written from the pages above on 2026-11-19. The water, heat, spray-burn and waterlogging descriptions are standard agronomy wording, not a quote from one page. **The Burmese and Japanese texts are my translations and have not been checked by native speakers.**
