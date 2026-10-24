# Public launch checklist

Before sharing the link:

1. **Environment** (`.env` or the host dashboard): `PUBLIC_BASE_URL=https://your-domain`, `ALLOWED_ORIGINS=https://your-domain`,
   `TRUST_PROXY_HEADERS=true` (already set in `deploy/ubuntu/myanmar-weather.service` and `render.yaml`).
   Without the proxy setting every visitor would share one rate-limit bucket.
2. **Health**: `curl https://your-domain/health` returns 200; `curl https://your-domain/api/enso` shows `"stale": false`.
3. **Share preview**: paste the link into Facebook Messenger / Telegram; the card shows `og-image.png`. Platforms cache previews,
   so check it once before the announcement.
4. **Live data** (needs internet): `python tools/live_check.py` confirms Open-Meteo rain, temperature, UV and AQI come back.
5. **Phone check**: open on a real phone, pick a place, switch Today / Forecast / Compare / Farming, switch language, go offline.
6. **After launch**: update `data/enso_status.json` after each NOAA ENSO discussion (next: 2026-11-12); the card warns
   visitors when it is more than 45 days old or the next update is more than 7 days overdue.
7. **Load**: one worker (`WEB_CONCURRENCY=1`) keeps the in-memory rate limiter and caches consistent. Default limit is
   120 API calls per visitor per minute (`RATE_LIMIT_MAX`).
