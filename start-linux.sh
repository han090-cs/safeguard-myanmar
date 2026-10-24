#!/usr/bin/env bash
set -u
cd "$(dirname "$(readlink -f "$0")")" || exit 1
PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"   # use HOST=0.0.0.0 ./start-linux.sh to open it from your phone on the same Wi-Fi
URL="http://127.0.0.1:$PORT/"
VENV=".venv-linux"
PY="$(command -v python3 || true)"

pause() { if [ -t 0 ]; then read -r -p "Press Return to close." _; fi; }
fail() { echo; echo "!! $1"; pause; exit 1; }

echo "== Myanmar Weather"
echo "== Project: $(pwd)"

[ -n "$PY" ] || fail "python3 was not found. Install it with: sudo apt install python3 python3-venv"

# Prefer a usable system Python first. This avoids unnecessary PyPI access.
if "$PY" - <<'PY' >/dev/null 2>&1
mods = ("fastapi", "uvicorn", "httpx", "pydantic", "bs4", "dotenv")
for name in mods:
    __import__(name)
PY
then
    PYX="$PY"
    echo "== Using system Python: $($PYX --version)"
else
    echo "== Required packages are not all available in system Python."
    echo "== Creating an isolated environment: $VENV"
    if [ ! -x "$VENV/bin/python" ]; then
        "$PY" -m venv --system-site-packages "$VENV" \
          || fail "Could not create $VENV. On Debian/Ubuntu run: sudo apt install python3-venv"
    fi
    PYX="$VENV/bin/python"

    if ! "$PYX" - <<'PY' >/dev/null 2>&1
mods = ("fastapi", "uvicorn", "httpx", "pydantic", "bs4", "dotenv")
for name in mods:
    __import__(name)
PY
    then
        echo "== Missing Python packages; trying PyPI once..."
        if ! "$PYX" -m pip install --disable-pip-version-check -r requirements.txt; then
            echo
            echo "!! Python dependencies are missing and this machine cannot reach PyPI."
            echo "!! The earlier 'Temporary failure in name resolution' is a DNS/network problem, not a FastAPI version problem."
            echo
            echo "Try these checks:"
            echo "  ping -c 3 8.8.8.8"
            echo "  ping -c 3 pypi.org"
            echo
            echo "If 8.8.8.8 works but pypi.org fails, fix DNS/network and run this script again."
            pause
            exit 1
        fi
    fi
fi

# Verify the actual application imports before starting uvicorn.
"$PYX" - <<'PY' || fail "Application dependencies/imports are still incomplete."
import main
print("== Backend import: OK")
PY

if "$PYX" tools/launch_helper.py port-in-use "$PORT"; then
    echo "!! Port $PORT is already in use: $URL"
    command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL" >/dev/null 2>&1 || true
    pause
    exit 0
fi

"$PYX" tools/launch_helper.py open-when-ready "$URL" >/tmp/myanmar-weather-browser.log 2>&1 &
BROWSER_PID=$!
trap 'kill "$BROWSER_PID" 2>/dev/null || true' EXIT

echo "== Starting on $URL"
echo "== Open $URL if the browser does not open automatically."
[ "$HOST" = "0.0.0.0" ] && echo "== Phone: open http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT/ (same Wi-Fi)"
echo "== Stop with Ctrl+C"
exec "$PYX" -m uvicorn dev_server:app --host "$HOST" --port "$PORT" --workers "${WEB_CONCURRENCY:-4}"
