"""Unit tests for macro_provider: unit conversion, resampling, inner join,
signal evaluation, and the overall-signal rule."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from src.config.macro_config import load_macro_config
from src.services.macro_provider import (
    _overall_signal,
    build_brent_wti,
    build_dashboard,
    build_net_liquidity,
    build_nikkei_sp,
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
    d1, d2, d3, d4 = "2026-06-28", "2026-06-29", "2026-06-30", "2026-07-01"

    def closes_side_effect(symbol):
        if symbol == "RSP":
            return {d1: 150.0, d2: 151.0, d3: 152.0}
        if symbol == "SPY":
            return {d2: 500.0, d3: 505.0, d4: 510.0}
        return {}

    with patch("src.services.macro_provider.fetch_daily_closes", side_effect=closes_side_effect):
        result = build_rsp_spy("2020-01-01", "2030-01-01", CFG)

    series = result["series"]
    # Only d2 and d3 are common trading days to both series.
    assert len(series) == 2
    assert series[0]["value"] == pytest.approx(151.0 / 500.0, abs=1e-6)
    assert series[1]["value"] == pytest.approx(152.0 / 505.0, abs=1e-6)


def test_rsp_spy_degrades_to_unavailable_on_fetch_error():
    """yfinance が例外を投げても build_rsp_spy は落ちず unavailable に degrade する。"""

    def boom(symbol):
        raise RuntimeError("yfinance down")

    with patch("src.services.macro_provider.fetch_daily_closes", side_effect=boom):
        result = build_rsp_spy("2020-01-01", "2030-01-01", CFG)

    assert result["meta"]["available"] is False
    assert result["signal"] == "gray"
    assert result["series"] == []


def test_rsp_spy_available_without_fred_key(monkeypatch):
    """RSP/SPY uses yfinance only; works with no FRED key configured."""
    monkeypatch.delenv("FRED_API_KEY", raising=False)

    def closes_side_effect(symbol):
        d1, d2 = "2026-06-30", "2026-07-01"
        if symbol == "RSP":
            return {d1: 150.0, d2: 151.0}
        if symbol == "SPY":
            return {d1: 500.0, d2: 505.0}
        return {}

    with patch("src.services.macro_provider.fetch_daily_closes", side_effect=closes_side_effect):
        result = build_rsp_spy("2020-01-01", "2030-01-01", CFG)

    assert result["meta"]["available"] is True
    assert len(result["series"]) == 2


# --------------------------------------------------------------------------- #
# Nikkei / Brent-WTI pair builders (yfinance two-symbol join)
# --------------------------------------------------------------------------- #
def test_nikkei_sp_ratio_inner_join():
    """異なるタイムゾーン（東京 vs NY）でも同一取引日（ローカル暦日）で結合されることを検証。"""
    d1, d2, d3, d4 = "2026-06-28", "2026-06-29", "2026-06-30", "2026-07-01"

    def closes_side_effect(symbol):
        if symbol == "^N225":
            return {d1: 39000.0, d2: 39500.0, d3: 40000.0}
        if symbol == "^GSPC":
            return {d2: 5000.0, d3: 5100.0, d4: 5200.0}
        return {}

    with patch("src.services.macro_provider.fetch_daily_closes", side_effect=closes_side_effect):
        result = build_nikkei_sp("2020-01-01", "2030-01-01", CFG)

    series = result["series"]
    # Only d2 and d3 are common trading days to both series.
    assert len(series) == 2
    assert result["unit"] == "ratio"
    assert series[0]["value"] == pytest.approx(39500.0 / 5000.0, abs=1e-6)
    assert series[1]["value"] == pytest.approx(40000.0 / 5100.0, abs=1e-6)


def test_brent_wti_diff():
    d1, d2 = "2026-06-30", "2026-07-01"

    def closes_side_effect(symbol):
        if symbol == "BZ=F":
            return {d1: 70.0, d2: 71.0}
        if symbol == "CL=F":
            return {d1: 66.0, d2: 66.5}
        return {}

    with patch("src.services.macro_provider.fetch_daily_closes", side_effect=closes_side_effect):
        result = build_brent_wti("2020-01-01", "2030-01-01", CFG)

    series = result["series"]
    assert result["unit"] == "usd_bbl"
    assert series[0]["value"] == pytest.approx(4.0, abs=1e-6)  # 70 - 66
    assert series[1]["value"] == pytest.approx(4.5, abs=1e-6)  # 71 - 66.5


def test_brent_wti_degrades_to_unavailable_on_fetch_error():
    """yfinance が例外を投げても build_brent_wti は落ちず unavailable に degrade する。"""

    def boom(symbol):
        raise RuntimeError("yfinance down")

    with patch("src.services.macro_provider.fetch_daily_closes", side_effect=boom):
        result = build_brent_wti("2020-01-01", "2030-01-01", CFG)

    assert result["meta"]["available"] is False
    assert result["signal"] == "gray"
    assert result["series"] == []


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


def test_signal_nikkei_sp_red_on_new_low():
    values = [0.8 - i * 0.001 for i in range(30)]  # strictly decreasing -> latest is min
    assert evaluate_signal("nikkei_sp", _series(values), CFG) == "red"


def test_signal_nikkei_sp_yellow_on_downtrend():
    # latest below the value 8 points ago, but not the window minimum (index 0 lowest).
    values = [5.0, 20.0, 19.0, 18.0, 17.0, 16.0, 15.0, 14.0, 13.0, 12.0, 11.0, 10.0]
    assert evaluate_signal("nikkei_sp", _series(values), CFG) == "yellow"


def test_signal_nikkei_sp_green_on_uptrend():
    values = [0.8 + i * 0.001 for i in range(30)]  # strictly increasing
    assert evaluate_signal("nikkei_sp", _series(values), CFG) == "green"


def test_signal_brent_wti_red_on_inversion():
    values = [3.0, -0.5]  # spread <= 0 -> inversion
    assert evaluate_signal("brent_wti", _series(values), CFG) == "red"


def test_signal_brent_wti_red_on_extreme_widening():
    values = [3.0, 12.0]  # spread >= 10 -> extreme
    assert evaluate_signal("brent_wti", _series(values), CFG) == "red"


def test_signal_brent_wti_yellow_out_of_band():
    values = [3.0, 8.0]  # above the green band max (7) but below extreme (10)
    assert evaluate_signal("brent_wti", _series(values), CFG) == "yellow"


def test_signal_brent_wti_green_in_band():
    values = [2.0, 3.0]  # within the normal band ($1.5-7)
    assert evaluate_signal("brent_wti", _series(values), CFG) == "green"


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


# --------------------------------------------------------------------------- #
# Dashboard: extras are display-only and must not contaminate overall_signal
# --------------------------------------------------------------------------- #
def test_dashboard_extras_do_not_contaminate_overall():
    """Core 3 が全て green のとき、extra の brent_wti が red でも overall は green のまま。"""

    def fred_side_effect(series_id, start, end):
        data = {
            # HY OAS 縮小トレンド -> green（新高値でも 50bp 拡大でもない）
            "BAMLH0A0HYM2": [{"date": "2026-01-07", "value": 3.2}, {"date": "2026-01-14", "value": 3.0}],
            # 純流動性 上昇 -> green
            "WALCL": [{"date": "2026-01-07", "value": 7_000_000}, {"date": "2026-01-14", "value": 7_500_000}],
            "RRPONTSYD": [{"date": "2026-01-06", "value": 400.0}, {"date": "2026-01-13", "value": 400.0}],
            "WTREGEN": [{"date": "2026-01-07", "value": 700.0}, {"date": "2026-01-14", "value": 700.0}],
        }
        return data.get(series_id, [])

    def closes_side_effect(symbol):
        d0, d1 = "2026-06-30", "2026-07-01"
        data = {
            # RSP/SPY 比率が低値から大きく上昇 -> green
            "RSP": {d0: 150.0, d1: 200.0},
            "SPY": {d0: 500.0, d1: 500.0},
            "^N225": {d0: 39000.0, d1: 40000.0},
            "^GSPC": {d0: 5100.0, d1: 5000.0},
            "1306": {d0: 2500.0, d1: 2520.0},
            # ブレント-WTI スプレッド 12 -> red（extra だが overall には影響しない想定）
            "BZ=F": {d0: 78.0, d1: 78.0},
            "CL=F": {d0: 66.0, d1: 66.0},
        }
        return data.get(symbol, {})

    with patch(
        "src.services.macro_provider.fetch_fred_series", side_effect=fred_side_effect
    ), patch("src.services.macro_provider.fetch_daily_closes", side_effect=closes_side_effect):
        result = build_dashboard("2020-01-01", "2030-01-01", CFG)

    by_key = {i["indicator"]: i for i in result["indicators"]}
    assert len(result["indicators"]) == 6
    # Core all green, extra brent_wti red -> overall stays green (extras excluded).
    assert by_key["hy_oas"]["signal"] == "green"
    assert by_key["net_liquidity"]["signal"] == "green"
    assert by_key["rsp_spy"]["signal"] == "green"
    assert by_key["brent_wti"]["signal"] == "red"
    assert result["overall_signal"] == "green"
