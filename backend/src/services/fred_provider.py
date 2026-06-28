"""FRED (Federal Reserve Economic Data) observations provider.

Fetches a single series via the FRED REST API using a synchronous ``httpx``
client (httpx is already a dependency). Results are cached in the shared
in-process TTLCache so the real FRED endpoint is hit at most a few times per day,
and the last good payload is kept as a ``stale`` fallback when a fetch fails.

FRED dates are US calendar dates; we keep them as-is (no timezone conversion).
"""
from __future__ import annotations

import logging
import os

import httpx

from .cache import cache

logger = logging.getLogger(__name__)

FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations"

# FRED daily series update at most once per business day; a 6h TTL keeps live
# data fresh while collapsing repeated requests within a session.
_FRED_TTL_SECONDS = 6 * 3600
# Stale fallback is kept much longer so a transient outage still serves data.
_FRED_STALE_TTL_SECONDS = 14 * 24 * 3600
_HTTP_TIMEOUT_SECONDS = 15.0


class MissingFredKey(RuntimeError):
    """Raised when FRED_API_KEY is not configured."""


def get_fred_api_key() -> str:
    key = os.environ.get("FRED_API_KEY", "").strip()
    if not key:
        raise MissingFredKey("FRED_API_KEY is not set")
    return key


def _safe_value(raw: object) -> float | None:
    """FRED encodes missing observations as '.'; convert everything else."""
    if raw is None or raw == ".":
        return None
    try:
        return float(raw)  # type: ignore[arg-type]
    except (ValueError, TypeError):
        return None


def _parse_observations(payload: dict) -> list[dict]:
    """Map FRED observations JSON → [{'date': 'YYYY-MM-DD', 'value': float}]."""
    out: list[dict] = []
    for obs in payload.get("observations", []):
        value = _safe_value(obs.get("value"))
        date = obs.get("date")
        if value is None or not date:
            continue
        out.append({"date": date, "value": value})
    return out


def fetch_fred_series(series_id: str, start: str, end: str) -> list[dict]:
    """Return the FRED observation series, using cache + stale fallback.

    Raises ``MissingFredKey`` if no API key is configured (callers decide how to
    surface partial availability). Network/empty failures fall back to the last
    cached value with ``stale`` semantics handled by the caller via the returned
    list being the previous payload; an empty list means no data at all.
    """
    api_key = get_fred_api_key()  # may raise MissingFredKey

    cache_key = f"fred:{series_id}:{start}:{end}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    params = {
        "series_id": series_id,
        "api_key": api_key,
        "file_type": "json",
        "observation_start": start,
        "observation_end": end,
    }

    try:
        with httpx.Client(timeout=_HTTP_TIMEOUT_SECONDS) as client:
            res = client.get(FRED_BASE_URL, params=params)
            res.raise_for_status()
            payload = res.json()
    except (httpx.HTTPError, ValueError) as e:
        logger.warning("FRED fetch failed for %s: %s", series_id, e)
        stale = cache.get(f"fred:stale:{series_id}")
        return stale if stale is not None else []

    observations = _parse_observations(payload)
    if not observations:
        logger.warning("FRED returned no usable observations for %s", series_id)
        stale = cache.get(f"fred:stale:{series_id}")
        return stale if stale is not None else []

    cache.set(cache_key, observations, _FRED_TTL_SECONDS)
    cache.set(f"fred:stale:{series_id}", observations, _FRED_STALE_TTL_SECONDS)
    return observations
