"""ローソク足パターンの検出（純関数のみ・I/O なし）。

定義と閾値は **レンダラーの `apps/renderer/src/lib/candlePatterns.ts` と一致させている**。
チャートに描かれるものと検証対象がズレると、検証結果を UI に持ち込めないため。
片方だけ変更してはいけない（変更時は両方 + テストを揃える）。

`morning_star` / `bearish_engulfing` / `bearish_harami` は、それぞれ
`evening_star` / `bullish_engulfing` / `bullish_harami` の厳密な鏡像として定義した。
このうち鏡像側が TS に無いのは `shooting_star`（流れ星）だけで、TS 10 種 / Python 11 種の
非対称はこの 1 つに由来する（流れ星の TS 移植は逆ハンマーとの文脈問題と併せて別フェーズ）。
**種類を増やしたらこの行も更新すること** — 両側の種類数を述べているのはここだけで、
フィクスチャは手で保守するため、TS への追加漏れをテストで捕まえられない。
共有フィクスチャ `tests/fixtures/candle_patterns_cases.json` の ``patterns`` から
`shooting_star` を除いてあるのは、この非対称が一致テストを壊さないようにするため。

`n_pattern.py` と同じく pandas.DataFrame を受け取るだけで、yfinance 取得や
ファイル I/O は一切行わない（呼び出し側 = scripts/candle_backtest.py が担う）。

各検出器は「そのバーでパターンが成立したか」を表す bool 配列（長さ = len(df)）を返す。
複数バー構成のパターンでは **最終バーの位置** に True が立つ。

Phase 3 で追加予定の型名（先に確定済み。並行実装のコンフリクトを避けるため）:
    hanging_man(首吊り線) / island_top(アイランド天井) / island_bottom(アイランドボトム)
"""
from __future__ import annotations

from collections.abc import Callable

import numpy as np
import pandas as pd

# --------------------------------------------------------------------------- #
# 閾値（candlePatterns.ts と同じ値。マジックナンバー禁止）
# --------------------------------------------------------------------------- #
DOJI_BODY_RATIO = 0.1      # 実体がレンジの 10% 以下なら同時線
HAMMER_LOWER_RATIO = 2.0   # 下ヒゲが実体の 2 倍以上
HAMMER_UPPER_RATIO = 0.25  # 上ヒゲがレンジの 25% 以下
STAR_BODY_RATIO = 0.3      # 明星の 1本目の大実体 / 2本目の小実体（レンジ比）
HARAMI_BODY_RATIO = 0.3    # はらみの前足に要求する大実体（レンジ比）
SIDE_BY_SIDE_OPEN_TOLERANCE = 0.005  # 「並び」と見なす始値の相対許容差（0.5%）

REQUIRED_COLUMNS = ("Open", "High", "Low", "Close")

LABELS: dict[str, str] = {
    "bullish_engulfing": "陽線包み",
    "bearish_engulfing": "陰線包み",
    "bullish_harami": "陽線はらみ",
    "bearish_harami": "陰線はらみ",
    "doji": "同時線",
    "hammer": "ハンマー",
    "shooting_star": "流れ星",
    "morning_star": "明けの明星",
    "evening_star": "宵の明星",
    "two_black_gapping": "下放れ二本黒",
    "upside_gap_two_white": "上放れ並び赤",
}

SIGNALS: dict[str, str] = {
    "bullish_engulfing": "bullish",
    "bearish_engulfing": "bearish",
    "bullish_harami": "bullish",
    "bearish_harami": "bearish",
    "doji": "neutral",
    "hammer": "bullish",
    "shooting_star": "bearish",
    "morning_star": "bullish",
    "evening_star": "bearish",
    "two_black_gapping": "bearish",
    "upside_gap_two_white": "bullish",
}


def _ohlc(df: pd.DataFrame) -> tuple[np.ndarray, ...]:
    """OHLC を float の ndarray で取り出す。列が欠けていれば ValueError。"""
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"missing columns: {missing}")
    return tuple(df[c].astype(float).to_numpy() for c in REQUIRED_COLUMNS)


def _empty(n: int) -> np.ndarray:
    return np.zeros(n, dtype=bool)


def _place(n: int, offset: int, ok: np.ndarray) -> np.ndarray:
    """先頭 offset 本ぶんずらして bool 配列に埋める（最終バー位置に True を立てる）。"""
    hit = _empty(n)
    if len(ok):
        hit[offset:] = np.nan_to_num(ok, nan=False).astype(bool)
    return hit


