"""Unit tests for analysis.backtest: ウォークフォワード検出・エントリー解決・アウトカム・統計。

合成データは乱数を使わず決定的な数列で構成する(``test_n_pattern.py`` と同方針)。
ブートストラップのみ seed 固定の擬似乱数を使い、決定性をテストで確認する。
"""
from __future__ import annotations

import pandas as pd
import pytest

from src.analysis.backtest import (
    OVERLAP_BARS,
    benchmark_outcome,
    block_bootstrap_means,
    compute_outcomes,
    confidence_interval,
    iso_dates,
    mark_overlaps,
    max_calendar_span_days,
    paired_block_bootstrap_diffs,
    percentile_of,
    resolve_entries,
    walk_forward_signals,
    weekly_entry_index,
    within_calendar_span,
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
        hl_span: float = 0.0, start: str = "2026-01-01") -> pd.DataFrame:
    n = len(closes)
    idx = pd.date_range(start, periods=n, freq="B")
    high = [c * (1 + hl_span) for c in closes]
    low = [c * (1 - hl_span) for c in closes]
    vol = volume if volume is not None else [1000.0] * n
    return pd.DataFrame(
        {"Open": closes, "High": high, "Low": low, "Close": closes, "Volume": vol},
        index=idx,
    )


def _n_pattern_df(total: int = 60) -> pd.DataFrame:
    """教科書的 N字(A=100 -> B=120 -> C=108 -> D=125)の後をフラットにした系列。

    D は 1 バーで一気にブレイクさせ、以降はフラットにする。こうすると D が
    index 31 に固定されたまま RECENCY_MAX_BARS の間は同じブレイクが連日ヒットし、
    重複排除の対象になる(段階的に上げると各バーが別々の高値=別ブレイクになる)。
    """
    closes = _path([(0, 100.0), (10, 120.0), (30, 108.0), (31, 125.0)], total=total)
    return _df(closes)


# --------------------------------------------------------------------------- #
# ② ウォークフォワード検出
# --------------------------------------------------------------------------- #
def test_walk_forward_dedups_same_break_date():
    """同じブレイクが連日ヒットしても break_date でユニーク化され1件になる。"""
    df = _n_pattern_df()

    signals = walk_forward_signals(df, "7203", "テスト")

    break_dates = [s["break_date"] for s in signals]
    assert len(break_dates) == len(set(break_dates))
    assert len(signals) == 1


def test_walk_forward_records_detected_date_and_lag():
    """detected_date は break_date 以降で、detect_lag_bars は非負。"""
    df = _n_pattern_df()

    signals = walk_forward_signals(df, "7203", "テスト")

    s = signals[0]
    assert s["detected_date"] >= s["break_date"]
    assert s["detect_lag_bars"] >= 0
    assert s["symbol"] == "7203"
    assert 0 <= s["score"] <= 100


def test_walk_forward_respects_start_end():
    """start より前・end より後の t では判定しない。"""
    df = _n_pattern_df()
    dates = iso_dates(df.index)

    all_signals = walk_forward_signals(df, "7203", "テスト")
    detected = all_signals[0]["detected_date"]
    after = walk_forward_signals(df, "7203", "テスト", start=dates[-1])
    before = walk_forward_signals(df, "7203", "テスト", end=dates[0])

    assert detected not in [s["detected_date"] for s in after]
    assert before == []


def test_walk_forward_returns_empty_below_min_bars():
    """MIN_BARS 未満のバー数では空を返す。"""
    df = _df(_linspace(100.0, 120.0, 10))

    assert walk_forward_signals(df, "7203", "テスト") == []


def test_walk_forward_does_not_mutate_input_df():
    """入力 DataFrame は呼び出し前後で変化しない。"""
    df = _n_pattern_df()
    before = df.copy(deep=True)

    walk_forward_signals(df, "7203", "テスト")

    pd.testing.assert_frame_equal(df, before)


# --------------------------------------------------------------------------- #
# 重複マーキング
# --------------------------------------------------------------------------- #
def _signal(symbol: str, detected_date: str) -> dict:
    return {"symbol": symbol, "detected_date": detected_date, "score": 70}


def test_mark_overlaps_flags_within_20_bars():
    """15 バー差の連続シグナルは2件目が overlaps_prev=True。"""
    bar_index_of = {"2026-01-05": 0, "2026-01-26": 15}
    signals = [_signal("7203", "2026-01-05"), _signal("7203", "2026-01-26")]

    marked = mark_overlaps(signals, bar_index_of)

    assert [m["overlaps_prev"] for m in marked] == [False, True]


