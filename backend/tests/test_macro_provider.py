"""Unit tests for macro_provider: unit conversion, resampling, inner join,
signal evaluation, and the overall-signal rule."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from src.config.macro_config import load_macro_config
from src.services.fred_provider import MissingFredKey
from src.services.macro_provider import (
    _overall_signal,
    build_brent_wti,
    build_dashboard,
    build_net_liquidity,
    build_nikkei_sp,
    build_nikkei_topix,
    build_rsp_spy,
    build_t10y2y,
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
# T10Y2Y（FRED 単系列 → bp 換算）
# --------------------------------------------------------------------------- #
def test_t10y2y_percent_to_basis_points():
    """FRED は percent で返す（0.53 = 53bp）。表示単位は bp。"""

    def fred_side_effect(series_id, start, end):
        if series_id == "T10Y2Y":
            return [
                {"date": "2026-01-07", "value": 0.53},
                {"date": "2026-01-14", "value": -0.40},
            ]
        return []

    with patch("src.services.macro_provider.fetch_fred_series", side_effect=fred_side_effect):
        result = build_t10y2y("2020-01-01", "2030-01-01", CFG)

    assert result["unit"] == "bp"
    assert result["lens"] == "rates"
    assert result["series"][0]["value"] == pytest.approx(53.0, abs=1e-6)
    assert result["series"][1]["value"] == pytest.approx(-40.0, abs=1e-6)
    assert result["meta"]["available"] is True


def test_t10y2y_degrades_to_unavailable_without_fred_key():
    """FRED キー未設定でも例外を投げず unavailable に degrade する。"""
    with patch(
        "src.services.macro_provider.fetch_fred_series",
        side_effect=MissingFredKey("no key"),
    ):
        result = build_t10y2y("2020-01-01", "2030-01-01", CFG)

    assert result["meta"]["available"] is False
    assert result["signal"] == "gray"
    assert result["series"] == []


# --------------------------------------------------------------------------- #
# 外れ値除去（ベンダーのスケール異常）
# --------------------------------------------------------------------------- #
def _daily(values: list[float], start_day: int = 1) -> dict[str, float]:
    """{'2026-01-01': v, ...} 形式の連続日次終値を作る。"""
    return {f"2026-01-{start_day + i:02d}": v for i, v in enumerate(values)}


def test_pair_drops_vendor_scale_outlier():
    """分母系列の 1/10 スケール異常（実測: 1306.T 2026-03-30/31 相当）を除去する。"""
    num = _daily([40000.0] * 21)
    den_values = [2500.0] * 21
    den_values[10] = 250.0  # 1/10 に壊れた 1 点
    den_values[11] = 252.0  # 連続 2 日壊れるケースを再現

    def closes_side_effect(symbol):
        return num if symbol == "^N225" else _daily(den_values)

    with patch("src.services.macro_provider.fetch_daily_closes", side_effect=closes_side_effect):
        result = build_nikkei_topix("2020-01-01", "2030-01-01", CFG)

    series = result["series"]
    assert len(series) == 19  # 21 - 異常2点
    assert "2026-01-11" not in [p["date"] for p in series]
    assert "2026-01-12" not in [p["date"] for p in series]
    assert max(p["value"] for p in series) == pytest.approx(16.0, abs=1e-6)


def test_pair_keeps_normal_volatility():
    """通常のボラティリティ（±20%程度）は除去しない。"""
    num = _daily([40000.0] * 21)
    den_values = [2500.0 + (300.0 if i % 2 else -300.0) for i in range(21)]

    def closes_side_effect(symbol):
        return num if symbol == "^N225" else _daily(den_values)

    with patch("src.services.macro_provider.fetch_daily_closes", side_effect=closes_side_effect):
        result = build_nikkei_topix("2020-01-01", "2030-01-01", CFG)

    assert len(result["series"]) == 21


def test_pair_keeps_permanent_level_shift():
    """恒久的な水準変化（未調整の分割など）は誤ってスパイク扱いしない。"""
    num = _daily([40000.0] * 30)
    den_values = [25000.0] * 15 + [2500.0] * 15  # 途中で 1/10 に恒久シフト

    def closes_side_effect(symbol):
        return num if symbol == "^N225" else _daily(den_values)

    with patch("src.services.macro_provider.fetch_daily_closes", side_effect=closes_side_effect):
        result = build_nikkei_topix("2020-01-01", "2030-01-01", CFG)

    assert len(result["series"]) == 30


def test_pair_short_series_is_untouched():
    """窓を満たせない短い系列はフィルタを通さずそのまま返す。"""
    d1, d2 = "2026-06-30", "2026-07-01"

    def closes_side_effect(symbol):
        if symbol == "^N225":
            return {d1: 40000.0, d2: 40000.0}
        return {d1: 2500.0, d2: 250.0}  # 短すぎて異常判定できない

    with patch("src.services.macro_provider.fetch_daily_closes", side_effect=closes_side_effect):
        result = build_nikkei_topix("2020-01-01", "2030-01-01", CFG)

    assert len(result["series"]) == 2


def test_pair_despike_can_be_disabled_by_config():
    """sanitize.enabled=false で従来どおり素通しになる。"""
    num = _daily([40000.0] * 21)
    den_values = [2500.0] * 21
    den_values[10] = 250.0
    cfg = {**CFG, "sanitize": {**CFG.get("sanitize", {}), "enabled": False}}

    def closes_side_effect(symbol):
        return num if symbol == "^N225" else _daily(den_values)

    with patch("src.services.macro_provider.fetch_daily_closes", side_effect=closes_side_effect):
        result = build_nikkei_topix("2020-01-01", "2030-01-01", cfg)

    assert len(result["series"]) == 21


def test_pair_marks_stale_when_despike_drops_latest_trading_day():
    """直近日が _despike で落ちた場合、series の最新日は実際の最新取引日より古くなるため stale=True。"""
    num = _daily([40000.0] * 21)
    den_values = [2500.0] * 21
    den_values[20] = 250.0  # 最新日がスケール異常

    def closes_side_effect(symbol):
        return num if symbol == "^N225" else _daily(den_values)

    with patch("src.services.macro_provider.fetch_daily_closes", side_effect=closes_side_effect):
        result = build_nikkei_topix("2020-01-01", "2030-01-01", CFG)

    series = result["series"]
    assert len(series) == 20  # 最新日が異常値として除去された
    assert series[-1]["date"] == "2026-01-20"
    assert result["meta"]["stale"] is True


def test_pair_not_stale_when_no_days_are_dropped():
    """異常値が無ければ series の最新日＝実際の最新取引日となるため stale=False のまま。"""
    num = _daily([40000.0] * 21)
    den = _daily([2500.0] * 21)

    def closes_side_effect(symbol):
        return num if symbol == "^N225" else den

    with patch("src.services.macro_provider.fetch_daily_closes", side_effect=closes_side_effect):
        result = build_nikkei_topix("2020-01-01", "2030-01-01", CFG)

    assert result["meta"]["stale"] is False


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


def test_signal_t10y2y_red_on_inversion():
    assert evaluate_signal("t10y2y", _series([100.0, -1.0]), CFG) == "red"


def test_signal_t10y2y_yellow_at_zero():
    """0 ちょうどは red ではない（red_max_bp は strict less-than で判定する）。"""
    assert evaluate_signal("t10y2y", _series([100.0, 0.0]), CFG) == "yellow"


def test_signal_t10y2y_yellow_at_green_min():
    """green_min_bp ちょうどは green ではない（strict greater-than で判定する）。"""
    assert evaluate_signal("t10y2y", _series([100.0, 50.0]), CFG) == "yellow"


def test_signal_t10y2y_green_above_band():
    assert evaluate_signal("t10y2y", _series([100.0, 51.0]), CFG) == "green"


def test_signal_t10y2y_evaluates_single_point():
    """水準判定は 1 点でも答えを出せる。

    他指標が使う「2 点未満は green」の早期 return に巻き込まれると、逆イールドの
    単点（?start=X&end=X などで発生しうる）が green になり警告と真逆の表示になる。
    """
    assert evaluate_signal("t10y2y", _series([-80.0]), CFG) == "red"
    assert evaluate_signal("t10y2y", _series([80.0]), CFG) == "green"
    assert evaluate_signal("t10y2y", _series([20.0]), CFG) == "yellow"


def test_signal_other_indicators_still_green_on_single_point():
    """t10y2y を早期 return より前に出したことで、他指標の既存挙動が変わっていないこと。"""
    for key in ("hy_oas", "net_liquidity", "rsp_spy", "nikkei_sp", "nikkei_topix", "brent_wti"):
        assert evaluate_signal(key, _series([-999.0]), CFG) == "green", key


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
    """Core 3 が全て green のとき、extra の brent_wti / t10y2y が red でも overall は green のまま。"""

    def fred_side_effect(series_id, start, end):
        data = {
            # HY OAS 縮小トレンド -> green（新高値でも 50bp 拡大でもない）
            "BAMLH0A0HYM2": [{"date": "2026-01-07", "value": 3.2}, {"date": "2026-01-14", "value": 3.0}],
            # 純流動性 上昇 -> green
            "WALCL": [{"date": "2026-01-07", "value": 7_000_000}, {"date": "2026-01-14", "value": 7_500_000}],
            "RRPONTSYD": [{"date": "2026-01-06", "value": 400.0}, {"date": "2026-01-13", "value": 400.0}],
            "WTREGEN": [{"date": "2026-01-07", "value": 700.0}, {"date": "2026-01-14", "value": 700.0}],
            # 逆イールド -40bp -> red（extra だが overall には影響しない想定）
            "T10Y2Y": [{"date": "2026-01-07", "value": -0.30}, {"date": "2026-01-14", "value": -0.40}],
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
    assert len(result["indicators"]) == 7
    # Core all green, extras (brent_wti / t10y2y) red -> overall stays green (extras excluded).
    assert by_key["hy_oas"]["signal"] == "green"
    assert by_key["net_liquidity"]["signal"] == "green"
    assert by_key["rsp_spy"]["signal"] == "green"
    assert by_key["brent_wti"]["signal"] == "red"
    assert by_key["t10y2y"]["signal"] == "red"
    assert result["overall_signal"] == "green"