# --------------------------------------------------------------------------- #
# 窓（ギャップ）の判定 — 高安基準
#
# ヒゲを含めて重ならないことを窓とする。見た目の「窓」と表示を一致させるため。
# **明星の ``require_gap`` は実体基準**（星の実体が 1 本目の実体の外にあるか）で
# 基準が違う。既定 off で UI 経路では未使用のため統一していない（PRD 決定）。
#
# ndarray 同士の比較を想定しているが、numpy のブロードキャストによりスカラーでも
# 同じ式で判定できる。Phase 3 のアイランドは可変長のため明示ループになり、
# その中からスカラーで呼ぶ。
#
# **引数はキーワード専用にしてある。** 2 つのヘルパは「前足 → 当足」の順序こそ同じだが、
# 見る値が上下反転する（上窓は前足の**高値**と当足の**安値**、下窓は前足の**安値**と
# 当足の**高値**）。位置引数を許すと `has_gap_up(h, l)` を真似た `has_gap_down(h, l)` が
# 無言で `prev_high > cur_low` を計算し、ほぼ全バーで True になる。誤りが例外にならず
# 「検出が多すぎる」形でしか現れないため、呼び出し側に値の意味を書かせる。
# --------------------------------------------------------------------------- #
def has_gap_up(*, prev_high: np.ndarray, cur_low: np.ndarray) -> np.ndarray:
    """上窓: 前足の高値が当足の安値を下回る（接触は窓ではない）。"""
    return prev_high < cur_low


def has_gap_down(*, prev_low: np.ndarray, cur_high: np.ndarray) -> np.ndarray:
    """下窓: 前足の安値が当足の高値を上回る（接触は窓ではない）。"""
    return prev_low > cur_high


# --------------------------------------------------------------------------- #
# 1 本構成
# --------------------------------------------------------------------------- #
def detect_doji(df: pd.DataFrame) -> np.ndarray:
    """同時線: 実体がレンジの DOJI_BODY_RATIO 以下（レンジ 0 は非検出）。"""
    o, h, l, c = _ohlc(df)
    r = h - l
    with np.errstate(invalid="ignore"):
        return (r > 0) & (np.abs(c - o) <= DOJI_BODY_RATIO * r)


def detect_hammer(df: pd.DataFrame) -> np.ndarray:
    """ハンマー: 小さい実体・長い下ヒゲ・短い上ヒゲ（レンジ 0・実体 0 は非検出）。"""
    o, h, l, c = _ohlc(df)
    r, b = h - l, np.abs(c - o)
    upper = h - np.maximum(o, c)
    lower = np.minimum(o, c) - l
    with np.errstate(invalid="ignore"):
        return (
            (r > 0) & (b > 0)
            & (lower >= HAMMER_LOWER_RATIO * b)
            & (upper <= HAMMER_UPPER_RATIO * r)
        )


def detect_shooting_star(df: pd.DataFrame) -> np.ndarray:
    """流れ星: ハンマーの鏡像（長い上ヒゲ・短い下ヒゲ）。"""
    o, h, l, c = _ohlc(df)
    r, b = h - l, np.abs(c - o)
    upper = h - np.maximum(o, c)
    lower = np.minimum(o, c) - l
    with np.errstate(invalid="ignore"):
        return (
            (r > 0) & (b > 0)
            & (upper >= HAMMER_LOWER_RATIO * b)
            & (lower <= HAMMER_UPPER_RATIO * r)
        )


# --------------------------------------------------------------------------- #
# 2 本構成
# --------------------------------------------------------------------------- #
def detect_bullish_engulfing(df: pd.DataFrame) -> np.ndarray:
    """陽線包み: 前足が陰線、当足が陽線で、当足の実体が前足の実体を包む。"""
    o, h, l, c = _ohlc(df)
    n = len(c)
    if n < 2:
        return _empty(n)
    po, pc = o[:-1], c[:-1]
    co, cc = o[1:], c[1:]
    with np.errstate(invalid="ignore"):
        ok = (pc < po) & (cc > co) & (co <= pc) & (cc >= po)
    return _place(n, 1, ok)


def detect_bearish_engulfing(df: pd.DataFrame) -> np.ndarray:
    """陰線包み: 陽線包みの鏡像。"""
    o, h, l, c = _ohlc(df)
    n = len(c)
    if n < 2:
        return _empty(n)
    po, pc = o[:-1], c[:-1]
    co, cc = o[1:], c[1:]
    with np.errstate(invalid="ignore"):
        ok = (pc > po) & (cc < co) & (co >= pc) & (cc <= po)
    return _place(n, 1, ok)


