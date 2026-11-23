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

## Vercel: every push to GitHub redeploys by itself

Once the repository is imported in Vercel (Add New → Project → pick the repo), there is nothing else to set up:

- a push to the **Production Branch** (Settings → Git, normally `main`) builds and publishes the live site;
- a push to any other branch or a pull request gets its own **Preview** URL, so a change can be tried before it goes live;
- the browser bundles (`views*.js`, `vchunk-*.js`) are committed, so Vercel needs no Node build.

Checklist after each push: the GitHub "CI" run is green (lint, tests, browser tests), then Vercel → Deployments shows "Ready".
If `ALLOWED_HOSTS` is set, add your preview domain too, otherwise Preview URLs answer "Invalid host header".
To avoid publishing an unchecked change, work on a branch, wait for the green CI tick, then merge it into `main`.

### Vercel: official DMH warnings and storm news (v9.25)

Vercel runs the site as short-lived functions, so the importer that reads the DMH website (moezala.gov.mm) cannot keep
running there (the in-process importer is switched off automatically when `VERCEL` is set). Instead, a scheduled GitHub
workflow, `.github/workflows/dmh-import.yml`, reads DMH about every 20 minutes and publishes two small JSON files as
assets of a release named **dmh-data**. The site downloads them (cached 5 minutes), so warnings and the DMH Top
Announcement storm news update **without a new deployment**. The workflow commits nothing, so Vercel is not redeployed
and the 100-deployments-per-day limit is not touched.

One-time setup:

1. The repository must be **public** (the site downloads the release files without a login).
2. GitHub → repository → **Actions** → if it says workflows are disabled, enable them. Settings → Actions → General →
   Workflow permissions can stay on the default; the workflow asks for `contents: write` itself.
3. Actions → **DMH import** → **Run workflow** (do not wait for the schedule). Open the run: all steps green means DMH
   was read and the files were published. The repository's **Releases** page now has "DMH data (updated automatically)".
4. Open `https://<your-site>/api/v1/official-alerts`: `source_status.update_mode` is `"remote"` and `last_success_at`
   is a few minutes old.

If the run is red: the last step, "Fail loudly if DMH could not be read", prints why (for example DMH not answering
GitHub's servers). GitHub e-mails the repository owner about failed scheduled runs. The site keeps showing the last good
snapshot and, after 3 hours without a good read, the "not refreshed recently" note.

Good to know: GitHub can start scheduled runs 10–30 minutes late; it pauses scheduled workflows after 60 days without any
repository activity (a push, or "Enable workflow" on the Actions page, starts it again). Settings: `DMH_DATA_URL` (a
different base URL, or `off`), `DMH_DATA_TTL_S` (default 300), `DMH_STALE_AFTER_MIN` (default 180 with the snapshot).
Not tested against the live DMH site or GitHub from the build environment (its network blocks them); the parsers and the
publishing path are tested with sample pages and a fake server, so the first workflow run is the real check.

## 4. Important Free-plan limitation
Render Free services can spin down after 15 minutes of inactivity and can take about a minute to wake. Their local filesystem is ephemeral. This project therefore treats the bundled MIMU/hospital SQLite files as read-only source data and does not depend on runtime filesystem writes for persistence.

For real public traffic at 10k+ concurrent users, move to multiple instances/load balancing and shared cache/rate-limit infrastructure rather than assuming the free single instance can carry that load.

> **Behind a proxy / hosting (Render, Fly, Nginx):** set `TRUST_PROXY_HEADERS=true`, otherwise all visitors share one IP and the rate limit (default 120 API calls/min) applies to everyone together. `render.yaml` already sets it. Do not enable it when the app is exposed directly to the internet.

## Security settings (all optional, safe defaults)
- `ALLOWED_HOSTS=your-site.vercel.app,localhost,127.0.0.1` — rejects requests with a forged Host header. Leave unset only while testing.
- `TRUSTED_PROXY_HOPS=1` (or 2 if two proxies, e.g. Cloudflare + host) — the visitor IP is taken that many entries from the right of `X-Forwarded-For`, so a visitor cannot fake their IP to dodge the rate limit. If unset and `TRUST_PROXY_HEADERS=true`, the old (forgeable) leftmost entry is used.
- `RATE_LIMIT_MAX` (default 600/min) counts every API call; `RATE_LIMIT_EXPENSIVE_MAX` (default 240/min) counts only calls that reach outside services (weather, climate, geocode, alerts…).
- The API accepts GET/HEAD/OPTIONS only (one narrow exception: `POST /api/v1/leaf`, see `SECURITY.md`) and refuses query strings over 2048 characters.

## Optional: AI second look in the Leaf check (Lab tab)

The Lab tab's leaf check works without any setup: a sign checklist (offline) and, for rice, potato and cucurbit, a photo check that runs on the visitor's phone
(first use downloads about 14 MB, then it is kept). The photo never leaves the phone for these two.

An extra **AI second look** (any crop) runs on **each visitor's own Anthropic key** (v9.27): the Lab has a separate card where they paste it, so you pay nothing and your key is never used for visitors. It sends the photo (not the location) to Anthropic for one answer, which the page shows next to the other two looks. You do not need to set anything for this. Only if you want visitors to use *your* key (a demo, a school, a co-op that pays) set both `ANTHROPIC_API_KEY` and `SG_LEAF_SHARE_SERVER_KEY=1`.

| variable | default | meaning |
|---|---|---|
| `SG_LEAF_AI` | on | set `0` to switch the AI route and the key card off for everyone |
| `SG_LEAF_BYOK_PER_HOUR` | 30 | checks per visitor per hour with the visitor's own key (protects your server, costs you nothing at the provider) |
| `SG_LEAF_MODEL` | `claude-sonnet-5-5` | model used for the second look |
| `ANTHROPIC_API_KEY` | unset | **your** key. Not used for visitors unless the next line is also set; keep it in the host's environment settings only |
| `SG_LEAF_SHARE_SERVER_KEY` | off | set `1` to let visitors without a key use `ANTHROPIC_API_KEY` |
| `SG_LEAF_PER_IP_HOUR` | 10 | shared key only: calls per visitor per hour |
| `SG_LEAF_DAILY_MAX` | 300 | shared key only: calls per day, all visitors |

Calls made with a visitor's own key cost you nothing. If you share your key, each call costs money at the provider: set a monthly spending limit in the provider's console. The per-visitor and per-day limits are kept in server memory, so on a serverless host they are best effort (each instance counts for itself and a restart resets them).
Nothing about the photo is saved or logged by the server. See `SECURITY.md` ("Leaf photo route").
