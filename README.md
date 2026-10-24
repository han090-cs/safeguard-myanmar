# Myanmar Weather

**Release version:** see `VERSION` (single source of truth) — production hardening release focused on reliability, strict CSP, production CORS, visual consistency, PWA update handling, accessibility, and regression testing.

A bilingual, mobile-first Myanmar weather and early-warning platform focused on **daily usability, official-source transparency, hazard awareness, health guidance, and long-term maintainability**.

> **Important:** This application combines official DMH information with model-based weather guidance. Model-derived signals are not official emergency warnings. For urgent safety decisions, follow the latest instructions from the relevant authorities.

## What this project does

- 🇲🇲 Myanmar-first location search with an offline MIMU gazetteer
- 🌦️ Current conditions and 7-day forecast
- 🌧️ True trailing 24-hour rainfall, rain probability, wind, humidity, visibility, pressure and UV information
- 😷 Weather-aware health and safety guidance
- 🚨 Separate display of official DMH warnings and app-generated model advisories
- 🌊 Google Flood Hub backend integration with an explicit not-configured state when API access is unavailable
- 🌊 DMH flood and flash-flood warning ingestion
- 🌀 Cyclone / storm warning ingestion
- ⚡ Heavy rain and strong-wind warning ingestion
- 🌎 Earthquake and tsunami information in the app information center
- 🌏 El Niño / La Niña and climate context
- 📡 DMH radar and Himawari source center
- 🌾 Agriculture conditions without unsupported crop-specific advice
- 🏥 Hospital lookup API (`/api/hospitals/*`) from the MIMU/CDE-Myanmar dataset — local lookup with distance and map links
- 📡 Offline/stale-cache behavior with visible freshness information
- 📱 Responsive PWA for phones, tablets and desktop browsers
- 🔔 Optional browser notifications; permission is never requested automatically
- 🇲🇲 Burmese-first UI with English support
- ♿ Reduced-motion and accessibility-friendly interaction patterns

## Data architecture

```text
                       ┌─────────────────────┐
                       │ DMH / Myanmar       │
                       │ official warnings   │
                       └──────────┬──────────┘
                                  │
             ┌────────────────────┼────────────────────┐
             │                    │                    │
       Open-Meteo            Flood Hub            ERA5
       forecast/AQ           river forecast       climate context
             │                    │                    │
             └────────────────────┼────────────────────┘
                                  ▼
                         Provider adapters
                                  │
                                  ▼
                     Normalization + caching
                                  │
                     ┌────────────┴────────────┐
                     ▼                         ▼
             Official warning store      Risk engine
                     │                         │
                     └────────────┬────────────┘
                                  ▼
                         FastAPI /api/v1
                                  │
                                  ▼
                          PWA / Web client
```

The most important architectural rule is that **official warnings are never silently converted into model predictions**. The UI and API preserve the distinction.

## DMH integration

The Department of Meteorology and Hydrology (DMH) is the primary Myanmar-specific official source:

https://www.moezala.gov.mm/

The importer checks the public DMH warning listings/RSS and stores bilingual warning metadata in local state. It performs validation before publishing an item to the official-warning store, including language availability, age/validity checks, warning classification, and Myanmar region matching.

The application imports DMH warning data into the backend and renders the warning title, affected regions, validity and freshness directly inside the app. The UI no longer depends on sending users to the government website just to see the warning. Source attribution remains visible, and original bulletin URLs are retained in the backend record for auditability.

## Google Flood Hub

Myanmar is included in Google's listed Flood Hub coverage. The Flood Forecasting API provides real-time riverine flood status and daily hydrologic forecasts up to a 7-day horizon. API access is currently limited to pilot participants; therefore this repository does **not** fabricate API data when a key is unavailable.

https://support.google.com/flood-hub/answer/16364306

When API access is not configured, the app links the user to the public Flood Hub and continues using available official/local data.

## Free/open-first provider strategy

The application is designed to remain useful without paid APIs:

