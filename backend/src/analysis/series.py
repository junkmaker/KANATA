"""複数の検出器が共有する因果的な派生系列と日付整形(純関数のみ・I/O なし)。

**analysis 内のリーフモジュール** — 他の analysis モジュールを import しない。
依存方向は ``n_pattern → series`` と ``ppp → series`` の一方向のみで、
``n_pattern ↔ ppp`` の横方向依存を作らないための最下層(services.storage を
他 services から独立させたのと同じ規律)。

ATR は N字・PPP の双方が同じ定義で使う。片方だけ別実装にすると、同じ「ATR 単位」
という言葉が 2 つの意味を持ってしまう。
"""
from __future__ import annotations

import pandas as pd

ATR_PERIOD = 14


def date_iso(ts: object) -> str:
    """DatetimeIndex 要素を ISO 日付文字列に正規化する。"""
    date_fn = getattr(ts, "date", None)
    if callable(date_fn):
        return date_fn().isoformat()
    return str(ts)[:10]


def atr_series(df: pd.DataFrame, period: int = ATR_PERIOD) -> list[float]:
    """全期間の ATR を list で返す(compute_atr の各時点版)。

    rolling(min_periods=1).mean() は時刻 t の値が t 以前しか参照しない(因果的)。
    len(df) < 2 のときは compute_atr と揃えて 0.0 で埋める。
    """
    n = len(df)
    if n < 2:
        return [0.0] * n
    high = df["High"].astype(float)
    low = df["Low"].astype(float)
    close = df["Close"].astype(float)
    prev_close = close.shift(1)
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    atr = tr.rolling(window=period, min_periods=1).mean()
    return [0.0 if pd.isna(v) else float(v) for v in atr.tolist()]
