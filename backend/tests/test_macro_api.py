"""Integration tests for the /api/macro endpoints.

Providers (FRED/yfinance) are patched at their usage module
(``src.services.macro_provider``). The shared TTLCache is cleared between tests
so cached results from one test never leak into the next.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest

from src.services.cache import cache
from src.services.fred_provider import MissingFredKey

WIDE = "?start=2020-01-01&end=2030-01-01"


@pytest.fixture(autouse=True)
def _clear_cache():
    cache._store.clear()
    yield
    cache._store.clear()


def _fred_side_effect(series_id, start, end):
    data = {
        "BAMLH0A0HYM2": [
            {"date": "2026-01-07", "value": 3.0},
            {"date": "2026-01-14", "value": 3.2},
        ],
        "WALCL": [
            {"date": "2026-01-07", "value": 7_000_000},
            {"date": "2026-01-14", "value": 7_100_000},
        ],
        "RRPONTSYD": [
            {"date": "2026-01-06", "value": 400.0},
            {"date": "2026-01-13", "value": 400.0},
        ],
        "WTREGEN": [
            {"date": "2026-01-07", "value": 700.0},
            {"date": "2026-01-14", "value": 700.0},
        ],
    }
    return data.get(series_id, [])


def _ohlcv_side_effect(symbol, timeframe):
    t0, t1 = 1_700_000_000_000, 1_700_086_400_000
    if symbol == "RSP":
        return [{"t": t0, "c": 150.0}, {"t": t1, "c": 151.0}]
    if symbol == "SPY":
        return [{"t": t0, "c": 500.0}, {"t": t1, "c": 505.0}]
    return []


@pytest.mark.integration
def test_hy_oas_endpoint_shape(client):
    with patch("src.services.macro_provider.fetch_fred_series", side_effect=_fred_side_effect):
        res = client.get(f"/api/macro/hy-oas{WIDE}")
    assert res.status_code == 200
    body = res.json()
    assert body["indicator"] == "hy_oas"
    assert body["unit"] == "bp"
    assert body["series"][0]["value"] == 300.0  # 3.0% -> 300bp
    assert body["meta"]["available"] is True


@pytest.mark.integration
def test_net_liquidity_endpoint_shape(client):
    with patch("src.services.macro_provider.fetch_fred_series", side_effect=_fred_side_effect):
        res = client.get(f"/api/macro/net-liquidity{WIDE}")
    assert res.status_code == 200
    body = res.json()
    assert body["unit"] == "USD_trillion"
    assert body["series"][0]["value"] == pytest.approx(5.9, abs=0.001)
    assert body["latest"]["provisional"] is True


@pytest.mark.integration
def test_rsp_spy_endpoint_shape(client):
    with patch("src.services.macro_provider.fetch_ohlcv", side_effect=_ohlcv_side_effect):
        res = client.get(f"/api/macro/rsp-spy{WIDE}")
    assert res.status_code == 200
    body = res.json()
    assert body["unit"] == "ratio"
    assert len(body["series"]) == 2
    assert body["meta"]["available"] is True


@pytest.mark.integration
def test_dashboard_partial_when_fred_key_missing(client):
    """No FRED key -> hy-oas/net-liquidity unavailable, rsp-spy still works."""
    with patch(
        "src.services.macro_provider.fetch_fred_series",
        side_effect=MissingFredKey("no key"),
    ), patch("src.services.macro_provider.fetch_ohlcv", side_effect=_ohlcv_side_effect):
        res = client.get(f"/api/macro/dashboard{WIDE}")
    assert res.status_code == 200
    body = res.json()
    by_key = {i["indicator"]: i for i in body["indicators"]}
    assert by_key["hy_oas"]["meta"]["available"] is False
    assert by_key["net_liquidity"]["meta"]["available"] is False
    assert by_key["rsp_spy"]["meta"]["available"] is True


@pytest.mark.integration
def test_dashboard_survives_yfinance_failure(client):
    """yfinance 障害でも dashboard は 502 にならず、FRED カードは生き残る。"""

    def boom(symbol, timeframe):
        raise RuntimeError("yfinance down")

    with patch(
        "src.services.macro_provider.fetch_fred_series", side_effect=_fred_side_effect
    ), patch("src.services.macro_provider.fetch_ohlcv", side_effect=boom):
        res = client.get(f"/api/macro/dashboard{WIDE}")
    assert res.status_code == 200
    body = res.json()
    by_key = {i["indicator"]: i for i in body["indicators"]}
    assert by_key["hy_oas"]["meta"]["available"] is True
    assert by_key["net_liquidity"]["meta"]["available"] is True
    assert by_key["rsp_spy"]["meta"]["available"] is False


@pytest.mark.integration
def test_dashboard_overall_signal_aggregation(client):
    with patch(
        "src.services.macro_provider.fetch_fred_series", side_effect=_fred_side_effect
    ), patch("src.services.macro_provider.fetch_ohlcv", side_effect=_ohlcv_side_effect):
        res = client.get(f"/api/macro/dashboard{WIDE}")
    assert res.status_code == 200
    body = res.json()
    assert body["overall_signal"] in {"green", "yellow", "red", "gray"}
    assert len(body["indicators"]) == 3


@pytest.mark.integration
def test_fred_stale_fallback_on_fetch_failure(monkeypatch):
    """Network failure with a cached value returns the stale payload."""
    import httpx

    from src.services import fred_provider

    monkeypatch.setenv("FRED_API_KEY", "dummy-key")
    cache._store.clear()
    stale_payload = [{"date": "2026-01-07", "value": 3.0}]
    cache.set("fred:stale:BAMLH0A0HYM2", stale_payload, 3600)

    def boom(*args, **kwargs):
        raise httpx.ConnectError("network down")

    monkeypatch.setattr(httpx.Client, "get", boom)
    result = fred_provider.fetch_fred_series("BAMLH0A0HYM2", "2026-01-01", "2026-01-31")
    assert result == stale_payload