1. DMH official public information for Myanmar warnings and source links
2. Open-Meteo for forecast and air-quality data
3. ERA5 reanalysis climate context via Open-Meteo
4. Google Flood Hub when API access is available
5. Local caches and stale-data indicators when upstream services fail

No provider secret is embedded in the frontend.

## Run locally

### Python

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
uvicorn main:app --reload
```

Windows PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
pytest
uvicorn main:app --reload
```

Open `http://127.0.0.1:8000/`.

### Docker

```bash
docker build -t myanmar-weather .
docker run --rm -p 8000:8000 myanmar-weather
```

## API

- `GET /health` — liveness check
- `GET /api/status` — public deployment/source summary
- `GET /api/weather` — forecast proxy
- `GET /api/geocode` — geocoding fallback
- `GET /api/mimu-search` — offline Myanmar location search
- `GET /api/dmh` — DMH source discovery metadata
- `GET /api/dmh/alerts` — ingested DMH warnings for the selected location
- `GET /api/hospitals/nearest` — nearby hospital lookup
- `GET /api/v1/risk` — full risk assessment
- `GET /api/v1/what-matters-today` — concise home-screen intelligence
- `GET /api/v1/alerts` — official + model alerts
- `GET /api/v1/official-alerts` — stored official warnings and importer status
- `GET /api/v1/hazards` — hazard signals
- `GET /api/v1/health-risk` — health-category signals
- `GET /api/v1/climate` — climate context
- `GET /api/v1/agriculture-risk` — agriculture conditions only
- `GET /api/v1/status` — provider and engine status

## Production requirements

For a single small deployment, the built-in bounded cache is sufficient. For a multi-instance deployment:

