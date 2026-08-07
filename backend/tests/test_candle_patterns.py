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
# トレンド文脈の助走（ハンマー / 首吊り線）
#
# それ自体はどのパターンも発火させない 11 本。ハンマー/首吊り線は
# HAMMER_TREND_LOOKBACK + 1 = 12 本目以降でしか成立しないため、文脈系のテストは
# 必ずこれを前置する。**TS 側テストとフィクスチャで同じ数値を使っている。**
#
# 全バーが同色（陰線 or 陽線）なので包み・はらみ・明星が成立せず、
# 実体 5 / レンジ 7 なので同時線にもハンマー型にもならず、
# 隣接バーのレンジが重なるので窓も開かない。
# --------------------------------------------------------------------------- #
DOWNTREND = [(200 - 5 * k, 201 - 5 * k, 194 - 5 * k, 195 - 5 * k) for k in range(11)]
UPTREND = [(100 + 5 * k, 106 + 5 * k, 99 + 5 * k, 105 + 5 * k) for k in range(11)]
# 騰落率 -2.56%（±5% の帯の中）。形状が成立してもどちらも出さない
FLAT = [(200 - 0.5 * k, 201 - 0.5 * k, 194 - 0.5 * k, 195 - 0.5 * k) for k in range(11)]

# 助走の直後に置くハンマー型のバー（実体 1.5 / レンジ 12 / 下ヒゲ 10 / 上ヒゲ 0.5）。
# 実体がレンジの 10% を超えるので同時線とは同時に立たない
HAMMER_BAR_AFTER_DOWN = (142, 144, 132, 143.5)
HAMMER_BAR_AFTER_UP = (157, 159, 147, 158.5)
HAMMER_BAR_AFTER_FLAT = (187, 189, 177, 188.5)


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
    """形状条件（長い下ヒゲ・短い上ヒゲ）。トレンド文脈は下降で満たしておく。"""
    inverted = (142, 154, 141.5, 143.5)   # 上ヒゲが長く下ヒゲが無い
    hit = cp.detect_hammer(_df(DOWNTREND + [HAMMER_BAR_AFTER_DOWN]))
    assert hit.tolist() == [False] * 11 + [True]
    assert not cp.detect_hammer(_df(DOWNTREND + [inverted])).any()


def test_shooting_star_stays_shape_only_while_hammer_needs_context():
    """流れ星は形状のみ・ハンマーは形状 + 文脈。**Python 内に残す意図した非対称**。

    UI に出さない検出器（流れ星）を変更してもユーザーに見える利得が無いため、
    三分化は `hammer` 側だけに入れた（PRD「NOT Building」/ 解消は Phase 6）。
    """
    hammer_shaped = _df([(100, 101, 90, 100.5)])
    star_shaped = _df([(100, 110, 99, 99.5)])

    # 流れ星は 1 本だけで成立する（文脈を見ない）
    assert cp.detect_shooting_star(star_shaped).tolist() == [True]
    assert cp.detect_shooting_star(hammer_shaped).tolist() == [False]
    # ハンマーは形状が揃っていても助走が無ければ成立しない
    assert cp.detect_hammer(hammer_shaped).tolist() == [False]


def test_trend_change_ratio_ends_at_the_previous_bar():
    """終点は当日ではなく直前バー（ハンマー自身の戻しを判定に混ぜない）。"""
    close = np.array([100.0] * 11 + [200.0, 300.0])
    ratio = cp.trend_change_ratio(close)
    # idx 11 は close[10]=100 と close[0]=100 の比 → 0（当日の 200 は入らない）
    assert ratio[11] == pytest.approx(0.0)
    # idx 12 は close[11]=200 と close[1]=100 の比 → +100%
    assert ratio[12] == pytest.approx(1.0)


