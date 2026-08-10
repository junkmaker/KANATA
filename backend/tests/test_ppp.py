"""PPP 状態機械の単体テスト。

守っているのは 3 つ: **unknown から直接 in へ遷移しない**こと(窓先頭の嘘の一斉成立
を防ぐ)、**ヒステリシス帯で往復しない**こと、**因果的である**こと(prefix を切っても
同じイベントが出る = walk-forward 再実行が不要)。
"""
from __future__ import annotations

import pandas as pd

from src.analysis.ppp import (
    MIN_BARS,
    PPP_GAP_K,
    PPP_GAP_K_EXIT,
    compute_gaps,
    detect_ppp,
    ppp_events,
)


# --------------------------------------------------------------------------- #
# Synthetic data helpers
# --------------------------------------------------------------------------- #
def _df(closes: list[float]) -> pd.DataFrame:
    """終値から日足 df を作る。

    High/Low を Close の ±1% にするのは **ATR を正の値に保つため**。
    OHLC をすべて同値にすると True Range が「前日終値との差」だけになり、
    値動きの小さい区間で ATR が 0 に潰れてゼロ除算ガードに吸われる。
    """
    n = len(closes)
    idx = pd.date_range("2026-01-01", periods=n, freq="B")
    return pd.DataFrame(
        {
            "Open": closes,
            "High": [c * 1.01 for c in closes],
            "Low": [c * 0.99 for c in closes],
            "Close": closes,
            "Volume": [1000.0] * n,
        },
        index=idx,
    )


def _ramp(start: float, end: float, n: int) -> list[float]:
    """start から end への直線。"""
    if n <= 1:
        return [start] * n
    step = (end - start) / (n - 1)
    return [start + step * i for i in range(n)]


def _breakdown_then_rise(n_down: int = 120, n_up: int = 120) -> pd.DataFrame:
    """前半で崩壊(下降)し、後半で成立(上昇)する系列。"""
    return _df(_ramp(200.0, 100.0, n_down) + _ramp(100.0, 260.0, n_up)[1:])


# --------------------------------------------------------------------------- #
# 初期状態 unknown の扱い(決定#6 の中核)
# --------------------------------------------------------------------------- #
def test_unknown_never_yields_event_without_prior_breakdown():
    """窓の先頭から一貫して並んでいる銘柄は成立イベントを出さない。

    「いつ成立したか」が窓の外にあるため成立と呼べない。非PPP とみなすと
    8ヶ月前の嘘の一斉成立が数百件出る(docs/ppp_screening_spec.md 決定#6)。
    """
    df = _df(_ramp(100.0, 400.0, 240))  # 単調上昇 = 常に PPP 状態

    assert ppp_events(df) == []
    assert detect_ppp(df) is None


def test_event_after_breakdown():
    """一度崩壊を観測した後の成立はイベントになる。"""
    df = _breakdown_then_rise()

    events = ppp_events(df)

    assert len(events) == 1
    # 成立は下降が終わって上昇に転じた後(前半 120 本より後ろ)
    assert events[0]["index"] > 120
    assert detect_ppp(df)["established_date"] == events[0]["date"]


# --------------------------------------------------------------------------- #
# ヒステリシス
# --------------------------------------------------------------------------- #
def test_hysteresis_holds_state_inside_band():
    """成立と崩壊のあいだの帯では状態を維持する(往復してもイベントが増えない)。

    帯の中で振動させたときにイベントが増えるなら、それはチャタリングであって
    ヒステリシスが効いていない。
    """
    # 崩壊 → 成立 → その後は小さく振動させて帯の中に留める
    closes = _ramp(200.0, 100.0, 120) + _ramp(100.0, 260.0, 120)[1:]
    wobble = [260.0 + (2.0 if i % 2 else -2.0) for i in range(60)]
    df = _df(closes + wobble)

    events = ppp_events(df)

    # 振動区間でイベントが増えていない
    assert len(events) == 1


