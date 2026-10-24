# RIMES and Myanmar data - what is possible

## What I could verify (2026-10-04)
- RIMES (Regional Integrated Multi-Hazard Early Warning System, Bangkok) runs **DataEx** at https://dataex.rimes.int:
  observation data sharing plus forecast products (ECMWF HRES/ENS/SEAS, seasonal multi-model, IMD WRF, UKMO,
  NetCDF subsets, lightning). Its menus include *Profile*, *Alerts* and *Log Out*, so **it needs an account**.
- I found no public, documented API or open-licence statement for DataEx, and no Myanmar CAP feed from DMH in the WMO
  material I could reach. So this app does **not** scrape DataEx: that would mean using someone else's login or breaking
  their terms, and ECMWF-derived products carry redistribution conditions.
- "Free for Myanmar" is plausible because Myanmar is a RIMES Member State, but access is arranged through RIMES / DMH,
  not by an anonymous download.

## What is wired in instead (free, keyless, documented)
| Source | What | Code |
|---|---|---|
| USGS earthquake catalog | quakes M>=4 in the last 14 days in/near Myanmar | `risk_engine/feeds.py::fetch_usgs` |
| GDACS | orange/red earthquake, tropical-cyclone (Bay of Bengal) and flood events | `fetch_gdacs` |
| GloFAS via Open-Meteo Flood API | river-discharge outlook for the largest river near a place (a trend, not a flood warning) | `fetch_glofas` |
| Open-Meteo Marine API | wave height / period outlook on the coast (hidden inland) | `fetch_marine` |
| Open-Meteo forecast API | 7-day rain minus reference evapotranspiration (ET0) and top-soil moisture, for the Farming tab | `fetch_field_water` |

Shown in the Alerts tab ("International sources") and the Flood tab (river outlook), always labelled as automatic
international products and not DMH warnings. Free for non-commercial use: check each provider's terms before a commercial launch.
Pull from the command line or cron: `python tools/pull_feeds.py --lat 21.96 --lon 96.09 --out data/feeds_snapshot.json`.

## If you get a RIMES DataEx account
Send me (a) what the account allows (file download, API, scheduled e-mail), (b) one sample file or the API page, and
(c) the terms of use. Then a new source goes into `risk_engine/feeds.py` (parser + fetcher + one line in `SOURCES`) with
tests, using credentials from environment variables, never stored in the repo. Contact for access: support@rimes.int
or your DMH focal point.


## Project integration decision (2026-10-04)

The application now has a **RIMES-first adapter** in `risk_engine/rimes.py`. It is intentionally credential-free in the repository: the endpoint and token are environment variables. This means the app can switch to an authorised RIMES/DMH service without another code rewrite.

The runtime priority is:

1. RIMES authorised endpoint (if configured)
2. Open-Meteo public forecast
3. WeatherAPI, then OpenWeatherMap, only when their keys are configured
4. last-good cached forecast if all providers fail

Each response records the provider in `meta.provider`; provider outputs are never blended or silently averaged.


## Agriculture integration decision

RIMES is treated as an important methodological reference for the farming layer because its Myanmar work explicitly included agro-ecological zoning, crop-weather calendars, agro-meteorological bulletins, and an agro-advisory expert system. The app still avoids claiming that a broad four-zone classification is a township soil map. Location-level results therefore expose confidence and transition notes.
