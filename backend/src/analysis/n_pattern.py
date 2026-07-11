"""N字波動パターンの検出とスコアリング(純関数のみ・I/O なし)。

上昇継続の N 字パターン(安値 A → 高値 B → 押し目 C → 高値更新 D)を
ATR 連動の ZigZag でピボット抽出し、フェイクブレイク除去のためのスコアを算出する。

このモジュールは pandas.DataFrame を入力に取るだけで、yfinance 取得やファイル I/O は
一切行わない(呼び出し側 = services.screening_provider が担う)。
"""
from __future__ import annotations

import pandas as pd

# --------------------------------------------------------------------------- #
# 定数(マジックナンバー禁止 — 閾値・重みはすべてここに集約する)
# --------------------------------------------------------------------------- #
BASE_SCORE = 40            # N字4条件成立時の基礎点(加点余地を確保するため引き下げ)
TREND_BONUS = 25           # A の手前が下降トレンドでない(上昇継続)ときの加点
BREAKOUT_BONUS = 15        # ブレイク幅が大きい(継続力が強い)ときの加点
VOLUME_BONUS = 10          # ブレイク時の出来高急増(偏重緩和のため引き下げ)
MACD_BONUS = 10            # ブレイク時に MACD が GC 方向(偏重緩和のため引き下げ)
PULLBACK_PENALTY = 15      # 押し目が浅すぎる
DURATION_PENALTY = 15      # A→D が短すぎる

ATR_PERIOD = 14
ZIGZAG_ATR_COEF = 1.5      # ATR 比率に掛ける係数
ZIGZAG_MIN_PCT = 3.0       # ZigZag 反転閾値の下限(%)

MACD_FAST = 12
MACD_SLOW = 26
MACD_SIGNAL = 9

VOLUME_LOOKBACK = 20       # 出来高平均の参照本数
VOLUME_SPIKE_MULT = 1.5    # 直近平均比 +50% 以上でボーナス
PULLBACK_MIN_RATIO = 0.20  # (B-C)/(B-A) がこれ未満なら減点
MIN_DURATION_DAYS = 5      # A→D の営業日がこれ未満なら減点

# ブレイク判定の是正(M字・下降バウンス除去)
BREAKOUT_MARGIN_PCT = 2.0   # ブレイク成立の下限(D >= B×(1+2.0/100))。M字(ダブルトップ)除去のハード条件
RECENCY_MAX_BARS = 10       # D から末尾までの許容バー数((len-1)-D.index <= 10)。進行中ブレイクのみ採用
BREAKOUT_STRONG_PCT = 5.0   # 強いブレイク幅の加点閾値((D-B)/B >= 5.0/100)
TREND_LOOKBACK = 20         # A の手前を参照するバー数(上昇継続文脈の判定)
TREND_DROP_PCT = 10.0       # A の TREND_LOOKBACK 本前が A より 10% 以上高い＝下降トレンド流入とみなし trend 加点なし

MIN_BARS = 30              # ATR/MACD 計算に必要な最小本数
PIVOT_COUNT = 4            # N字判定に使うピボット数(A,B,C,D)


def _date_iso(ts: object) -> str:
    """DatetimeIndex 要素を ISO 日付文字列に正規化する。"""
    date_fn = getattr(ts, "date", None)
    if callable(date_fn):
        return date_fn().isoformat()
    return str(ts)[:10]


def compute_atr(df: pd.DataFrame, period: int = ATR_PERIOD) -> float:
    """直近の ATR(Average True Range)を返す。データ不足時は 0.0。"""
    if len(df) < 2:
        return 0.0
    high = df["High"].astype(float)
    low = df["Low"].astype(float)
    close = df["Close"].astype(float)
    prev_close = close.shift(1)
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    atr = tr.rolling(window=period, min_periods=1).mean().iloc[-1]
    return 0.0 if pd.isna(atr) else float(atr)