def test_trend_change_ratio_is_nan_where_the_lookback_does_not_fit():
    """先頭 HAMMER_TREND_LOOKBACK + 1 本と分母 0 は NaN（どちらの文脈にも該当しない）。"""
    ratio = cp.trend_change_ratio(np.arange(1.0, 21.0))
    assert np.isnan(ratio[:11]).all()
    assert not np.isnan(ratio[11:]).any()
    assert np.isnan(cp.trend_change_ratio(np.array([1.0, 2.0]))).all()
    zero_base = cp.trend_change_ratio(np.array([0.0] + [1.0] * 11))
    assert np.isnan(zero_base[11])


def test_hanging_man_needs_an_uptrend_and_hammer_needs_a_downtrend():
    """同一形状がトレンド文脈だけで振り分けられる（PRD Q2 の三分化）。"""
    after_down = _df(DOWNTREND + [HAMMER_BAR_AFTER_DOWN])
    after_up = _df(UPTREND + [HAMMER_BAR_AFTER_UP])

    assert cp.detect_hammer(after_down)[11]
    assert not cp.detect_hanging_man(after_down).any()
    assert cp.detect_hanging_man(after_up)[11]
    assert not cp.detect_hammer(after_up).any()


def test_flat_trend_yields_neither_hammer_nor_hanging_man():
    """±HAMMER_TREND_RATIO の帯の中はどちらも出さない（三分の 3 つ目）。"""
    flat = _df(FLAT + [HAMMER_BAR_AFTER_FLAT])
    assert not cp.detect_hammer(flat).any()
    assert not cp.detect_hanging_man(flat).any()


def test_hammer_and_hanging_man_never_fire_on_the_same_bar():
    """排他（PRD Q1）。しきい値が対称かつ 0 でないので重なりようがない。"""
    for prefix, last in (
        (DOWNTREND, HAMMER_BAR_AFTER_DOWN),
        (UPTREND, HAMMER_BAR_AFTER_UP),
        (FLAT, HAMMER_BAR_AFTER_FLAT),
    ):
        df = _df(prefix + [last])
        assert not (cp.detect_hammer(df) & cp.detect_hanging_man(df)).any()


def test_hammer_and_hanging_man_are_not_price_mirrors():
    """価格反転（x → -x）では入れ替わらない。**鏡像テストを書かない理由の固定**。

    反転すると形状が流れ星型に変わる一方、騰落率 (c[i-1]-c[i-11])/c[i-11] は
    分子・分母が同時に符号反転するため **値が変わらない**。つまり反転後は
    「下降文脈のまま形状だけ流れ星」になり、首吊り線は成立しない。
    """
    flipped = _df([(-o, -l, -h, -c) for o, h, l, c in DOWNTREND + [HAMMER_BAR_AFTER_DOWN]])
    assert not cp.detect_hanging_man(flipped).any()
    assert not cp.detect_hammer(flipped).any()
    # 騰落率そのものが不変であることを直接固定する
    close = np.array([c for *_, c in DOWNTREND + [HAMMER_BAR_AFTER_DOWN]])
    assert cp.trend_change_ratio(close)[11] == pytest.approx(
        cp.trend_change_ratio(-close)[11]
    )


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
# 可変長構成（アイランド）
# --------------------------------------------------------------------------- #
ISLAND_TOP = [
    (100, 105, 98, 104),     # 窓の手前のバー（高値 105）
    (110, 115, 108, 112),    # 島 1 本目。安値 108 > 105 なので上窓
    (111, 116, 107, 108),    # 島 2 本目
    (100, 104, 95, 96),      # 確定バー。高値 104 < 107 なので下窓
]


def test_island_top_marks_the_bar_after_the_exit_gap():
    """確定バーは **出口の窓の後**（島の最終バーではない）。"""
    assert cp.detect_island_top(_df(ISLAND_TOP)).tolist() == [False, False, False, True]
    assert not cp.detect_island_bottom(_df(ISLAND_TOP)).any()


def test_island_bottom_is_the_price_mirror_of_island_top():
    """価格を反転（x → -x）させると天井と底が入れ替わる。"""
    flipped = _df([(-o, -l, -h, -c) for o, h, l, c in ISLAND_TOP])
    assert cp.detect_island_bottom(flipped).tolist() == [False, False, False, True]
    assert not cp.detect_island_top(flipped).any()


