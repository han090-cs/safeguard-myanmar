"""Stop pytest early with one clear message when the packages are not installed (instead of 17 collection errors)."""
import pytest

from _preflight import message, missing_packages

_missing = missing_packages()
if _missing:
    pytest.exit(message(_missing), returncode=2)
