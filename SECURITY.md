# Security

Please do not commit API keys, cookies, access tokens, private URLs, or `.env` files.

## Reporting a vulnerability

For a security issue, open a private GitHub security advisory when the repository is published. Do not disclose exploitable details in a public issue.

## Deployment basics

- Use HTTPS in production.
- Set explicit `ALLOWED_ORIGINS`.
- Keep provider secrets server-side.
- Keep the built-in rate limit enabled.
- Do not treat model-generated weather signals as official emergency warnings.

## Crash notes (the one endpoint that records anything)

`GET /api/client-error` (sent by `error_report.js`) writes one line to the server log when the page hits a script error: error kind and text,
file and line, language, tab, browser family + system (for example `Chrome/Android`) and the server version.
It has no place, no coordinates, no saved data and no IP address; URLs and coordinate-like numbers are removed from the text on the page and again on the server.
It is a GET so every other method stays refused, it counts against the normal rate limit, the server keeps at most `CLIENT_ERROR_MAX` (default 60) lines per 10 minutes,
and nothing is sent when the browser has Do Not Track / Global Privacy Control on or the device is offline. On Vercel the lines appear under Runtime Logs
(search `client-error`). The privacy wording is in `legal.html` and the About dialog (`about.js`): keep them in step when this changes.

## Leaf photo route (the one POST)

`POST /api/v1/leaf` is the only write the API accepts. It exists for the optional "AI second look" in the Lab tab. **Since v9.27 each visitor pays with their own Anthropic key**: the Lab has a separate card where they paste it, and the page sends it in the `X-User-Api-Key` header with each check. The owner's `ANTHROPIC_API_KEY` is **not** used for visitors unless the owner also sets `SG_LEAF_SHARE_SERVER_KEY=1` (a private demo, a school or a co-op that pays for its members). `GET /api/v1/leaf/status` tells the page `{enabled, byok, per_hour, byok_per_hour}`: `enabled` = the owner shares a key, `byok` = the route exists (`SG_LEAF_AI` is not `0`).

- Narrow exception in the request guard (`app/app.py`): only that path, only `Content-Type: application/json` (else 415), a `Content-Length` is required (else 411) and at most 3,200,000 bytes (else 413). Every other non-GET request is still 405.
- CORS stays GET-only, so another website cannot call the route from a browser.
- The list of diseases the model may name comes from the server's own pest guide (`pests.js`) for the chosen crop; the page cannot add to it, and the answer is filtered back to that list.
- The image is checked by its magic bytes (JPEG, PNG or WebP) and size, and is never written to disk or logged. The key, the photo and the provider's reply text are never logged or sent back to the visitor: failures are the generic `unavailable`, `busy` or `off`.
- A visitor's key: only the header is read (a key in the URL or the body is ignored). It must look like an Anthropic key (`sk-ant-` plus 16-256 letters, digits, `_` or `-`) or the answer is 401 `bad_key` before anything is called; no key and no shared owner key is 401 `need_key`. The server forwards that one call to Anthropic and forgets the key: it is never stored, logged, put in a URL or echoed in any response, including errors. Anthropic refusing the key (401/403) is reported as `bad_key` so the visitor can fix it; every other failure stays the generic `unavailable`, `busy` or `off`. In the browser it lives in `sessionStorage` (until the tab closes) or, only when the visitor ticks "Remember on this device", in `localStorage` (`mw_leaf_key_v1`); it is never in the Leaf check log, the CSV, a URL or the page text (only the last four characters are shown). The field is a password input outside a `<form>` so the browser does not offer to store it. The cost of a check made with a visitor's key is theirs, so only a per-visitor hourly limit applies to it (`SG_LEAF_BYOK_PER_HOUR`, default 30, protects this server from being hammered) and it does not count against the owner's daily budget.
- Budgets for the owner's shared key (only with `SG_LEAF_SHARE_SERVER_KEY=1`): `SG_LEAF_PER_IP_HOUR` (default 10) per visitor and `SG_LEAF_DAILY_MAX` (default 300) per day, kept in memory (best effort per server instance); over the limit gives 429 with `visitor` or `day`. `SG_LEAF_AI=0` switches the route off for everyone. The normal API rate limit applies as well.
- The page policy adds `'wasm-unsafe-eval'` to `script-src` so the on-device photo check can run WebAssembly. Inline scripts and inline styles stay blocked.
- If the owner shares a key, set a spending limit at the AI provider as well; the budgets above reset when a serverless instance restarts. Visitors are told on the key card to treat the key like a password and to create one with a spending limit.