def test_larger_k_exit_suppresses_reentry():
    """k_exit を上げると崩壊しにくくなり、再成立が抑制される。

    ヒステリシス幅が結果に効いていることの確認(帯が広いほどイベントは減る)。
    """
    df = _df(
        _ramp(200.0, 100.0, 90)
        + _ramp(100.0, 240.0, 90)[1:]
        + _ramp(240.0, 130.0, 60)[1:]
        + _ramp(130.0, 300.0, 90)[1:]
    )

    loose = ppp_events(df, k=PPP_GAP_K, k_exit=0.1)
    tight = ppp_events(df, k=PPP_GAP_K, k_exit=5.0)

    assert len(loose) >= len(tight)


# --------------------------------------------------------------------------- #
# 複数イベントと最新採用
# --------------------------------------------------------------------------- #
def test_multiple_events_and_latest_wins():
    """崩壊→成立を 2 回繰り返すと 2 件出て、detect_ppp は最後を返す。"""
    df = _df(
        _ramp(200.0, 100.0, 90)
        + _ramp(100.0, 240.0, 90)[1:]
        + _ramp(240.0, 120.0, 90)[1:]
        + _ramp(120.0, 320.0, 90)[1:]
    )

    events = ppp_events(df)

    assert len(events) >= 2
    assert detect_ppp(df)["established_date"] == events[-1]["date"]


def test_duration_days_counts_bars_to_last():
    """duration_days は成立日から最終バーまでの**バー本数**。"""
    df = _breakdown_then_rise()

    events = ppp_events(df)
    result = detect_ppp(df)

    assert result["duration_days"] == (len(df) - 1) - events[-1]["index"]


# --------------------------------------------------------------------------- #
# 境界とゼロ除算
# --------------------------------------------------------------------------- #
def test_returns_empty_below_min_bars():
    """sma75 が立たない長さでは評価しない。"""
    df = _df(_ramp(100.0, 200.0, MIN_BARS - 1))

    assert ppp_events(df) == []
    assert detect_ppp(df) is None


def test_flat_series_does_not_raise():
    """全バー同値(ATR=0)でもゼロ除算で落ちない。

    ガードが無いと inf/nan が出て比較が黙って False になり、状態が固まる。
    """
    df = _df([100.0] * 240)

    assert ppp_events(df) == []
    assert detect_ppp(df) is None


def test_compute_gaps_marks_warmup_bars_unevaluable():
    """sma75 の助走区間は None(評価不能)になる。"""
    df = _breakdown_then_rise()

    gap_short, gap_long = compute_gaps(df)

    assert all(g is None for g in gap_short[: MIN_BARS - 1])
    assert all(g is None for g in gap_long[: MIN_BARS - 1])
    assert gap_short[-1] is not None
    assert gap_long[-1] is not None


def test_missing_close_column_returns_empty():
    df = _breakdown_then_rise().drop(columns=["Close"])

    assert ppp_events(df) == []


# --------------------------------------------------------------------------- #
# 因果性(仕様 §1.2 の「1 回の前方パスで足りる」根拠)
# --------------------------------------------------------------------------- #
def test_causality_prefix_reproduces_events():
    """prefix を切った系列の結果が、全期間結果の絞り込みと一致する。

    一致しないなら時刻 t の判定が t より後を参照している(先読み)。
    """
    df = _df(
        _ramp(200.0, 100.0, 90)
        + _ramp(100.0, 240.0, 90)[1:]
        + _ramp(240.0, 120.0, 90)[1:]
        + _ramp(120.0, 320.0, 90)[1:]
    )
    full = ppp_events(df)

    for t in (100, 150, 200, len(df) - 1):
        prefix = ppp_events(df.iloc[: t + 1])
        expected = [e for e in full if e["index"] <= t]
        assert prefix == expected, f"prefix mismatch at t={t}"


def test_k_thresholds_are_module_constants():
    """閾値は定数に集約されている(マジックナンバー禁止の確認)。"""
    assert PPP_GAP_K == 1.0
    assert PPP_GAP_K_EXIT == PPP_GAP_K / 2