def detect_bullish_harami(df: pd.DataFrame) -> np.ndarray:
    """陽線はらみ: 大陰線の実体に、翌足の陽線の実体が内包される。

    包み（engulfing）の内外を反転させた形。前足に ``HARAMI_BODY_RATIO`` を要求するのは、
    ヒゲばかりで方向感の無い前足を除くため。**判定は実体/レンジの比なので価格の絶対水準に
    依らず、レンジ自体が小さい「静かな」バーは除外しない**（実測で内包候補の棄却は 3.9%）。
    値幅そのものでの足切りが要るなら別の閾値を足すこと。
    """
    o, h, l, c = _ohlc(df)
    n = len(c)
    if n < 2:
        return _empty(n)
    po, ph, pl, pc = o[:-1], h[:-1], l[:-1], c[:-1]
    co, cc = o[1:], c[1:]
    pr = ph - pl
    with np.errstate(invalid="ignore"):
        ok = (
            (pc < po)                                      # 前足は陰線
            & (pr > 0)
            & (np.abs(pc - po) >= HARAMI_BODY_RATIO * pr)  # 前足は大実体
            & (cc > co)                                    # 当足は陽線
            & (co >= pc) & (cc <= po)                      # 当足の実体が内包される
        )
    return _place(n, 1, ok)


def detect_bearish_harami(df: pd.DataFrame) -> np.ndarray:
    """陰線はらみ: 陽線はらみの鏡像（大陽線の実体に小陰線が収まる）。"""
    o, h, l, c = _ohlc(df)
    n = len(c)
    if n < 2:
        return _empty(n)
    po, ph, pl, pc = o[:-1], h[:-1], l[:-1], c[:-1]
    co, cc = o[1:], c[1:]
    pr = ph - pl
    with np.errstate(invalid="ignore"):
        ok = (
            (pc > po)                                      # 前足は陽線
            & (pr > 0)
            & (np.abs(pc - po) >= HARAMI_BODY_RATIO * pr)
            & (cc < co)                                    # 当足は陰線
            & (cc >= po) & (co <= pc)                      # 当足の実体が内包される
        )
    return _place(n, 1, ok)


# --------------------------------------------------------------------------- #
# 3 本構成（明星）
# --------------------------------------------------------------------------- #
def detect_morning_star(df: pd.DataFrame, require_gap: bool = False) -> np.ndarray:
    """明けの明星: 大陰線 → 小実体（星）→ 1本目の実体中点を上回る陽線。

    ``require_gap=True`` で古典的定義（星が 1 本目の実体より下に窓を開ける）になる。
    既定を False にしているのは **TS 側の宵の明星が窓を要求しないため** —
    チャートに出るものと検証対象を揃えるのが優先。
    """
    o, h, l, c = _ohlc(df)
    n = len(c)
    if n < 3:
        return _empty(n)
    o1, h1, l1, c1 = o[:-2], h[:-2], l[:-2], c[:-2]
    o2, h2, l2, c2 = o[1:-1], h[1:-1], l[1:-1], c[1:-1]
    o3, c3 = o[2:], c[2:]
    r1, r2 = h1 - l1, h2 - l2
    with np.errstate(invalid="ignore"):
        ok = (
            (c1 < o1)                                # 1本目は陰線
            & (r1 > 0) & (r2 > 0)
            & (np.abs(c1 - o1) >= STAR_BODY_RATIO * r1)   # 大実体
            & (np.abs(c2 - o2) <= STAR_BODY_RATIO * r2)   # 小実体（星）
            & (c3 > o3)                              # 3本目は陽線
            & (c3 > (o1 + c1) / 2.0)                 # 1本目の実体中点を上回る
        )
        if require_gap:
            ok = ok & (np.maximum(o2, c2) < np.minimum(o1, c1))
    return _place(n, 2, ok)


def detect_evening_star(df: pd.DataFrame, require_gap: bool = False) -> np.ndarray:
    """宵の明星: 明けの明星の鏡像（TS 側 detectEveningStar と同一定義）。"""
    o, h, l, c = _ohlc(df)
    n = len(c)
    if n < 3:
        return _empty(n)
    o1, h1, l1, c1 = o[:-2], h[:-2], l[:-2], c[:-2]
    o2, h2, l2, c2 = o[1:-1], h[1:-1], l[1:-1], c[1:-1]
    o3, c3 = o[2:], c[2:]
    r1, r2 = h1 - l1, h2 - l2
    with np.errstate(invalid="ignore"):
        ok = (
            (c1 > o1)                                # 1本目は陽線
            & (r1 > 0) & (r2 > 0)
            & (np.abs(c1 - o1) >= STAR_BODY_RATIO * r1)
            & (np.abs(c2 - o2) <= STAR_BODY_RATIO * r2)
            & (c3 < o3)                              # 3本目は陰線
            & (c3 < (o1 + c1) / 2.0)                 # 1本目の実体中点を割り込む
        )
        if require_gap:
            ok = ok & (np.minimum(o2, c2) > np.maximum(o1, c1))
    return _place(n, 2, ok)