def zigzag_threshold(df: pd.DataFrame) -> float:
    """ボラティリティ連動の ZigZag 反転閾値(%)を返す。

    zigzag_pct = max(ZIGZAG_MIN_PCT, ATR/終値 * 100 * ZIGZAG_ATR_COEF)
    """
    close = float(df["Close"].iloc[-1])
    if close <= 0:
        return ZIGZAG_MIN_PCT
    atr = compute_atr(df)
    dynamic = atr / close * 100.0 * ZIGZAG_ATR_COEF
    return max(ZIGZAG_MIN_PCT, dynamic)


def extract_zigzag_pivots(close: pd.Series, zigzag_pct: float) -> list[dict]:
    """閾値ベースの ZigZag でピボット列を抽出する。

    出力: ``[{index, date, price, type: 'low'|'high'}, ...]`` を時系列順で返す。
    最後の暫定極値も確定前提でピボットに含める(ブレイク直後の D を捉えるため)。
    """
    values = [float(v) for v in close.tolist()]
    n = len(values)
    if n < 2:
        return []
    dates = list(close.index)
    thr = zigzag_pct / 100.0

    pivots: list[tuple[int, float, str]] = []
    direction = 0  # 0=未確定, 1=上昇(高値追跡中), -1=下降(安値追跡中)
    ext_i, ext_v = 0, values[0]
    # 未確定区間中の暫定 min/max(初動の谷/山を正しいピボットにするため)
    min_i, min_v = 0, values[0]
    max_i, max_v = 0, values[0]

    for i in range(1, n):
        v = values[i]
        if direction == 0:
            if v < min_v:
                min_i, min_v = i, v
            if v > max_v:
                max_i, max_v = i, v
            if min_v > 0 and (v - min_v) / min_v >= thr:
                pivots.append((min_i, min_v, "low"))
                direction = 1
                ext_i, ext_v = i, v
            elif max_v > 0 and (max_v - v) / max_v >= thr:
                pivots.append((max_i, max_v, "high"))
                direction = -1
                ext_i, ext_v = i, v
        elif direction == 1:
            if v > ext_v:
                ext_i, ext_v = i, v
            elif ext_v > 0 and (ext_v - v) / ext_v >= thr:
                pivots.append((ext_i, ext_v, "high"))
                direction = -1
                ext_i, ext_v = i, v
        else:  # direction == -1
            if v < ext_v:
                ext_i, ext_v = i, v
            elif ext_v > 0 and (v - ext_v) / ext_v >= thr:
                pivots.append((ext_i, ext_v, "low"))
                direction = 1
                ext_i, ext_v = i, v

    if direction == 1:
        pivots.append((ext_i, ext_v, "high"))
    elif direction == -1:
        pivots.append((ext_i, ext_v, "low"))

    return [
        {"index": i, "date": _date_iso(dates[i]), "price": round(p, 4), "type": t}
        for (i, p, t) in pivots
    ]


def compute_macd(
    close: pd.Series,
    fast: int = MACD_FAST,
    slow: int = MACD_SLOW,
    signal: int = MACD_SIGNAL,
) -> tuple[pd.Series, pd.Series]:
    """MACD ライン・シグナルラインを返す。

    EMA は ``ewm(span=n, adjust=False)`` を使い、フロントの indicators.ts の
    再帰式と一致させる。
    """
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    return macd_line, signal_line


def _volume_bonus(df: pd.DataFrame, d_idx: int) -> int:
    """D 時点の出来高が直近平均比 +50% 以上なら VOLUME_BONUS。"""
    if "Volume" not in df.columns or d_idx <= 0:
        return 0
    vol = df["Volume"].astype(float)
    start = max(0, d_idx - VOLUME_LOOKBACK)
    prior = vol.iloc[start:d_idx]
    if prior.empty:
        return 0
    avg = float(prior.mean())
    if avg <= 0:
        return 0
    d_vol = float(vol.iloc[d_idx])
    return VOLUME_BONUS if d_vol >= avg * VOLUME_SPIKE_MULT else 0


def _macd_bonus(close: pd.Series, d_idx: int) -> int:
    """D 時点で MACD が GC 方向(macd > signal)なら MACD_BONUS。"""
    macd_line, signal_line = compute_macd(close)
    m = macd_line.iloc[d_idx]
    s = signal_line.iloc[d_idx]
    if pd.isna(m) or pd.isna(s):
        return 0
    return MACD_BONUS if float(m) > float(s) else 0


