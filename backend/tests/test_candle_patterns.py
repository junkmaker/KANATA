"""Unit tests for analysis/candle_patterns.py。

定義は apps/renderer/src/lib/candlePatterns.ts と一致させる契約なので、
閾値の境界と鏡像関係（明けの明星 ⇄ 宵の明星）を明示的に固定する。
純関数のみを対象にするため、ファイル I/O にもネットワークにも触らない。
"""
from __future__ import annotations

import json
from pathlib import Path

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


HARAMI = [
    (110, 112, 99, 100),     # 大陰線（実体 10 / レンジ 13）
    (104, 107, 103, 106),    # 小陽線が前足の実体（100〜110）に収まる
]


def test_bullish_harami_needs_large_prev_body_and_containment():
    assert cp.detect_bullish_harami(_df(HARAMI)).tolist() == [False, True]
    # 包みとは内外が逆なので同時には立たない
    assert cp.detect_bullish_engulfing(_df(HARAMI)).tolist() == [False, False]


def test_harami_rejects_small_prev_body():
    """前足の実体がレンジの HARAMI_BODY_RATIO 未満なら「はらむ」大実体ではない。"""
    bars = [(103, 112, 99, 100), HARAMI[1]]   # 実体 3 < 0.3 * 13
    assert cp.detect_bullish_harami(_df(bars)).tolist() == [False, False]


def test_harami_rejects_body_outside_prev_body():
    bars = [HARAMI[0], (104, 113, 103, 111)]  # 実体上端 111 が前足の 110 を超える
    assert cp.detect_bullish_harami(_df(bars)).tolist() == [False, False]


def test_bearish_harami_is_the_price_mirror_of_bullish_harami():
    """価格を反転（x → -x）させると陽線はらみと陰線はらみが入れ替わる。"""
    flipped = _df([(-o, -l, -h, -c) for o, h, l, c in HARAMI])
    assert cp.detect_bearish_harami(flipped).tolist() == [False, True]
    assert cp.detect_bullish_harami(flipped).tolist() == [False, False]


def test_identical_bodies_fire_both_harami_and_engulfing():
    """実体が完全一致する縮退ケースでは inclusive な不等号により両方が立つ。

    既存 engulfing の <= / >= に合わせた結果であり、実データでは事実上出ない。
    挙動を固定しておくのは、片方だけ strict に変えた変更を検出するため。
    """
    bars = _df([(110, 112, 99, 100), (100, 116, 98, 110)])
    assert cp.detect_bullish_harami(bars).tolist() == [False, True]
    assert cp.detect_bullish_engulfing(bars).tolist() == [False, True]


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
# 窓（ギャップ）と 3 本構成の継続パターン
# --------------------------------------------------------------------------- #
def test_gap_helpers_use_high_low_and_reject_touching():
    """高安基準。接触（前足の高値 == 当足の安値）は窓ではない。"""
    assert bool(cp.has_gap_up(prev_high=100.0, cur_low=101.0)) is True
    assert bool(cp.has_gap_up(prev_high=100.0, cur_low=100.0)) is False
    assert bool(cp.has_gap_down(prev_low=100.0, cur_high=99.0)) is True
    assert bool(cp.has_gap_down(prev_low=100.0, cur_high=100.0)) is False


def test_gap_helpers_reject_positional_arguments():
    """引数はキーワード専用（位置引数は TypeError）。

    上窓と下窓では見る値が上下反転するため、位置引数を許すと取り違えても例外にならず
    「検出が多すぎる」形でしか現れない。呼び出し側に値の意味を書かせて防ぐ。
    """
    with pytest.raises(TypeError):
        cp.has_gap_up(100.0, 101.0)
    with pytest.raises(TypeError):
        cp.has_gap_down(100.0, 99.0)


TWO_BLACK = [
    (100, 108, 99, 106),     # 窓の手前のバー（安値 99）
    (96, 98, 92, 93),        # 陰線。高値 98 < 99 なので下窓
    (92, 93, 87, 88),        # 陰線。終値 88 < 93 で切り下げる
]


def test_two_black_gapping_marks_the_third_bar():
    """3 本構成のパターンは **最終バー** の位置に True を立てる。"""
    assert cp.detect_two_black_gapping(_df(TWO_BLACK)).tolist() == [False, False, True]


def test_two_black_gapping_rejects_overlapping_shadows():
    """実体は離れていてもヒゲが重なれば窓ではない（高安基準の肝）。"""
    # 高値 100 が手前のバーの安値 99 を上回る。実体基準なら窓ありと判定される形
    bars = [TWO_BLACK[0], (96, 100, 92, 93), TWO_BLACK[2]]
    assert not cp.detect_two_black_gapping(_df(bars)).any()


def test_two_black_gapping_rejects_rising_close():
    """2 本目が終値を切り下げなければ「二本黒」の継続にならない。"""
    bars = TWO_BLACK[:2] + [(95, 96, 93, 94)]   # 陰線だが終値 94 > 93
    assert not cp.detect_two_black_gapping(_df(bars)).any()


SIDE_BY_SIDE = [
    (100, 105, 98, 104),     # 窓の手前のバー（高値 105）
    (108, 113, 107, 112),    # 陽線。安値 107 > 105 なので上窓
    (108.4, 115, 108, 114),  # 陽線。始値の差 0.4 <= 0.005 * 108 = 0.54
]


def test_upside_gap_two_white_marks_the_third_bar():
    assert cp.detect_upside_gap_two_white(_df(SIDE_BY_SIDE)).tolist() == [False, False, True]


def test_upside_gap_two_white_rejects_open_beyond_tolerance():
    """始値が SIDE_BY_SIDE_OPEN_TOLERANCE を超えてずれたら「並び」ではない。"""
    bars = SIDE_BY_SIDE[:2] + [(109, 115, 108.5, 114)]   # 差 1.0 > 0.54
    assert not cp.detect_upside_gap_two_white(_df(bars)).any()


def test_gap_patterns_are_not_mirrors_of_each_other():
    """窓系 2 種は鏡像ペアではない（価格を反転しても相手は立たない）。

    下放れ二本黒は終値の切り下げ、上放れ並び赤は始値の一致を要求しており、
    条件が非対称。鏡像テストを書かない理由をここで固定しておく。
    """
    flipped = _df([(-o, -l, -h, -c) for o, h, l, c in TWO_BLACK])
    assert not cp.detect_upside_gap_two_white(flipped).any()
    assert not cp.detect_two_black_gapping(flipped).any()


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


# --------------------------------------------------------------------------- #
# TS との一致（共有フィクスチャ）
# --------------------------------------------------------------------------- #
FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "candle_patterns_cases.json"
)
FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_fixture_patterns_are_all_registered():
    """フィクスチャが参照する型は全て Python 側に存在すること。"""
    assert set(FIXTURE["patterns"]) <= set(cp.PATTERN_NAMES)
    for name in FIXTURE["patterns"]:
        assert cp.LABELS[name] == FIXTURE["labels"][name]
        assert cp.SIGNALS[name] == FIXTURE["signals"][name]


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["name"])
def test_shared_fixture_cases_match(case):
    """共有ケースの検出 index が期待と完全一致すること（TS 側と同じ表明）。

    ``expect`` は網羅。キーの無いパターンは 0 件でなければならない。
    """
    df = _df([tuple(b) for b in case["bars"]])
    actual = {
        name: np.flatnonzero(cp.detect(name, df)).tolist()
        for name in FIXTURE["patterns"]
    }
    expected = {name: case["expect"].get(name, []) for name in FIXTURE["patterns"]}
    assert actual == expected
