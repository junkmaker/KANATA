"""Unit tests for analysis.n_pattern: ZigZag pivots, N-pattern detection, scoring.

合成データは乱数を使わず決定的な数列で構成し、閾値境界を明示的に踏む。
末尾を最終価格でフラット埋めするため、進行中ブレイク(D)を末尾付近に置かないと
直近性フィルタ(RECENCY_MAX_BARS)で落ちる点に注意する。
"""
from __future__ import annotations

import pandas as pd

from src.analysis.n_pattern import (
    BREAKOUT_BONUS,
    DURATION_PENALTY,
    MACD_BONUS,
    PULLBACK_PENALTY,
    TREND_BONUS,
    VOLUME_BONUS,
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
    """教科書的 N字: A=100 -> B=120 -> C=108 -> D=125(D は末尾付近)。"""
    closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (34, 125.0)], total=40)
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
    closes = _path([(0, 100.0), (10, 120.0), (18, 95.0), (34, 125.0)], total=40)
    assert detect_n_pattern(_df(closes)) is None


# --------------------------------------------------------------------------- #
# Breakout margin filter (M字 / ダブルトップ除去)
# --------------------------------------------------------------------------- #
def test_double_top_rejected_by_breakout_margin():
    """D=120.5, B=120(< B×1.02)は M字とみなし非該当。"""
    closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (34, 120.5)], total=40)
    assert detect_n_pattern(_df(closes)) is None


def test_clear_breakout_passes_margin():
    """D=125, B=120(>= 122.4)は明確なブレイクとして検出。"""
    closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (34, 125.0)], total=40)
    assert detect_n_pattern(_df(closes)) is not None


# --------------------------------------------------------------------------- #
# Recency filter (進行中ブレイクのみ採用)
# --------------------------------------------------------------------------- #
def test_stale_break_rejected_by_recency():
    """D が末尾から 11 本前(> RECENCY_MAX_BARS)は非該当。"""
    closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (28, 125.0)], total=40)
    assert detect_n_pattern(_df(closes)) is None


def test_recent_break_passes_recency():
    """D が末尾から 5 本前(<= RECENCY_MAX_BARS)は検出。"""
    closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (34, 125.0)], total=40)
    assert detect_n_pattern(_df(closes)) is not None


# --------------------------------------------------------------------------- #
# Trend context bonus (下降バウンス除去)
# --------------------------------------------------------------------------- #
def test_downtrend_bounce_gets_no_trend_bonus():
    """A の TREND_LOOKBACK 本前が A より 15% 高い(下降流入)なら trend 加点なし。"""
    closes = _path(
        [(0, 115.0), (20, 100.0), (28, 120.0), (34, 110.0), (40, 130.0)], total=45
    )
    result = detect_n_pattern(_df(closes), zigzag_pct=3.0)
    assert result is not None
    assert result["pivots"][0]["index"] == 20  # A は 20 本目(手前参照が可能)
    assert result["score_detail"]["trend"] == 0


def test_uptrend_continuation_gets_trend_bonus():
    """A の手前にデータが無い(上昇継続とみなす)なら TREND_BONUS。"""
    closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (34, 125.0)], total=40)
    result = detect_n_pattern(_df(closes))
    assert result is not None
    assert result["score_detail"]["trend"] == TREND_BONUS


# --------------------------------------------------------------------------- #
# Breakout width bonus
# --------------------------------------------------------------------------- #
def test_strong_breakout_bonus():
    """(D-B)/B = 8.3% (>= 5%) で BREAKOUT_BONUS。"""
    closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (34, 130.0)], total=40)
    result = detect_n_pattern(_df(closes))
    assert result is not None
    assert result["score_detail"]["breakout"] == BREAKOUT_BONUS


# --------------------------------------------------------------------------- #
# Scoring components (境界)
# --------------------------------------------------------------------------- #
def test_shallow_pullback_penalized():
    """浅い押し目 (B-C)/(B-A)=0.1 < 0.20 で減点。"""
    closes = _path([(0, 100.0), (10, 120.0), (18, 118.0), (34, 125.0)], total=40)
    result = detect_n_pattern(_df(closes), zigzag_pct=1.0)
    assert result is not None
    assert result["score_detail"]["pullback_penalty"] == PULLBACK_PENALTY


