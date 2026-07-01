"""Macro dashboard endpoints (HY OAS / net liquidity / RSP-SPY / dashboard).

Mirrors quotes.py: synchronous routes, shared TTLCache, default date window.
Indicators degrade gracefully (FRED key missing -> unavailable) rather than 500,
so the dashboard keeps rendering the parts that work (partial availability).
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query

from ..config.macro_config import load_macro_config
from ..schemas.macro import DashboardResponse, IndicatorResponse
from ..services.cache import cache
from ..services.macro_provider import (
    build_brent_wti,
    build_dashboard,
    build_hy_oas,
    build_net_liquidity,
    build_nikkei_sp,
    build_nikkei_topix,
    build_rsp_spy,
)

router = APIRouter()

_DASHBOARD_TTL_SECONDS = 3600


def _default_start() -> str:
    cfg = load_macro_config()
    days = int(cfg.get("default_lookback_days", 730))
    return (date.today() - timedelta(days=days)).isoformat()


def _default_end() -> str:
    return date.today().isoformat()


def _resolve_window(start: str | None, end: str | None) -> tuple[str, str]:
    return start or _default_start(), end or _default_end()


@router.get("/macro/hy-oas", response_model=IndicatorResponse)
def get_hy_oas(start: str | None = Query(default=None), end: str | None = Query(default=None)):
    s, e = _resolve_window(start, end)
    cache_key = f"macro:hy-oas:{s}:{e}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    try:
        result = build_hy_oas(s, e)
    except Exception as exc:  # noqa: BLE001 - surface as 502 like quotes.py
        raise HTTPException(status_code=502, detail=f"Data fetch failed: {exc}")
    cache.set(cache_key, result, _DASHBOARD_TTL_SECONDS)
    return result


@router.get("/macro/net-liquidity", response_model=IndicatorResponse)
def get_net_liquidity(start: str | None = Query(default=None), end: str | None = Query(default=None)):
    s, e = _resolve_window(start, end)
    cache_key = f"macro:net-liquidity:{s}:{e}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    try:
        result = build_net_liquidity(s, e)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Data fetch failed: {exc}")
    cache.set(cache_key, result, _DASHBOARD_TTL_SECONDS)
    return result


@router.get("/macro/rsp-spy", response_model=IndicatorResponse)
def get_rsp_spy(start: str | None = Query(default=None), end: str | None = Query(default=None)):
    s, e = _resolve_window(start, end)
    cache_key = f"macro:rsp-spy:{s}:{e}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    try:
        result = build_rsp_spy(s, e)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Data fetch failed: {exc}")
    cache.set(cache_key, result, _DASHBOARD_TTL_SECONDS)
    return result


@router.get("/macro/nikkei-sp", response_model=IndicatorResponse)
def get_nikkei_sp(start: str | None = Query(default=None), end: str | None = Query(default=None)):
    s, e = _resolve_window(start, end)
    cache_key = f"macro:nikkei-sp:{s}:{e}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    try:
        result = build_nikkei_sp(s, e)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Data fetch failed: {exc}")
    cache.set(cache_key, result, _DASHBOARD_TTL_SECONDS)
    return result


@router.get("/macro/nikkei-topix", response_model=IndicatorResponse)
def get_nikkei_topix(start: str | None = Query(default=None), end: str | None = Query(default=None)):
    s, e = _resolve_window(start, end)
    cache_key = f"macro:nikkei-topix:{s}:{e}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    try:
        result = build_nikkei_topix(s, e)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Data fetch failed: {exc}")
    cache.set(cache_key, result, _DASHBOARD_TTL_SECONDS)
    return result


@router.get("/macro/brent-wti", response_model=IndicatorResponse)
def get_brent_wti(start: str | None = Query(default=None), end: str | None = Query(default=None)):
    s, e = _resolve_window(start, end)
    cache_key = f"macro:brent-wti:{s}:{e}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    try:
        result = build_brent_wti(s, e)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Data fetch failed: {exc}")
    cache.set(cache_key, result, _DASHBOARD_TTL_SECONDS)
    return result


@router.get("/macro/dashboard", response_model=DashboardResponse)
def get_dashboard(start: str | None = Query(default=None), end: str | None = Query(default=None)):
    s, e = _resolve_window(start, end)
    cache_key = f"macro:dashboard:{s}:{e}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    try:
        result = build_dashboard(s, e)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Data fetch failed: {exc}")
    cache.set(cache_key, result, _DASHBOARD_TTL_SECONDS)
    return result