def _trend_bonus(close: pd.Series, a_idx: int) -> int:
    """A の手前が下降トレンドでなければ TREND_BONUS。

    A の TREND_LOOKBACK 本前の終値が A より TREND_DROP_PCT% 以上高い場合、
    下降トレンドの終端バウンスとみなし加点しない。手前のデータが無い/
    A 以下なら上昇継続とみなし加点する。
    """
    ref_idx = a_idx - TREND_LOOKBACK
    if ref_idx < 0:
        return TREND_BONUS  # 手前が無い＝下降流入の証拠なし
    a_price = float(close.iloc[a_idx])
    ref_price = float(close.iloc[ref_idx])
    if a_price <= 0:
        return 0
    drop = (ref_price - a_price) / a_price * 100.0
    return 0 if drop >= TREND_DROP_PCT else TREND_BONUS


def _breakout_bonus(b_price: float, d_price: float) -> int:
    """D が B を BREAKOUT_STRONG_PCT% 以上超えていれば BREAKOUT_BONUS。"""
    if b_price <= 0:
        return 0
    ratio = (d_price - b_price) / b_price * 100.0
    return BREAKOUT_BONUS if ratio >= BREAKOUT_STRONG_PCT else 0


def detect_n_pattern(df: pd.DataFrame, zigzag_pct: float | None = None) -> dict | None:
    """N字波動パターンを判定しスコア付きで返す。非該当なら None。

    Returns: ``{'detected', 'score', 'score_detail', 'pivots', 'break_date'}``

    zigzag_pct を省略すると ATR 連動閾値(zigzag_threshold)を用いる。
    """
    if df is None or len(df) < MIN_BARS or "Close" not in df.columns:
        return None

    pct = zigzag_threshold(df) if zigzag_pct is None else zigzag_pct
    pivots = extract_zigzag_pivots(df["Close"], pct)
    if len(pivots) < PIVOT_COUNT:
        return None

    a, b, c, d = pivots[-PIVOT_COUNT:]

    # 直近4ピボットが 安値→高値→安値→高値 の並びであること
    if (a["type"], b["type"], c["type"], d["type"]) != ("low", "high", "low", "high"):
        return None

    # N字4条件: B>A / A<C<B / D>=B×(1+BREAKOUT_MARGIN_PCT)
    # ブレイク幅下限で D≈B のダブルトップ(M字)を除外する
    break_floor = b["price"] * (1 + BREAKOUT_MARGIN_PCT / 100.0)
    if not (b["price"] > a["price"] and a["price"] < c["price"] < b["price"] and d["price"] >= break_floor):
        return None

    # 直近性フィルタ: ブレイク(D)が末尾から離れすぎた過去のものは進行中でないため除外
    if (len(df) - 1) - d["index"] > RECENCY_MAX_BARS:
        return None

    volume = _volume_bonus(df, d["index"])
    macd = _macd_bonus(df["Close"], d["index"])
    trend = _trend_bonus(df["Close"], a["index"])
    breakout = _breakout_bonus(b["price"], d["price"])

    span = b["price"] - a["price"]
    pullback_ratio = (b["price"] - c["price"]) / span if span > 0 else 0.0
    pullback = PULLBACK_PENALTY if pullback_ratio < PULLBACK_MIN_RATIO else 0

    duration = d["index"] - a["index"]
    duration_penalty = DURATION_PENALTY if duration < MIN_DURATION_DAYS else 0

    raw = BASE_SCORE + trend + breakout + volume + macd - pullback - duration_penalty
    score = max(0, min(100, raw))

    return {
        "detected": True,
        "score": score,
        "score_detail": {
            "trend": trend,
            "breakout": breakout,
            "volume": volume,
            "macd": macd,
            "pullback_penalty": pullback,
            "duration_penalty": duration_penalty,
        },
        "pivots": [a, b, c, d],
        "break_date": d["date"],
    }