def test_mark_overlaps_clears_beyond_20_bars():
    """25 バー差なら独立シグナルとして False(境界 OVERLAP_BARS の外)。"""
    bar_index_of = {"2026-01-05": 0, "2026-02-09": OVERLAP_BARS + 5}
    signals = [_signal("7203", "2026-01-05"), _signal("7203", "2026-02-09")]

    marked = mark_overlaps(signals, bar_index_of)

    assert [m["overlaps_prev"] for m in marked] == [False, False]


def test_mark_overlaps_anchors_to_last_kept_not_last_signal():
    """重複が連鎖しても、基準は「直前に残ったシグナル」。

    0 → 15 → 35 の並びで、15 は 0 と重なるので除外される。35 は 15 からは
    20 バーだが**残った** 0 からは 35 バー離れており、独立イベントとして残る。
    直前シグナル基準だと 35 まで巻き込まれて消える(独立イベントの取りこぼし)。
    """
    bar_index_of = {"2026-01-05": 0, "2026-01-26": 15, "2026-02-23": 35}
    signals = [
        _signal("7203", "2026-01-05"),
        _signal("7203", "2026-01-26"),
        _signal("7203", "2026-02-23"),
    ]

    marked = mark_overlaps(signals, bar_index_of)

    assert [m["overlaps_prev"] for m in marked] == [False, True, False]


def test_mark_overlaps_flags_all_within_window_of_kept():
    """残ったシグナルの窓に入るものは連続していてもすべて重複扱い。"""
    bar_index_of = {"2026-01-05": 0, "2026-01-12": 5, "2026-01-19": 10}
    signals = [
        _signal("7203", "2026-01-05"),
        _signal("7203", "2026-01-12"),
        _signal("7203", "2026-01-19"),
    ]

    marked = mark_overlaps(signals, bar_index_of)

    assert [m["overlaps_prev"] for m in marked] == [False, True, True]


def test_mark_overlaps_returns_new_objects():
    """入力 dict は変更されず、新しい dict が返る(イミュータブル)。"""
    bar_index_of = {"2026-01-05": 0, "2026-01-26": 15}
    signals = [_signal("7203", "2026-01-05"), _signal("7203", "2026-01-26")]

    marked = mark_overlaps(signals, bar_index_of)

    assert all("overlaps_prev" not in s for s in signals)
    assert all(m is not s for m, s in zip(marked, signals))


def test_mark_overlaps_is_per_symbol():
    """別銘柄のシグナルは近接していても重複扱いしない。"""
    bar_index_of = {"2026-01-05": 0, "2026-01-06": 1}
    signals = [_signal("7203", "2026-01-05"), _signal("6758", "2026-01-06")]

    marked = mark_overlaps(signals, bar_index_of)

    assert [m["overlaps_prev"] for m in marked] == [False, False]


# --------------------------------------------------------------------------- #
# ③ エントリー解決
# --------------------------------------------------------------------------- #
def test_weekly_entry_is_monday_after_signal_week():
    """金曜シグナルのエントリーは翌月曜(シグナル日を含めて週末を探す)。"""
    dates = iso_dates(pd.date_range("2026-01-05", periods=10, freq="B"))
    friday = dates.index("2026-01-09")

    entry = weekly_entry_index(dates, friday)

    assert dates[entry] == "2026-01-12"  # 翌月曜


def test_weekly_entry_when_week_last_bar_is_thursday():
    """金曜が休場の週は、その週の最終営業日(木曜)の翌営業日になる。"""
    dates = [d for d in iso_dates(pd.date_range("2026-01-05", periods=10, freq="B"))
             if d != "2026-01-09"]
    wednesday = dates.index("2026-01-07")

    entry = weekly_entry_index(dates, wednesday)

    assert dates[entry] == "2026-01-12"


def test_resolve_entries_lag_offsets():
    """next_open=i+1、lag_k=i+1+k のバー位置になる。"""
    dates = iso_dates(pd.date_range("2026-01-05", periods=30, freq="B"))
    i = 5

    entries = resolve_entries(dates, i)

    assert entries["next_open"] == i + 1
    assert entries["lag_1"] == i + 2
    assert entries["lag_3"] == i + 4
    assert entries["lag_5"] == i + 6


def test_resolve_entries_returns_none_beyond_data():
    """データ末尾のシグナルは全エントリーが None になる。"""
    dates = iso_dates(pd.date_range("2026-01-05", periods=10, freq="B"))

    entries = resolve_entries(dates, len(dates) - 1)

    assert all(v is None for v in entries.values())


