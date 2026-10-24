# Running on an Ubuntu server

## Why HTTPS matters here
Browsers only allow GPS ("current location"), the offline service worker and notifications on **HTTPS** (or on
`localhost` / `127.0.0.1`). If you open the site over plain `http://SERVER-IP:8000` from another device, those three
features silently do not work. So put a domain and HTTPS in front of it.

## Steps
```bash
sudo apt update && sudo apt install -y python3-venv python3-pip caddy
cd ~ && unzip myanmar-weather-v<VERSION>.zip -d myanmar-weather && cd myanmar-weather
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env        # then edit: set ALLOWED_ORIGINS=https://YOUR-DOMAIN and TRUST_PROXY_HEADERS=true
.venv/bin/python -m pytest -q   # optional (pip install -r requirements-dev.txt first)
```
1. Copy `deploy/ubuntu/myanmar-weather.service` to `/etc/systemd/system/`, fix `USERNAME`/paths, then
   `sudo systemctl daemon-reload && sudo systemctl enable --now myanmar-weather`.
2. Copy `deploy/ubuntu/Caddyfile` to `/etc/caddy/Caddyfile`, set your domain, then `sudo systemctl reload caddy`.
3. Open ports 80 and 443 (`sudo ufw allow 80,443/tcp`). Do **not** open 8000: the app listens only on 127.0.0.1.

## Settings that matter
| Variable | Value | Why |
|---|---|---|
| `TRUST_PROXY_HEADERS` | `true` behind Caddy/nginx only | otherwise every visitor shares the proxy's IP and the rate limit applies to everyone together |
| `ALLOWED_ORIGINS` | `https://your-domain` | CORS for a public site |
| `WEB_CONCURRENCY` | `1` | rate limit and caches are per process |

## Check it works
```bash
systemctl status myanmar-weather --no-pager
curl -s http://127.0.0.1:8000/health
curl -sI https://YOUR-DOMAIN/styles.css | grep -i cache-control    # expect: no-cache
python tools/live_check.py                                          # real Open-Meteo call, needs internet
journalctl -u myanmar-weather -f                                    # live logs
```
After you update the files, restart with `sudo systemctl restart myanmar-weather` and hard-refresh the browser once.
