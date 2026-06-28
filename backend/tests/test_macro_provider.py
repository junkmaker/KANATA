"""Unit tests for macro_provider: unit conversion, resampling, inner join,
signal evaluation, and the overall-signal rule."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from src.config.macro_config import load_macro_config
from src.services.macro_provider import (
    _overall_signal,
    build_net_liquidity,
    build_rsp_spy,
    evaluate_signal,
)

CFG = load_macro_config()


def _fred_side_effect(walcl, rrp, tga):
    def inner(series_id, start, end):
        mapping = {"WALCL": walcl, "RRPONTSYD": rrp, "WTREGEN": tga}
        return mapping.get(series_id, [])

    return inner


# --------------------------------------------------------------------------- #
# Net liquidity: unit conversion + value range
# --------------------------------------------------------------------------- #
def test_net_liquidity_unit_conversion_and_range():
    walcl = [
        {"date": "2026-01-07", "value": 7_000_000},  # millions -> 7000 billion
        {"date": "2026-01-14", "value": 7_100_000},
    ]
    rrp = [{"date": "2026-01-06", "value": 400.0}, {"date": "2026-01-13", "value": 400.0}]
    tga = [{"date": "2026-01-07", "value": 700.0}, {"date": "2026-01-14", "value": 700.0}]

    with patch(
        "src.services.macro_provider.fetch_fred_series",
        side_effect=_fred_side_effect(walcl, rrp, tga),
    ):
        result = build_net_liquidity("2026-01-01", "2026-01-31", CFG)

    series = result["series"]
    assert len(series) == 2
    # 7000 - 400 - 700 = 5900 billion = 5.9 trillion
    assert series[0]["value"] == pytest.approx(5.9, abs=0.001)
    assert series[1]["value"] == pytest.approx(6.0, abs=0.001)
    # value range sanity (trillions)
    assert all(3.0 <= p["value"] <= 8.0 for p in series)
    assert result["unit"] == "USD_trillion"


def test_net_liquidity_weekly_resample_no_nan():
    """Daily RRP forward-filled onto weekly WALCL grid; no None values."""
    walcl = [
        {"date": "2026-02-04", "value": 7_000_000},
        {"date": "2026-02-11", "value": 7_050_000},
    ]
    # RRP daily, not aligned to WALCL Wednesdays
    rrp = [
        {"date": "2026-02-02", "value": 410.0},
        {"date": "2026-02-09", "value": 405.0},
    ]
    tga = [{"date": "2026-02-04", "value": 690.0}, {"date": "2026-02-11", "value": 695.0}]

    with patch(
        "src.services.macro_provider.fetch_fred_series",
        side_effect=_fred_side_effect(walcl, rrp, tga),
    ):
        result = build_net_liquidity("2026-02-01", "2026-02-28", CFG)

    series = result["series"]
    assert len(series) == 2
    assert all(isinstance(p["value"], float) for p in series)
    assert all(p["value"] is not None for p in series)


# --------------------------------------------------------------------------- #
# RSP/SPY inner join
# --------------------------------------------------------------------------- #
def test_rsp_spy_inner_join_excludes_mismatched_days():
    a, b, c, d = 1_700_000_000_000, 1_700_086_400_000, 1_700_172_800_000, 1_700_259_200_000

    def ohlcv_side_effect(symbol, timeframe):
        if symbol == "RSP":
            return [{"t": a, "c": 150.0}, {"t": b, "c": 151.0}, {"t": c, "c": 152.0}]
        if symbol == "SPY":
            return [{"t": b, "c": 500.0}, {"t": c, "c": 505.0}, {"t": d, "c": 510.0}]
        return []

    with patch("src.services.macro_provider.fetch_ohlcv", side_effect=ohlcv_side_effect):
        result = build_rsp_spy("2020-01-01", "2030-01-01", CFG)

    series = result["series"]
    # Only timestamps b and c are common to both series.
    assert len(series) == 2
    assert series[0]["value"] == pytest.approx(151.0 / 500.0, abs=1e-6)
    assert series[1]["value"] == pytest.approx(152.0 / 505.0, abs=1e-6)


def test_rsp_spy_degrades_to_unavailable_on_fetch_error():
    """yfinance が例外を投げても build_rsp_spy は落ちず unavailable に degrade する。"""

    def boom(symbol, timeframe):
        raise RuntimeError("yfinance down")

    with patch("src.services.macro_provider.fetch_ohlcv", side_effect=boom):
        result = build_rsp_spy("2020-01-01", "2030-01-01", CFG)

    assert result["meta"]["available"] is False
    assert result["signal"] == "gray"
    assert result["series"] == []


def test_rsp_spy_available_without_fred_key(monkeypatch):
    """RSP/SPY uses yfinance only; works with no FRED key configured."""
    monkeypatch.delenv("FRED_API_KEY", raising=False)

    def ohlcv_side_effect(symbol, timeframe):
        t0, t1 = 1_700_000_000_000, 1_700_086_400_000
        if symbol == "RSP":
            return [{"t": t0, "c": 150.0}, {"t": t1, "c": 151.0}]
        if symbol == "SPY":
            return [{"t": t0, "c": 500.0}, {"t": t1, "c": 505.0}]
        return []

    with patch("src.services.macro_provider.fetch_ohlcv", side_effect=ohlcv_side_effect):
        result = build_rsp_spy("2020-01-01", "2030-01-01", CFG)

    assert result["meta"]["available"] is True
    assert len(result["series"]) == 2


# --------------------------------------------------------------------------- #
# Signal evaluation boundaries
# --------------------------------------------------------------------------- #
def _series(values):
    return [{"date": f"2026-01-{i + 1:02d}", "value": v} for i, v in enumerate(values)]


def test_signal_hy_oas_yellow_on_widening():
    # latest - value 20 points ago >= 50bp, but not a new high (500 earlier).
    values = [500.0] + [310.0] * 8 + [300.0] + [310.0] * 19 + [360.0]
    assert len(values) == 30
    assert evaluate_signal("hy_oas", _series(values), CFG) == "yellow"


def test_signal_hy_oas_red_on_new_high():
    values = [300.0 + i for i in range(30)]  # strictly increasing -> latest is max
    assert evaluate_signal("hy_oas", _series(values), CFG) == "red"


def test_signal_net_liquidity_red_on_new_low():
    values = [20.0 - i * 0.1 for i in range(30)]  # strictly decreasing -> latest is min
    assert evaluate_signal("net_liquidity", _series(values), CFG) == "red"


def test_signal_net_liquidity_yellow_on_downtrend():
    # latest below value 8 points ago, but not the window minimum (5 at index 0).
    values = [5.0, 20.0, 19.0, 18.0, 17.0, 16.0, 15.0, 14.0, 13.0, 12.0, 11.0, 10.0]
    assert evaluate_signal("net_liquidity", _series(values), CFG) == "yellow"


def test_signal_rsp_spy_red_on_new_low():
    values = [1.0 - i * 0.001 for i in range(30)]
    assert evaluate_signal("rsp_spy", _series(values), CFG) == "red"


def test_signal_rsp_spy_yellow_near_low():
    values = [1.00, 1.05, 1.01]  # latest 1% above the recent low 1.00 (<=2%)
    assert evaluate_signal("rsp_spy", _series(values), CFG) == "yellow"


# --------------------------------------------------------------------------- #
# Overall signal rule
# --------------------------------------------------------------------------- #
def _ind(signal, available=True):
    return {"signal": signal, "meta": {"available": available}}


def test_overall_red_priority():
    indicators = [_ind("red"), _ind("green"), _ind("green")]
    assert _overall_signal(indicators, CFG) == "red"


def test_overall_yellow_when_two_yellow():
    indicators = [_ind("yellow"), _ind("yellow"), _ind("green")]
    assert _overall_signal(indicators, CFG) == "yellow"


def test_overall_green_when_single_yellow():
    indicators = [_ind("yellow"), _ind("green"), _ind("green")]
    assert _overall_signal(indicators, CFG) == "green"


def test_overall_gray_when_none_available():
    indicators = [_ind("gray", available=False), _ind("gray", available=False)]
    assert _overall_signal(indicators, CFG) == "gray"
