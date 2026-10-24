#!/usr/bin/env bash
# One command to set up and check everything on Ubuntu/Debian/macOS:   bash setup_and_test.sh
# Why: "ModuleNotFoundError: No module named 'fastapi'" means the Python packages were never installed.
set -euo pipefail
cd "$(dirname "$0")"

PY="${PYTHON:-python3}"
echo "== Python: $($PY --version)"
if ! $PY -c 'import venv' 2>/dev/null; then
  echo "!! python3-venv is missing. On Ubuntu run:  sudo apt install python3-venv python3-pip"; exit 1
fi
if [ ! -d .venv ]; then $PY -m venv .venv; fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip >/dev/null
echo "== Installing Python packages (first time takes a minute)"
if ! python -m pip install -r requirements.txt -r requirements-dev.txt; then
  echo
  echo "!! Install failed. Python 3.14 is very new and some packages may have no build for it yet."
  echo "   Use Python 3.12 or 3.13 instead, e.g.:  PYTHON=python3.12 bash setup_and_test.sh   (rm -rf .venv first)"
  exit 1
fi

echo "== Python tests";   python -m pytest -q
echo "== Python lint";    python -m ruff check .
if command -v npm >/dev/null 2>&1; then
  echo "== JavaScript checks"
  [ -d node_modules ] || npm install --silent
  npx eslint --max-warnings 0 --ext .js .
  node tests/nature.test.mjs
  node tests/mm_calendar.test.mjs
  node tests/module_link_check.mjs | grep -v '^[Oo][Kk]' || true
  node tests/sw-freshness.mjs 2>&1 | grep -E '^# (pass|fail)'
else
  echo "(npm not found: skipping JavaScript checks. Install Node.js 20+ to run them.)"
fi
echo
echo "ALL CHECKS DONE. Start the site with:  bash public_demo.sh   (public link)   or   .venv/bin/python -m uvicorn main:app --port 8000"