def test_short_duration_penalized():
    """A->D が 4 営業日(<5)で減点。手前を下降させ A を 30 本目に置く。"""
    closes = _path(
        [(0, 130.0), (30, 100.0), (32, 120.0), (33, 110.0), (34, 125.0)], total=40
    )
    result = detect_n_pattern(_df(closes), zigzag_pct=1.0)
    assert result is not None
    assert result["pivots"][3]["index"] - result["pivots"][0]["index"] < 5
    assert result["score_detail"]["duration_penalty"] == DURATION_PENALTY


def test_volume_spike_bonus():
    """D 出来高 = 直近20日平均 x1.6 (>= +50%) で加点。"""
    closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (34, 125.0)], total=40)
    vol = [1000.0] * 40
    vol[34] = 1600.0
    result = detect_n_pattern(_df(closes, volume=vol))
    assert result is not None
    assert result["score_detail"]["volume"] == VOLUME_BONUS


def test_no_volume_spike_no_bonus():
    """出来高が平坦なら加点なし。"""
    closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (34, 125.0)], total=40)
    result = detect_n_pattern(_df(closes))
    assert result is not None
    assert result["score_detail"]["volume"] == 0


def test_macd_gc_bonus():
    """ブレイク時に MACD が GC 方向なら加点。"""
    closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (34, 125.0)], total=40)
    result = detect_n_pattern(_df(closes))
    assert result is not None
    assert result["score_detail"]["macd"] == MACD_BONUS


def test_score_clamped_and_penalties_applied():
    """浅い押し目 + 短期間で両減点、score は 0..100 に収まる。"""
    closes = _path(
        [(0, 130.0), (30, 100.0), (32, 120.0), (33, 118.0), (34, 125.0)], total=40
    )
    result = detect_n_pattern(_df(closes), zigzag_pct=1.0)
    assert result is not None
    assert result["score_detail"]["pullback_penalty"] == PULLBACK_PENALTY
    assert result["score_detail"]["duration_penalty"] == DURATION_PENALTY
    assert 0 <= result["score"] <= 100


# --------------------------------------------------------------------------- #
# 逆転解消 & クランプ
# --------------------------------------------------------------------------- #
def test_continuation_outscores_downtrend_bounce():
    """上昇継続の N字は下降トレンドのバウンスより高スコア。"""
    cont_closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (34, 125.0)], total=40)
    bounce_closes = _path(
        [(0, 115.0), (20, 100.0), (28, 120.0), (34, 110.0), (40, 130.0)], total=45
    )
    cont = detect_n_pattern(_df(cont_closes))
    bounce = detect_n_pattern(_df(bounce_closes), zigzag_pct=3.0)
    assert cont is not None and bounce is not None
    assert bounce["score_detail"]["trend"] == 0
    assert cont["score"] > bounce["score"]


def test_score_within_range_all_components():
    """全加点発火(trend/breakout/volume/macd)でも score は 100 でクランプ内。"""
    closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (34, 130.0)], total=40)
    vol = [1000.0] * 40
    vol[34] = 1600.0
    result = detect_n_pattern(_df(closes, volume=vol))
    assert result is not None
    detail = result["score_detail"]
    assert detail["trend"] == TREND_BONUS
    assert detail["breakout"] == BREAKOUT_BONUS
    assert detail["volume"] == VOLUME_BONUS
    assert detail["macd"] == MACD_BONUS
    assert detail["pullback_penalty"] == 0
    assert detail["duration_penalty"] == 0
    assert 0 <= result["score"] <= 100
    assert result["score"] == 100


# --------------------------------------------------------------------------- #
# ZigZag threshold / pivots
# --------------------------------------------------------------------------- #
def test_atr_widens_zigzag_threshold():
    """高ボラ(H/L レンジ +-5%)では下限 3.0 を上回る。"""
    df = _df(_linspace(100.0, 120.0, 40), hl_span=0.05)
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
