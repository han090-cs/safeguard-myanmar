"""In-process operational metrics for /api/v1/diagnostics (not public).

Deliberately small: counters and recent-latency summaries kept in memory, reset on restart. No request
contents, coordinates or client addresses are recorded.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone

_SAMPLES = 500           # latency samples kept per series (most recent)


class Metrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.started_at = datetime.now(timezone.utc)
        self.counters: dict[str, int] = defaultdict(int)
        self._lat: dict[str, deque] = defaultdict(lambda: deque(maxlen=_SAMPLES))
        self.last_errors: dict[str, dict] = {}

    def inc(self, name: str, n: int = 1) -> None:
        with self._lock:
            self.counters[name] += n

    def observe(self, series: str, seconds: float) -> None:
        with self._lock:
            self._lat[series].append(seconds)

    def error(self, where: str, exc: BaseException | str) -> None:
        msg = exc if isinstance(exc, str) else f"{type(exc).__name__}: {exc}"
        with self._lock:
            self.counters[f"errors.{where}"] += 1
            self.last_errors[where] = {"at": datetime.now(timezone.utc).isoformat(), "error": msg[:300]}

    @staticmethod
    def _summary(vals) -> dict:
        s = sorted(vals)
        if not s:
            return {"n": 0}

        def q(p):
            return round(s[min(len(s) - 1, int(p * (len(s) - 1) + 0.5))] * 1000, 1)
        return {"n": len(s), "p50_ms": q(0.5), "p95_ms": q(0.95), "max_ms": round(s[-1] * 1000, 1)}

    def snapshot(self) -> dict:
        with self._lock:
            return {"started_at": self.started_at.isoformat(),
                    "uptime_s": round((datetime.now(timezone.utc) - self.started_at).total_seconds()),
                    "counters": dict(sorted(self.counters.items())),
                    "latency": {k: self._summary(v) for k, v in sorted(self._lat.items())},
                    "last_errors": dict(self.last_errors)}

    def reset(self) -> None:
        with self._lock:
            self.counters.clear()
            self._lat.clear()
            self.last_errors.clear()


METRICS = Metrics()


class timer:
    """with timer("upstream.forecast"): ..."""

    def __init__(self, series: str):
        self.series = series

    def __enter__(self):
        self.t = time.perf_counter()
        return self

    def __exit__(self, *exc):
        METRICS.observe(self.series, time.perf_counter() - self.t)
        return False
