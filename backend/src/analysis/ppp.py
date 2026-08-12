"""PPP(パーフェクトオーダー)の成立イベント検出(純関数のみ・I/O なし)。

移動平均が短期→長期の順に並ぶ状態への**転換日**を、ATR 単位の乖離量と
ヒステリシスを持つ 3 状態の機械で検出する。設計判断とその根拠は
docs/completed/ppp_screening_spec.md に記録済み。

このモジュールは pandas.DataFrame を入力に取るだけで、yfinance 取得やファイル I/O は
一切行わない(呼び出し側 = services.screening_provider が担う)。
"""
from __future__ import annotations

import pandas as pd

from .series import ATR_PERIOD, atr_series, date_iso

# --------------------------------------------------------------------------- #
# 定数(マジックナンバー禁止 — 閾値はすべてここに集約する)
# --------------------------------------------------------------------------- #
SMA_SHORT = 5
SMA_MID = 25
SMA_LONG = 75

# 乖離の下限(ATR 単位)。k=1.0 は「SMA 間隔が日足 1 本ぶんの値動きに相当する」という
# **物理的意味**で先験的に置いた値で、前方リターンを見て選んでいない(効果で閾値を
# 選ぶと in-sample への当てはめになる — n_pattern の TREND_BONUS を反転させなかった
# のと同じ規律)。ユニバース 563 銘柄の較正では 1 日あたり成立 4.7 件・鮮度 7 日で
# 44 行と、運用上の件数制約も満たす(docs/completed/ppp_screening_spec.md §5.1)。
#
# 件数だけでは k を選べないことが較正で分かっている: 1 日あたり成立件数は
# k=0.1〜1.5 の全域で「数件〜数十件」に収まるため、最小を採ると k=0.1 になり
# 乖離条件が事実上インアクティブ(＝並び条件だけの検出器)になる。
PPP_GAP_K = 1.0
# 崩壊の下限。k との比で置いて自由度を 1 個に保つ。成立(k)と崩壊(-k_exit)のあいだの
# 帯では直前の状態を維持する = ヒステリシスの実体で、線が接近して絡んでいる区間での
# 往復を構造的に潰す。
PPP_GAP_K_EXIT = PPP_GAP_K / 2

MIN_BARS = SMA_LONG        # sma75 が立つまで状態機械を動かさない

STATE_UNKNOWN = "unknown"
STATE_IN = "in"
STATE_OUT = "out"


def compute_gaps(
    df: pd.DataFrame,
) -> tuple[list[float | None], list[float | None]]:
    """各バーの (gap_short, gap_long) を ATR 単位で返す。評価不能なバーは None。

    ``gap_short = (sma5 - sma25) / atr`` / ``gap_long = (sma25 - sma75) / atr``

    SMA は ``min_periods`` を指定しない(既定 = window)。atr_series が
    ``min_periods=1`` を明示しているのと非対称だが意図的で、75 本目より前の
    助走区間で PPP を評価させないため。

    ATR が 0 のバーも None にする。ゼロ除算を通すと inf/nan が出て、比較が
    黙って False になり状態が固まる(完全にフラットな系列で起きる)。
    """
    close = df["Close"].astype(float)
    sma_short = close.rolling(SMA_SHORT).mean()
    sma_mid = close.rolling(SMA_MID).mean()
    sma_long = close.rolling(SMA_LONG).mean()
    atr = atr_series(df, ATR_PERIOD)

    gap_short: list[float | None] = []
    gap_long: list[float | None] = []
    for i in range(len(df)):
        a = atr[i]
        s, m, long_ = sma_short.iloc[i], sma_mid.iloc[i], sma_long.iloc[i]
        if a <= 0 or pd.isna(s) or pd.isna(m) or pd.isna(long_):
            gap_short.append(None)
            gap_long.append(None)
            continue
        gap_short.append(float(s - m) / a)
        gap_long.append(float(m - long_) / a)
    return gap_short, gap_long


def ppp_events(
    df: pd.DataFrame,
    k: float = PPP_GAP_K,
    k_exit: float = PPP_GAP_K_EXIT,
) -> list[dict]:
    """PPP 成立イベント(out → in の遷移バー)を時系列順に返す。

    Returns: ``[{index, date}, ...]``

    状態は unknown / in / out の 3 値で、**unknown から直接 in へは遷移しない**。
    窓の先頭で既に並んでいる銘柄は「いつ成立したか」が窓の外にあるため成立と
    呼べない(非PPP とみなすと 8ヶ月前の嘘の一斉成立が数百件出る)。一度崩壊を
    観測して初めて out に落ち、そこから先の成立は正しく観測できる。

    この状態機械は**因果的**である(時刻 t の判定が t 以前しか参照しない)ため、
    prefix を切って再実行する必要がなく 1 回の前方パスで全イベントが得られる。

    全イベントを返すのは、増分測定(docs/ppp_incremental_measurement.md)が
    detect_ppp の「最新 1 件」制約に縛られないようにするため。
    """
    if df is None or len(df) < MIN_BARS or "Close" not in df.columns:
        return []

    gap_short, gap_long = compute_gaps(df)
    dates = [date_iso(ts) for ts in df.index]

    state = STATE_UNKNOWN
    events: list[dict] = []
    for i in range(len(df)):
        gs, gl = gap_short[i], gap_long[i]
        if gs is None or gl is None:
            continue  # 評価不能バーは状態を持ち越す(リセットすると以降の成立が消える)
        # 成立(gs >= k > 0)と崩壊(gs < -k_exit <= 0)は排他なので判定順は自由。
        # k を 0 以下にできる形へ変えるなら排他性が崩れる点に注意。
        if gs < -k_exit or gl < -k_exit:
            state = STATE_OUT  # unknown からも in からも崩壊。イベントは出さない
        elif state == STATE_OUT and gs >= k and gl >= k:
            events.append({"index": i, "date": dates[i]})
            state = STATE_IN
    return events


def detect_ppp(
    df: pd.DataFrame,
    k: float = PPP_GAP_K,
    k_exit: float = PPP_GAP_K_EXIT,
) -> dict | None:
    """**最新の**成立イベントを返す。イベントが無ければ None。

    Returns: ``{'detected', 'established_date', 'duration_days'}``

    銘柄ごとに最新 1 件だけを採るのは、結果 JSON と表が「1 銘柄 1 行」を前提に
    しているため。鮮度の打ち切りはここでは行わず表示側に任せる — バックエンドで
    切ると「なぜ出ないのか」が JSON を見ても分からなくなる
    (docs/completed/ppp_screening_spec.md §5.2)。

    ``duration_days`` は成立日から最終バーまでの**バー本数**(暦日ではない)。
    """
    events = ppp_events(df, k, k_exit)
    if not events:
        return None
    last = events[-1]
    return {
        "detected": True,
        "established_date": last["date"],
        "duration_days": (len(df) - 1) - last["index"],
    }
