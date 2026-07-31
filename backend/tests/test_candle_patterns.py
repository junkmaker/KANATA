"""Unit tests for analysis/candle_patterns.py。

定義は apps/renderer/src/lib/candlePatterns.ts と一致させる契約なので、
閾値の境界と鏡像関係（明けの明星 ⇄ 宵の明星）を明示的に固定する。
純関数のみを対象にするため、ファイル I/O にもネットワークにも触らない。
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.analysis import candle_patterns as cp


def _df(bars: list[tuple[float, float, float, float]]) -> pd.DataFrame:
    """(o, h, l, c) のリストから DataFrame を作る。"""
    return pd.DataFrame(bars, columns=["Open", "High", "Low", "Close"])


# --------------------------------------------------------------------------- #
# 1 本構成
# --------------------------------------------------------------------------- #
def test_doji_detects_small_body_only():
    hit = cp.detect_doji(_df([(100, 110, 90, 100.5), (100, 110, 90, 108)]))
    assert hit.tolist() == [True, False]


def test_doji_ignores_zero_range():
    """レンジ 0 は非検出（実体 0 でも「同時線」と呼ばない）。"""
    assert cp.detect_doji(_df([(100, 100, 100, 100)])).tolist() == [False]


def test_hammer_requires_long_lower_and_short_upper_shadow():
    hammer = (100, 101, 90, 100.5)   # 下ヒゲ 10、実体 0.5、上ヒゲ 0.5
    inverted = (100, 110, 99.5, 100.5)
    hit = cp.detect_hammer(_df([hammer, inverted]))
    assert hit.tolist() == [True, False]


def test_shooting_star_is_the_mirror_of_hammer():
    """流れ星はハンマーの上下反転。同じ形を反転させれば入れ替わる。"""
    hammer = _df([(100, 101, 90, 100.5)])
    flipped = _df([(100, 110, 99, 99.5)])
    assert cp.detect_hammer(hammer).tolist() == [True]
    assert cp.detect_shooting_star(hammer).tolist() == [False]
    assert cp.detect_shooting_star(flipped).tolist() == [True]


# --------------------------------------------------------------------------- #
# 2 本構成
# --------------------------------------------------------------------------- #
def test_bullish_engulfing_needs_prev_bearish_and_full_cover():
    bars = _df([
        (110, 112, 104, 105),   # 陰線
        (104, 116, 103, 115),   # 陽線が前足の実体を包む
    ])
    assert cp.detect_bullish_engulfing(bars).tolist() == [False, True]


def test_bullish_engulfing_rejects_partial_cover():
    """当足の始値が前足の終値を上回っていたら「包んで」いない。"""
    bars = _df([(110, 112, 104, 105), (106, 116, 105, 115)])
    assert cp.detect_bullish_engulfing(bars).tolist() == [False, False]


def test_bearish_engulfing_is_the_mirror():
    bars = _df([(105, 112, 104, 110), (115, 116, 103, 104)])
    assert cp.detect_bearish_engulfing(bars).tolist() == [False, True]
    assert cp.detect_bullish_engulfing(bars).tolist() == [False, False]


# --------------------------------------------------------------------------- #
# 3 本構成（明星）
# --------------------------------------------------------------------------- #
MORNING = [
    (110, 111, 99, 100),     # 大陰線（実体 10 / レンジ 12）
    (98, 99.5, 97, 98.3),    # 小実体（実体 0.3 / レンジ 2.5）
    (99, 107, 98.5, 106),    # 陽線が 1本目の実体中点 105 を上回る
]


def test_morning_star_marks_the_third_bar():
    """3 本構成のパターンは **最終バー** の位置に True を立てる。"""
    assert cp.detect_morning_star(_df(MORNING)).tolist() == [False, False, True]


def test_morning_star_rejects_close_below_first_midpoint():
    """3本目が 1本目の実体中点（105）を上回らなければ不成立。"""
    bars = MORNING[:2] + [(99, 105, 98.5, 104)]
    assert cp.detect_morning_star(_df(bars)).tolist() == [False, False, False]


def test_morning_star_rejects_large_star_body():
    """2本目の実体がレンジの STAR_BODY_RATIO を超えたら「星」ではない。"""
    bars = [MORNING[0], (97.2, 99.5, 97, 99.3), MORNING[2]]
    assert cp.detect_morning_star(_df(bars)).tolist() == [False, False, False]


def test_require_gap_is_stricter_than_the_default():
    """既定は窓を要求しない（TS 側の宵の明星に合わせている）。

    ``MORNING`` は星の上端 98.3 が大陰線の実体下端 100 を下回るので窓あり。
    窓なしの例では既定だけが成立し、``require_gap=True`` では落ちる。
    """
    # 星の実体（100.5〜100.8）が 1本目の実体（100〜110）と重なる＝窓なし
    no_gap = [MORNING[0], (100.5, 102, 99, 100.8), (101, 107, 100.5, 106)]

    assert cp.detect_morning_star(_df(no_gap)).tolist() == [False, False, True]
    assert not cp.detect_morning_star(_df(no_gap), require_gap=True).any()
    # 窓ありの MORNING は両方で成立する（厳密版は部分集合）
    assert cp.detect_morning_star(_df(MORNING), require_gap=True).tolist() == [False, False, True]


def test_evening_star_is_the_price_mirror_of_morning_star():
    """価格を反転（x → -x）させると明けの明星と宵の明星が入れ替わる。

    鏡像であることを別々の定数で書き下すのではなく、変換で確かめる。
    """
    flipped = _df([(-o, -l, -h, -c) for o, h, l, c in MORNING])
    assert cp.detect_evening_star(flipped).tolist() == [False, False, True]
    assert cp.detect_morning_star(flipped).tolist() == [False, False, False]


# --------------------------------------------------------------------------- #
# 契約
# --------------------------------------------------------------------------- #
def test_detect_dispatches_and_rejects_unknown_names():
    hit = cp.detect("morning_star", _df(MORNING))
    assert hit.tolist() == [False, False, True]
    with pytest.raises(ValueError, match="unknown pattern"):
        cp.detect("golden_cross", _df(MORNING))


@pytest.mark.parametrize("name", cp.PATTERN_NAMES)
def test_every_detector_returns_bool_array_of_input_length(name):
    """短すぎる入力でも例外を投げず、長さの揃った bool 配列を返す。"""
    for bars in ([], [(1.0, 2.0, 0.5, 1.5)], MORNING):
        df = _df(bars) if bars else _df([(1.0, 2.0, 0.5, 1.5)]).iloc[:0]
        hit = cp.detect(name, df)
        assert hit.dtype == np.bool_
        assert len(hit) == len(df)


def test_missing_column_raises():
    df = pd.DataFrame({"Open": [1.0], "High": [2.0], "Close": [1.5]})
    with pytest.raises(ValueError, match="missing columns"):
        cp.detect_doji(df)


def test_labels_and_signals_cover_every_pattern():
    """検出器・表示名・シグナル方向の 3 つが常に揃っていること。"""
    assert set(cp.LABELS) == set(cp.PATTERN_NAMES)
    assert set(cp.SIGNALS) == set(cp.PATTERN_NAMES)
