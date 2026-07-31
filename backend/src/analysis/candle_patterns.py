"""ローソク足パターンの検出（純関数のみ・I/O なし）。

定義と閾値は **レンダラーの `apps/renderer/src/lib/candlePatterns.ts` と一致させている**。
チャートに描かれるものと検証対象がズレると、検証結果を UI に持ち込めないため。
片方だけ変更してはいけない（変更時は両方 + テストを揃える）。

TS 側に無い `morning_star`（明けの明星）は `evening_star` の厳密な鏡像として定義した。
`bearish_engulfing` / `shooting_star` も同様の鏡像。

`n_pattern.py` と同じく pandas.DataFrame を受け取るだけで、yfinance 取得や
ファイル I/O は一切行わない（呼び出し側 = scripts/candle_backtest.py が担う）。

各検出器は「そのバーでパターンが成立したか」を表す bool 配列（長さ = len(df)）を返す。
複数バー構成のパターンでは **最終バーの位置** に True が立つ。
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

REQUIRED_COLUMNS = ("Open", "High", "Low", "Close")

LABELS: dict[str, str] = {
    "bullish_engulfing": "陽線包み",
    "bearish_engulfing": "陰線包み",
    "doji": "同時線",
    "hammer": "ハンマー",
    "shooting_star": "流れ星",
    "morning_star": "明けの明星",
    "evening_star": "宵の明星",
}

SIGNALS: dict[str, str] = {
    "bullish_engulfing": "bullish",
    "bearish_engulfing": "bearish",
    "doji": "neutral",
    "hammer": "bullish",
    "shooting_star": "bearish",
    "morning_star": "bullish",
    "evening_star": "bearish",
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
# ディスパッチ
# --------------------------------------------------------------------------- #
DETECTORS: dict[str, Callable[..., np.ndarray]] = {
    "bullish_engulfing": detect_bullish_engulfing,
    "bearish_engulfing": detect_bearish_engulfing,
    "doji": detect_doji,
    "hammer": detect_hammer,
    "shooting_star": detect_shooting_star,
    "morning_star": detect_morning_star,
    "evening_star": detect_evening_star,
}

PATTERN_NAMES = tuple(DETECTORS)


def detect(name: str, df: pd.DataFrame, **kwargs) -> np.ndarray:
    """名前でパターン検出器を呼ぶ。未知の名前は KeyError ではなく ValueError。"""
    if name not in DETECTORS:
        raise ValueError(f"unknown pattern: {name} (available: {', '.join(PATTERN_NAMES)})")
    return DETECTORS[name](df, **kwargs)
