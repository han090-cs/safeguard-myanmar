# Free deployment: GitHub + Render + Google Search

## 1. GitHub
Create a public GitHub repository and push this project to the `main` branch.
Do not commit secrets. Put API keys only in Render environment variables.

## 2. Render
Use **New → Blueprint** and select the repository. `render.yaml` creates one FastAPI Web Service.

Recommended free settings:
- Plan: Free
- Health check: `/health`
- `WEB_CONCURRENCY=1`
- `WEATHER_MODEL=ecmwf_ifs`
- `RISK_ENGINE_MODE=production`
- `ALLOWED_ORIGINS=https://YOUR-SERVICE.onrender.com`
- `PUBLIC_BASE_URL=https://YOUR-SERVICE.onrender.com`

After the first deploy, replace `YOUR-SERVICE` with the actual Render hostname and redeploy.

## 3. Google Search Console
1. Open Google Search Console.
2. Add the public Render URL as a URL-prefix property, or verify a custom domain if you later add one.
3. Open URL Inspection and test `/`.
4. Request indexing after the live page is accessible.
5. Submit `/sitemap.xml` in Sitemaps.
6. Monitor Pages/Indexing, Core Web Vitals, HTTPS, and any structured-data reports.

Indexing is not instant and Google does not guarantee a particular ranking or indexing time.

## 4. Important Free-plan limitation
Render Free services can spin down after 15 minutes of inactivity and can take about a minute to wake. Their local filesystem is ephemeral. This project therefore treats the bundled MIMU/hospital SQLite files as read-only source data and does not depend on runtime filesystem writes for persistence.

For real public traffic at 10k+ concurrent users, move to multiple instances/load balancing and shared cache/rate-limit infrastructure rather than assuming the free single instance can carry that load.

> **Behind a proxy / hosting (Render, Fly, Nginx):** set `TRUST_PROXY_HEADERS=true`, otherwise all visitors share one IP and the rate limit (default 120 API calls/min) applies to everyone together. `render.yaml` already sets it. Do not enable it when the app is exposed directly to the internet.