def test_resolve_entries_rejects_entry_years_after_signal():
    """index が疎な銘柄では「翌バー」が数年後になる。そのエントリーは採用しない。

    バー位置だけで前を見ると、2 年後に買った結果が元のシグナル日に紐付いて残り、
    日付を揃えたランダム比較(§4.2)の前提が壊れる。
    """
    dates = iso_dates(
        list(pd.date_range("2023-09-01", periods=20, freq="B"))
        + list(pd.date_range("2025-12-01", periods=20, freq="B"))
    )

    across_gap = resolve_entries(dates, 19)   # ギャップ直前のシグナル
    inside = resolve_entries(dates, 5)        # 密な区間のシグナル(対照)

    assert all(v is None for v in across_gap.values())
    assert inside["next_open"] == 6


# --------------------------------------------------------------------------- #
# 暦日スパンのガード
# --------------------------------------------------------------------------- #
def test_max_calendar_span_covers_real_holiday_gaps():
    """実測の最大スパン(20バー=35日 / 60バー=96日)を上限が上回る。"""
    assert max_calendar_span_days(20) > 35
    assert max_calendar_span_days(60) > 96


def test_within_calendar_span_accepts_normal_holdings():
    """年末年始を跨いだ通常の20営業日保有は通る。"""
    assert within_calendar_span("2025-12-15", "2026-01-19", 20) is True


def test_within_calendar_span_rejects_delisting_gap():
    """上場廃止を跨いだ 2 年先のバーは弾く(8303 の実測 825 日)。"""
    assert within_calendar_span("2023-09-19", "2025-12-22", 20) is False


def test_within_calendar_span_rejects_reversed_dates():
    """exit が entry より前なら False(逆順を通さない)。"""
    assert within_calendar_span("2026-02-10", "2026-01-10", 20) is False


# --------------------------------------------------------------------------- #
# ③ アウトカム
# --------------------------------------------------------------------------- #
def test_compute_outcomes_fwd_and_mfe_mae():
    """手計算できる直線系列で fwd/mfe/mae/days_to_mfe が一致する。"""
    n = 100
    dates = iso_dates(pd.date_range("2026-01-05", periods=n, freq="B"))
    closes = [100.0 + i for i in range(n)]          # 1 日 +1 円の直線
    opens = closes
    highs = [c + 1.0 for c in closes]
    lows = [c - 1.0 for c in closes]

    out = compute_outcomes(dates, highs, lows, closes, opens, entry_idx=10)

    entry_px = 110.0
    assert out["entry_px"] == entry_px
    assert out["fwd20"] == pytest.approx(130.0 / entry_px - 1.0)
    assert out["fwd60"] == pytest.approx(170.0 / entry_px - 1.0)
    assert out["mfe"] == pytest.approx((170.0 + 1.0) / entry_px - 1.0)
    assert out["mae"] == pytest.approx((110.0 - 1.0) / entry_px - 1.0)
    assert out["mae"] < 0                            # MAE は負のまま返す
    assert out["days_to_mfe"] == 60


def test_compute_outcomes_returns_none_when_window_truncated():
    """保有期間が尽きていれば 0 ではなく None を返す(打ち切りバイアス回避)。"""
    n = 20
    dates = iso_dates(pd.date_range("2026-01-05", periods=n, freq="B"))
    closes = [100.0 + i for i in range(n)]

    out = compute_outcomes(dates, closes, closes, closes, closes, entry_idx=10)

    assert out["fwd20"] is None
    assert out["fwd60"] is None
    assert out["mfe"] is None
    assert out["mae"] is None
    assert out["days_to_mfe"] is None


def test_compute_outcomes_returns_none_when_bars_span_years():
    """バー数が足りていても暦日が離れすぎていれば None(上場廃止ギャップ)。

    ランダム側だけで落とすと N字側と母集団が食い違うため、判定は両側が通る
    compute_outcomes に置いてある。
    """
    n = 100
    dates = iso_dates(
        list(pd.date_range("2023-09-01", periods=20, freq="B"))
        + list(pd.date_range("2025-12-01", periods=n - 20, freq="B"))
    )
    closes = [100.0 + i for i in range(n)]

    out = compute_outcomes(dates, closes, closes, closes, closes, entry_idx=10)

    assert out["fwd20"] is None      # 2 年先のバーは「20 営業日のリターン」ではない
    assert out["fwd60"] is None
    assert out["mfe"] is None
    assert out["entry_px"] == 110.0  # エントリー自体は成立している


def test_benchmark_outcome_rounds_to_next_trading_day():
    """ベンチに entry_date が無ければ直後の営業日で計算する。"""
    dates = iso_dates(pd.date_range("2026-01-05", periods=100, freq="B"))
    opens = [200.0] * len(dates)
    closes = [200.0 + i for i in range(len(dates))]

    out = benchmark_outcome(dates, opens, closes, entry_date="2026-01-10")  # 土曜

    monday = dates.index("2026-01-12")
    assert out["topix_fwd20"] == pytest.approx(closes[monday + 20] / 200.0 - 1.0)


