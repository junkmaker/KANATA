"""Unit tests for analysis.n_pattern: ZigZag pivots, N-pattern detection, scoring.

合成データは乱数を使わず決定的な数列で構成し、閾値境界を明示的に踏む。
"""
from __future__ import annotations

import pandas as pd

from src.analysis.n_pattern import (
    detect_n_pattern,
    extract_zigzag_pivots,
    zigzag_threshold,
)


def _linspace(a: float, b: float, n: int) -> list[float]:
    """端点を含む n 点の線形補間(monotonic なので余計なピボットを作らない)。"""
    if n == 1:
        return [a]
    return [a + (b - a) * i / (n - 1) for i in range(n)]


def _path(waypoints: list[tuple[int, float]], total: int) -> list[float]:
    """(index, price) の経由点を線形につなぎ、末尾を最終価格でフラット埋めする。"""
    vals: list[float] = []
    for k in range(len(waypoints) - 1):
        i0, p0 = waypoints[k]
        i1, p1 = waypoints[k + 1]
        seg = _linspace(p0, p1, i1 - i0 + 1)
        vals.extend(seg if k == 0 else seg[1:])
    last = waypoints[-1][1]
    while len(vals) < total:
        vals.append(last)
    return vals[:total]


def _df(closes: list[float], volume: list[float] | None = None,
        hl_span: float = 0.0) -> pd.DataFrame:
    n = len(closes)
    idx = pd.date_range("2026-01-01", periods=n, freq="B")
    high = [c * (1 + hl_span) for c in closes]
    low = [c * (1 - hl_span) for c in closes]
    vol = volume if volume is not None else [1000.0] * n
    return pd.DataFrame(
        {"Open": closes, "High": high, "Low": low, "Close": closes, "Volume": vol},
        index=idx,
    )


# --------------------------------------------------------------------------- #
# ZigZag / textbook detection
# --------------------------------------------------------------------------- #
def test_monotonic_rise_returns_none():
    """単調上昇はピボット不足で検出されない。"""
    df = _df(_linspace(100.0, 160.0, 40))
    assert detect_n_pattern(df) is None


def test_textbook_n_pattern_detected():
    """教科書的 N字: A=100 -> B=120 -> C=108 -> D=125。"""
    closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (28, 125.0)], total=40)
    result = detect_n_pattern(_df(closes))
    assert result is not None
    assert result["detected"] is True
    types = [p["type"] for p in result["pivots"]]
    assert types == ["low", "high", "low", "high"]
    prices = [p["price"] for p in result["pivots"]]
    assert prices == [100.0, 120.0, 108.0, 125.0]
    assert result["break_date"] == result["pivots"][3]["date"]


def test_lower_low_breaks_pattern():
    """押し目が直近安値 A を割ると非該当(C < A)。"""
    closes = _path([(0, 100.0), (10, 120.0), (18, 95.0), (28, 125.0)], total=40)
    assert detect_n_pattern(_df(closes)) is None


# --------------------------------------------------------------------------- #
# Scoring components (境界)
# --------------------------------------------------------------------------- #
def test_shallow_pullback_penalized():
    """浅い押し目 (B-C)/(B-A)=0.1 < 0.20 で減点。"""
    closes = _path([(0, 100.0), (10, 120.0), (18, 118.0), (28, 125.0)], total=40)
    result = detect_n_pattern(_df(closes), zigzag_pct=1.0)
    assert result is not None
    assert result["score_detail"]["pullback_penalty"] == 15


def test_short_duration_penalized():
    """A->D が 4 営業日(<5)で減点。"""
    closes = _path([(0, 100.0), (2, 120.0), (3, 110.0), (4, 125.0)], total=40)
    result = detect_n_pattern(_df(closes), zigzag_pct=1.0)
    assert result is not None
    assert result["pivots"][3]["index"] - result["pivots"][0]["index"] < 5
    assert result["score_detail"]["duration_penalty"] == 15


def test_volume_spike_bonus():
    """D 出来高 = 直近20日平均 x1.6 (>= +50%) で加点。"""
    closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (28, 125.0)], total=40)
    vol = [1000.0] * 40
    vol[28] = 1600.0
    result = detect_n_pattern(_df(closes, volume=vol))
    assert result is not None
    assert result["score_detail"]["volume"] == 20


def test_no_volume_spike_no_bonus():
    closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (28, 125.0)], total=40)
    result = detect_n_pattern(_df(closes))  # flat volume
    assert result is not None
    assert result["score_detail"]["volume"] == 0


def test_macd_gc_bonus():
    """終盤で強く上昇するとブレイク時 macd>signal で加点。"""
    closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (28, 125.0)], total=40)
    result = detect_n_pattern(_df(closes))
    assert result is not None
    assert result["score_detail"]["macd"] == 20


def test_score_clamped_and_penalties_applied():
    """全減点(浅い押し目 + 短期間)適用時もスコアは 0..100 に収まる。"""
    closes = _path([(0, 100.0), (2, 120.0), (3, 118.0), (4, 125.0)], total=40)
    result = detect_n_pattern(_df(closes), zigzag_pct=1.0)
    assert result is not None
    assert 0 <= result["score"] <= 100
    assert result["score_detail"]["pullback_penalty"] == 15
    assert result["score_detail"]["duration_penalty"] == 15


# --------------------------------------------------------------------------- #
# ATR-driven ZigZag threshold
# --------------------------------------------------------------------------- #
def test_atr_widens_zigzag_threshold():
    """高ボラ銘柄では zigzag_pct が下限 3.0 を上回る。"""
    df = _df(_linspace(100.0, 120.0, 40), hl_span=0.05)  # 高値/安値レンジ +-5%
    assert zigzag_threshold(df) > 3.0


def test_low_vol_threshold_at_floor():
    """低ボラ(H=L=C)では下限 3.0 に張り付く。"""
    df = _df(_linspace(100.0, 120.0, 40), hl_span=0.0)
    assert zigzag_threshold(df) == 3.0


def test_extract_zigzag_pivots_alternate_types():
    closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (28, 125.0)], total=40)
    pivots = extract_zigzag_pivots(_df(closes)["Close"], 3.0)
    types = [p["type"] for p in pivots]
    # 交互に並ぶ(連続する同種ピボットが無い)
    for prev, cur in zip(types, types[1:]):
        assert prev != cur
