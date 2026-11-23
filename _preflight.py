"""Friendly check that runs before the app imports anything.

Typing `uvicorn main:app` or `pytest` with the system Python (no packages installed) used to end in a long
`ModuleNotFoundError: No module named 'httpx'` traceback. This turns it into one short, actionable message.
"""
import importlib.util
import sys

REQUIRED = {"fastapi": "fastapi", "uvicorn": "uvicorn", "httpx": "httpx", "pydantic": "pydantic",
            "bs4": "beautifulsoup4", "dotenv": "python-dotenv"}


def missing_packages() -> list[str]:
    return [pip for mod, pip in REQUIRED.items() if importlib.util.find_spec(mod) is None]


def message(missing: list[str]) -> str:
    return (
        "\n!! Missing Python packages: " + ", ".join(missing) + "\n"
        "!! ဒီ Python မှာ လိုတဲ့ package မရှိသေးပါဘူး။ (app ကိုယ်တိုင် မှားတာ မဟုတ်ပါ)\n\n"
        "Easiest / အလွယ်ဆုံး:   ./start-linux.sh      (Windows: start-windows.bat)\n\n"
        "Or by hand / ကိုယ်တိုင်လုပ်ရင်:\n"
        "  python3 -m venv .venv\n"
        "  .venv/bin/python -m pip install -r requirements-dev.txt\n"
        "  .venv/bin/python -m uvicorn main:app --reload\n"
        "  .venv/bin/python -m pytest -q\n\n"
        "Use .venv/bin/python (not the plain `uvicorn` / `pytest` commands) so the packages above are found.\n"
        "No internet for pip? Debian/Ubuntu: sudo apt install python3-fastapi python3-httpx python3-bs4 "
        "python3-dotenv uvicorn\n"
    )


def check() -> None:
    missing = missing_packages()
    if missing:
        sys.stderr.write(message(missing))
        raise SystemExit(2)


check()