def test_benchmark_outcome_none_beyond_data():
    """ベンチのデータが尽きていれば None(0 で埋めない)。"""
    dates = iso_dates(pd.date_range("2026-01-05", periods=10, freq="B"))
    opens = [200.0] * len(dates)

    out = benchmark_outcome(dates, opens, opens, entry_date=dates[0])

    assert out["topix_fwd20"] is None
    assert out["topix_fwd60"] is None


# --------------------------------------------------------------------------- #
# 統計
# --------------------------------------------------------------------------- #
def test_block_bootstrap_is_deterministic_with_seed():
    """同じ seed なら結果が完全一致する。"""
    values_by_date = {f"2026-01-{d:02d}": [0.01 * d, 0.02 * d] for d in range(1, 11)}

    a = block_bootstrap_means(values_by_date, n_iter=200, seed=42)
    b = block_bootstrap_means(values_by_date, n_iter=200, seed=42)

    assert a == b
    assert len(a) == 200


def test_block_bootstrap_resamples_dates_not_symbols():
    """日付単位の再抽出は銘柄単位より分散が大きくなる(§4.3 の核心)。

    「1日に10銘柄」の塊があると、その日が引かれるかどうかで平均が大きく動く。
    銘柄単位で引くと塊が崩れて分散が過小評価され、有意でないものが有意に見える。
    """
    clustered = {"2026-01-05": [0.10] * 10, "2026-01-06": [-0.10]}
    flat = {f"2026-01-{d:02d}": [v] for d, v in
            enumerate([0.10] * 10 + [-0.10], start=5)}

    by_date = block_bootstrap_means(clustered, n_iter=500, seed=7)
    by_symbol = block_bootstrap_means(flat, n_iter=500, seed=7)

    def _var(xs: list[float]) -> float:
        m = sum(xs) / len(xs)
        return sum((x - m) ** 2 for x in xs) / len(xs)

    assert _var(by_date) > _var(by_symbol)


def test_block_bootstrap_empty_input():
    """空入力では空リスト(例外にしない)。"""
    assert block_bootstrap_means({}, n_iter=100, seed=0) == []


def test_paired_bootstrap_cancels_common_market_move():
    """同じ日を両系列から引くので、地合いの変動が対応付きで打ち消える。

    各日で差が +1% 固定の系列を渡すと、差の分布は 1% の一点に潰れる。
    一方それぞれの平均は日によって ±10% 動くため分布が広い。差を直接
    ブートストラップしないと、この共通変動の分だけ有意性を見誤る。
    """
    a = {"2026-01-05": [0.10], "2026-01-06": [-0.10]}
    b = {"2026-01-05": [0.09], "2026-01-06": [-0.11]}

    diffs = paired_block_bootstrap_diffs(a, b, n_iter=200, seed=3)
    a_means = block_bootstrap_means(a, n_iter=200, seed=3)

    assert len(diffs) == 200
    assert all(abs(d - 0.01) < 1e-12 for d in diffs)
    assert max(a_means) - min(a_means) > 0.01  # 個別系列は大きく振れる


def test_paired_bootstrap_is_deterministic_with_seed():
    """同じ seed なら結果が完全一致する。"""
    a = {f"2026-01-{d:02d}": [0.01 * d] for d in range(1, 11)}
    b = {f"2026-01-{d:02d}": [0.005 * d] for d in range(1, 11)}

    assert paired_block_bootstrap_diffs(a, b, n_iter=100, seed=1) == \
        paired_block_bootstrap_diffs(a, b, n_iter=100, seed=1)


def test_paired_bootstrap_uses_only_common_dates():
    """片方にしか無い日付は引かない。共通日付が無ければ空リスト。"""
    a = {"2026-01-05": [0.10], "2026-01-06": [0.20]}
    b = {"2026-01-05": [0.05]}

    diffs = paired_block_bootstrap_diffs(a, b, n_iter=50, seed=0)

    assert all(abs(d - 0.05) < 1e-12 for d in diffs)
    assert paired_block_bootstrap_diffs(a, {"2026-03-01": [0.0]}, n_iter=50, seed=0) == []
    assert paired_block_bootstrap_diffs({}, {}, n_iter=50, seed=0) == []


def test_percentile_of_bounds():
    """最小値未満は 0 付近、最大値は 100。"""
    dist = [float(i) for i in range(100)]

    assert percentile_of(dist, -1.0) == 0.0
    assert percentile_of(dist, 99.0) == 100.0
    assert percentile_of([], 0.0) != percentile_of([], 0.0)  # nan は自身と等しくない


def test_confidence_interval_covers_center():
    """95% CI は分布の中心を挟み、下限 < 上限。"""
    dist = [float(i) for i in range(1000)]

    lo, hi = confidence_interval(dist)

    assert lo < 500.0 < hi
    assert lo < hi