- Put FastAPI behind HTTPS/reverse proxy.
- Replace process-local caches with Redis or another shared cache.
- Persist DMH importer state on durable storage.
- Use a durable database for notification subscriptions if background Web Push is enabled.
- Set explicit CORS origins.
- The built-in per-IP rate limit (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW`, default 120 req/60s) is in-process only; behind multiple instances, move it to a shared store (Redis) or a reverse-proxy-level limiter.
- Run the risk engine in production mode so only approved rules execute.
- Monitor `/health` and `/api/status`.

See `docs/ARCHITECTURE.md`, `docs/UX_SYSTEM.md`, and `docs/DATA_SOURCES.md`.

## Testing

The repository regression suite covers provider fallback/stale-cache behavior, location resolution, official alert matching, security headers, schema metadata and health status.

```text
18 passed
```

The v6.7 weather endpoint also collapses concurrent refreshes for the same rounded coordinate, so several dashboard panels reconnecting at once share one upstream refresh instead of multiplying provider requests.

CI also checks Python syntax and frontend JavaScript syntax across supported Python versions.

## Repository structure

```text
.
├── main.py
├── VERSION
├── app/
│   ├── app.py
│   ├── api.py
│   ├── providers.py
│   ├── state.py
│   └── web.py
├── i18n/
│   ├── my.json
│   ├── en.json
│   ├── scales.json
│   └── weather_codes.json
├── weather.html
├── weather_script.js        (entry: search, location loading, tabs)
├── core.js, net.js, render_cards.js, ...   (ES modules, see docs/ARCHITECTURE.md)
├── styles.css
├── notifications.js
├── risk_panel.js
├── sw-version.js
├── sw.js
├── manifest.json
├── risk_engine/
│   ├── api.py
│   ├── dmh_importer.py
│   ├── providers.py
│   ├── engine.py
│   ├── rules.py
│   └── ...
├── data/
├── tests/
├── .github/workflows/ci.yml
├── Dockerfile
└── THIRD_PARTY_NOTICES.md
```

## License

Application code: MIT. External datasets, services, maps and provider data remain subject to their own licenses and terms. See `THIRD_PARTY_NOTICES.md`.


## Weather data: Open-Meteo first

`/api/weather` uses **Open-Meteo** (forecast + air quality) as the only primary source. The backend:

1. asks Open-Meteo (3 attempts for the forecast, retrying 429/5xx with back-off; air quality is best-effort);
2. only if that fails, tries the fallbacks in order: **WeatherAPI**, then **OpenWeatherMap** (each only when its key is set);
3. if every provider is down, serves the last good copy (up to `WEATHER_STALE_TTL`, default 6 h) marked `meta.stale = true`;
4. never averages numbers from different providers.

Responses are cached per ~1 km cell for `WEATHER_CACHE_TTL` seconds (default 900). `meta.provider`, `meta.fallback`, `meta.stale` and `failed_providers` tell the UI which source it got. Provider keys are backend-only environment variables: never put them in `weather.html`, JavaScript, or a committed `.env`.

Open-Meteo's free API is for **non-commercial** use and requires attribution; see `THIRD_PARTY_NOTICES.md`. For commercial use, get an Open-Meteo API plan.

Place search (`/api/mimu-search`) is served from the local MIMU gazetteer (towns, villages, and townships, Burmese or English).

## Development

```bash
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q          # offline tests, no network needed
HOST=0.0.0.0 ./start-linux.sh  # reach it from a phone on the same Wi-Fi
```


## v6.3.0 engineering/UX refresh

- Calm, device-neutral visual system with semantic alert colours
- Phone-first safe-area handling, touch targets and fixed mobile navigation
- Reduced-copy hierarchy: weather → rain → important alert → detail
- Accessibility metadata, skip link, focus states and reduced-motion support
- GitHub hygiene: CI permissions, compile checks, `.gitattributes`, security and contribution guidance
- Explicit architecture/data-source documentation for long-term maintenance
- Generated Python cache files removed from the distributable repository

The project intentionally avoids age/gender-specific visual styling. It uses contrast, hierarchy and predictable interaction patterns instead of decorative complexity.

### Hospital data

The app already ships with `data/hospitals.db` and the hospital tab reads it through `/api/hospitals/nearest`. The bundled dataset is MIMU/CDE-Myanmar (2020), not DOMS. For a new verified dataset, use `data/hospitals.example.csv` as the schema and `python3 tools/import_hospitals.py data/hospitals.csv --replace`. The importer validates IDs, names, and coordinates before replacing the table.


### v6.7.4 reliability correction

Removed the three automatic decision cards (drier window, outdoors, travel). The 7-day forecast is now data-first: date, condition text, high/low temperature, rain probability and precipitation amount.

### v6.7.4 critical fixes

- `start-linux.sh` is shipped executable (`0755`).
- Release archives exclude `__pycache__`, `*.pyc`, and `.pytest_cache`.
- Browser weather loading is backend-controlled; the frontend no longer bypasses `/api/weather` with a direct Open-Meteo request. Provider fallback, stale-cache handling, and provenance remain centralized in the API.

> Hosting on Ubuntu: see [docs/UBUNTU_SERVER.md](docs/UBUNTU_SERVER.md) (systemd + Caddy HTTPS files in `deploy/ubuntu/`).

> Hazard feeds and RIMES notes: [docs/RIMES.md](docs/RIMES.md). Pull them yourself with `python tools/pull_feeds.py`.


### RIMES-first setup

RIMES is the preferred forecast provider when an authorised server-side endpoint is available. Copy `.env.example` to `.env` and set `RIMES_API_URL` (and `RIMES_API_TOKEN` if your RIMES/DMH service requires one). Do not commit credentials. The app falls back to public providers when RIMES is unavailable.


### 6.9 agriculture + accessibility update
- Agricultural zone resolution is location-aware and does not force mixed regions into one zone.
- Bago/Naypyitaw transition areas expose uncertainty instead of presenting false precision.
- Text-size controls (A− / 100% / A+) are saved locally for older users.
- Slow connections defer secondary forecast panels until the user opens them.
- Weather and recent-location caches continue to provide a usable offline/stale view.
