#!/usr/bin/env bash
# Show the site on a public HTTPS link from this computer using a free Cloudflare Quick Tunnel.
#   bash public_demo.sh            -> starts the site + the tunnel and prints the public link
# Needs: cloudflared (see docs/PUBLIC_DEMO.md). No Cloudflare account is needed.
# Ctrl+C stops everything and the link stops working.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8000}"
METRICS="127.0.0.1:20241"
PROTOCOL="${TUNNEL_PROTOCOL:-}"        # set TUNNEL_PROTOCOL=http2 if your network blocks UDP 7844

command -v cloudflared >/dev/null 2>&1 || { echo "cloudflared is not installed. See docs/PUBLIC_DEMO.md (step 1)."; exit 1; }
if [ -f "$HOME/.cloudflared/config.yaml" ]; then
  echo "!! $HOME/.cloudflared/config.yaml exists; Quick Tunnels misbehave with it. Move it aside first:"
  echo "   mv ~/.cloudflared/config.yaml ~/.cloudflared/config.yaml.bak"; exit 1
fi
if [ -x .venv/bin/python ]; then PY=.venv/bin/python; else PY="${PYTHON:-python3}"; fi
$PY -c 'import fastapi, httpx, uvicorn' 2>/dev/null || { echo "Python packages missing. Run:  bash setup_and_test.sh"; exit 1; }

PIDS=()
cleanup() { echo; echo "Stopping..."; for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

if curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "Site already running on port $PORT; reusing it."
else
  echo "Starting the site on 127.0.0.1:$PORT ..."
  $PY -m uvicorn main:app --host 127.0.0.1 --port "$PORT" --proxy-headers --forwarded-allow-ips="127.0.0.1" >/tmp/safeguard-site.log 2>&1 &
  PIDS+=($!)
  for _ in $(seq 1 40); do curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done
  curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 || { echo "Site did not start. See /tmp/safeguard-site.log"; exit 1; }
fi
echo "Site OK: $(curl -fs "http://127.0.0.1:$PORT/health")"

echo "Opening the tunnel ..."
ARGS=(tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" --metrics "$METRICS")
[ -n "$PROTOCOL" ] && ARGS+=(--protocol "$PROTOCOL")
cloudflared "${ARGS[@]}" >/tmp/safeguard-tunnel.log 2>&1 &
PIDS+=($!)

HOST=""
for _ in $(seq 1 60); do
  HOST=$(curl -fs "http://$METRICS/quicktunnel" 2>/dev/null | sed -n 's/.*"hostname":"\([^"]*\)".*/\1/p' || true)
  READY=$(curl -fs "http://$METRICS/ready" 2>/dev/null | grep -c '"readyConnections":[1-9]' || true)
  [ -n "$HOST" ] && [ "$READY" -ge 1 ] && break
  sleep 1
done
[ -n "$HOST" ] || { echo "Tunnel did not come up. See /tmp/safeguard-tunnel.log (try TUNNEL_PROTOCOL=http2)"; exit 1; }

echo
echo "=================================================="
echo "  PUBLIC LINK:  https://$HOST"
echo "=================================================="
echo "Open it on a phone using MOBILE DATA (not your Wi-Fi) to check. Keep this window open and the computer awake."
echo "Press Ctrl+C to stop."
wait