def test_island_requires_both_gaps():
    """入口だけ・出口だけでは成立しない。"""
    no_exit = ISLAND_TOP[:3] + [(107, 112, 106, 111)]     # 高値 112 > 107 で下窓なし
    no_entry = [(100, 112, 98, 111)] + ISLAND_TOP[1:]     # 高値 112 > 108 で上窓なし
    assert not cp.detect_island_top(_df(no_exit)).any()
    assert not cp.detect_island_top(_df(no_entry)).any()


def test_island_accepts_a_single_bar_island():
    """島 1 本（入口の窓の直後が出口の窓）も成立する。"""
    bars = [ISLAND_TOP[0], ISLAND_TOP[1], (100, 104, 95, 96)]   # 安値 108 > 高値 104
    assert cp.detect_island_top(_df(bars)).tolist() == [False, False, True]


def test_island_allows_an_internal_gap():
    """島の内部に窓があってもよい（島の定義は両端の窓のみ・PRD Q6）。"""
    bars = [
        (100, 105, 98, 104),
        (110, 115, 108, 112),
        (120, 125, 118, 124),    # 島の内部に上窓（115 < 118）
        (100, 104, 95, 96),      # 出口の下窓（118 > 104）
    ]
    assert cp.detect_island_top(_df(bars)).tolist() == [False, False, False, True]


# 上窓 1 つのあと下窓が 4 本続く。島は最初の下窓で終わるので成立は 1 件だけ。
# 逆向きの内部の窓を無視すると 1 つの入口の窓が後続すべての出口に使い回され、
# idx 5 の「島」に入口の窓の手前（高値 105）より下のバーまで入ってしまう
ISLAND_STAIRCASE_DOWN = [
    (100, 105, 98, 104),     # 窓の手前のバー（高値 105）
    (110, 115, 108, 112),    # 島。安値 108 > 105 なので上窓
    (96, 106, 95, 100),      # 下窓（108 > 106）＝ここが島の出口
    (86, 94, 85, 90),        # さらに下窓（95 > 94）
    (76, 84, 75, 80),        # さらに下窓（85 > 84）
    (66, 74, 65, 70),        # さらに下窓（75 > 74）
]


def test_island_stops_at_an_opposite_internal_gap():
    """逆向きの内部の窓は島を終わらせる（入口の窓を後続の出口に使い回さない）。"""
    hit = cp.detect_island_top(_df(ISLAND_STAIRCASE_DOWN))
    assert hit.tolist() == [False, False, True, False, False, False]


def test_island_bottom_stops_at_an_opposite_internal_gap():
    """底側も同じ（``exited`` / ``entered`` の向きが対称であることの確認）。"""
    flipped = _df([(-o, -l, -h, -c) for o, h, l, c in ISLAND_STAIRCASE_DOWN])
    hit = cp.detect_island_bottom(flipped)
    assert hit.tolist() == [False, False, True, False, False, False]


ISLAND_LONG = [
    (100, 105, 98, 104),     # 窓の手前のバー
    (110, 115, 108, 112),    # 島 1 本目（上窓）
    (112, 116, 109, 114),
    (114, 118, 111, 116),
    (116, 120, 113, 118),
    (118, 122, 115, 120),    # 島 5 本目
    (120, 124, 117, 122),    # 島 6 本目
    (110, 116, 105, 106),    # 確定バー候補
]


def test_island_accepts_exactly_max_len():
    """島がちょうど ISLAND_MAX_LEN 本なら成立する（境界の内側）。"""
    bars = ISLAND_LONG[:6] + [(110, 114, 105, 106)]   # 島 5 本 + 出口の下窓（115 > 114）
    assert cp.detect_island_top(_df(bars)).tolist() == [False] * 6 + [True]


def test_island_rejects_longer_than_max_len():
    """島が ISLAND_MAX_LEN を超えると入口の窓が探索範囲の外に出る。"""
    assert not cp.detect_island_top(_df(ISLAND_LONG)).any()


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