# --------------------------------------------------------------------------- #
# 3 本構成（窓系・継続パターン）
#
# 他の検出器がすべて反転パターンなのに対し、この 2 種だけは **継続** を示す。
# シグナルの向きはトレンドの継続方向（下放れ二本黒 = bearish / 上放れ並び赤 = bullish）。
# トレンド文脈は条件に入れない — 窓の方向が既に局面を意味しているため。
# --------------------------------------------------------------------------- #
def detect_two_black_gapping(df: pd.DataFrame) -> np.ndarray:
    """下放れ二本黒: 下窓のあと陰線が 2 本続き、2 本目が終値を切り下げる。

    窓は「窓の手前のバー → 1 本目の黒」の間。**高安基準**なので実体だけが
    離れている（ヒゲが重なる）ケースは成立しない。
    Bulkowski の「2 本目の高値が窓の下端を超えない」条件は課していない
    （高安基準の窓と重なって検出数が過度に減るため・PRD Q13）。
    """
    o, h, l, c = _ohlc(df)
    n = len(c)
    if n < 3:
        return _empty(n)
    l1 = l[:-2]                              # 窓の手前のバー
    o2, h2, c2 = o[1:-1], h[1:-1], c[1:-1]   # 1 本目の黒
    o3, c3 = o[2:], c[2:]                    # 2 本目の黒
    with np.errstate(invalid="ignore"):
        ok = (
            has_gap_down(prev_low=l1, cur_high=h2)   # 下窓
            & (c2 < o2)                      # 1 本目は陰線
            & (c3 < o3)                      # 2 本目は陰線
            & (c3 < c2)                      # 終値を切り下げる
        )
    return _place(n, 2, ok)


def detect_upside_gap_two_white(df: pd.DataFrame) -> np.ndarray:
    """上放れ並び赤: 上窓のあと陽線が 2 本並び、2 本目がほぼ同じ始値で寄る。

    「並び」は **始値の近接のみ** で判定する（``SIDE_BY_SIDE_OPEN_TOLERANCE``）。
    実体サイズの近接は条件に入れない — はらみ・明星が使うレンジ比とは別の
    「実体同士の相対比」という新しい尺度を持ち込まないため（PRD Q12）。

    ``two_black_gapping`` とは鏡像関係に**ない**（あちらは終値の切り下げ、
    こちらは始値の一致を要求する）。価格反転テストの対象外。
    """
    o, h, l, c = _ohlc(df)
    n = len(c)
    if n < 3:
        return _empty(n)
    h1 = h[:-2]                              # 窓の手前のバー
    o2, l2, c2 = o[1:-1], l[1:-1], c[1:-1]   # 1 本目の赤
    o3, c3 = o[2:], c[2:]                    # 2 本目の赤
    with np.errstate(invalid="ignore"):
        ok = (
            has_gap_up(prev_high=h1, cur_low=l2)     # 上窓
            & (c2 > o2)                      # 1 本目は陽線
            & (c3 > o3)                      # 2 本目は陽線
            # 相対許容差。分母に絶対値を取るのは価格の符号に依らせないため
            & (np.abs(o3 - o2) <= SIDE_BY_SIDE_OPEN_TOLERANCE * np.abs(o2))
        )
    return _place(n, 2, ok)


# --------------------------------------------------------------------------- #
# ディスパッチ
# --------------------------------------------------------------------------- #
DETECTORS: dict[str, Callable[..., np.ndarray]] = {
    "bullish_engulfing": detect_bullish_engulfing,
    "bearish_engulfing": detect_bearish_engulfing,
    "bullish_harami": detect_bullish_harami,
    "bearish_harami": detect_bearish_harami,
    "doji": detect_doji,
    "hammer": detect_hammer,
    "shooting_star": detect_shooting_star,
    "morning_star": detect_morning_star,
    "evening_star": detect_evening_star,
    "two_black_gapping": detect_two_black_gapping,
    "upside_gap_two_white": detect_upside_gap_two_white,
}

PATTERN_NAMES = tuple(DETECTORS)


def detect(name: str, df: pd.DataFrame, **kwargs) -> np.ndarray:
    """名前でパターン検出器を呼ぶ。未知の名前は KeyError ではなく ValueError。"""
    if name not in DETECTORS:
        raise ValueError(f"unknown pattern: {name} (available: {', '.join(PATTERN_NAMES)})")
    return DETECTORS[name](df, **kwargs)
