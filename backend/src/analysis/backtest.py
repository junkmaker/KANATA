"""N字シグナルのウォークフォワード検出とアウトカム計算(純関数のみ・I/O なし)。

「今のスコアは機能しているのか」を実測するための計算層。3 つの関心事に分かれる:

- **② 検出**   : ``walk_forward_signals`` / ``mark_overlaps``
  日を1本ずつ進めて detect_n_pattern を再実行し、(symbol, break_date) でユニーク化する。
- **③ アウトカム** : ``resolve_entries`` / ``compute_outcomes`` / ``benchmark_outcome``
  確定済みのシグナル日から前方を見て、fwd リターン・MFE/MAE を **生の値**で返す。
- **統計**      : ``block_bootstrap_means`` / ``percentile_of`` / ``confidence_interval``

②と③は完全に分離する(§10.1)。②は t+1 以降のバーに構造的に触れず、③は
確定済みイベント日を受け取るだけなので、先読みが混入する経路が存在しない。

このモジュールは yfinance / pathlib / os / json を import しない(I/O は
呼び出し側 = services.ohlcv_store と scripts/ が担う)。
"""
from __future__ import annotations

import random
from bisect import bisect_left
from datetime import date

import pandas as pd

from .n_pattern import MIN_BARS, detect_n_pattern, precompute_series

# --------------------------------------------------------------------------- #
# 定数(マジックナンバー禁止 — 閾値・期間はすべてここに集約する)
# --------------------------------------------------------------------------- #
OVERLAP_BARS = 20               # §5.2 直前シグナルから何バー以内なら保有期間が重なるとみなすか
ENTRY_LAGS = (1, 3, 5)          # §6.5 遅延感応度(entry_next_open から追加で何バー後ろへずらすか)
FWD_HORIZONS = (20, 60)         # §1.1 フォワードリターンの営業日数
MFE_WINDOW_BARS = 60            # MFE/MAE を測る保有期間(最長ホライズンに合わせる)
DEFAULT_BOOTSTRAP_ITERS = 2000  # §4.3 ブロックブートストラップの反復回数

CI_LOWER_PCT = 2.5              # 信頼区間の下側パーセンタイル(既定 95% CI)
CI_UPPER_PCT = 97.5             # 信頼区間の上側パーセンタイル

CALENDAR_DAYS_PER_WEEK = 7
TRADING_DAYS_PER_WEEK = 5
CALENDAR_SLACK_DAYS = 21        # 年末年始・GW の余裕(実測最大は 20バー=35日 / 60バー=96日)


# --------------------------------------------------------------------------- #
# 日付ヘルパ
# --------------------------------------------------------------------------- #
def iso_dates(index: pd.DatetimeIndex) -> list[str]:
    """DatetimeIndex を ISO 日付文字列のリストに落とす。"""
    return [ts.date().isoformat() for ts in index]


def _iso_week(iso_date: str) -> tuple[int, int]:
    """ISO 日付文字列から (ISO 年, ISO 週番号) を返す。週の切れ目判定に使う。"""
    d = date(int(iso_date[0:4]), int(iso_date[5:7]), int(iso_date[8:10]))
    cal = d.isocalendar()
    return (cal[0], cal[1])


def max_calendar_span_days(horizon_bars: int) -> int:
    """horizon_bars 本先までに許容する暦日数の上限。

    営業日から暦日への素朴な換算に連休分の余裕を足す。上場廃止・再上場を跨いだ
    系列では index が疎になり、20 バー先が 2 年先の日付になることがある
    (8303 で実測 825 日)。バー数だけで前方を見ると、その 2 年分の値動きを
    「20 営業日のリターン」として混ぜてしまう。
    """
    return round(horizon_bars * CALENDAR_DAYS_PER_WEEK / TRADING_DAYS_PER_WEEK) \
        + CALENDAR_SLACK_DAYS


def within_calendar_span(
    entry_date: str,
    exit_date: str,
    horizon_bars: int,
) -> bool:
    """entry→exit の暦日スパンが horizon_bars の上限内なら True。

    日付は ISO 文字列(``iso_dates`` の出力形式)。逆順(exit < entry)は False。
    """
    start = date(int(entry_date[0:4]), int(entry_date[5:7]), int(entry_date[8:10]))
    end = date(int(exit_date[0:4]), int(exit_date[5:7]), int(exit_date[8:10]))
    delta = (end - start).days
    return 0 <= delta <= max_calendar_span_days(horizon_bars)


# --------------------------------------------------------------------------- #
# ② ウォークフォワード検出
# --------------------------------------------------------------------------- #
def walk_forward_signals(
    df: pd.DataFrame,
    symbol: str,
    name: str,
    start: str | None = None,
    end: str | None = None,
) -> list[dict]:
    """日を1本ずつ進めて detect_n_pattern を再実行し、(symbol, break_date) で
    ユニーク化したシグナルを返す(§5.1)。

    **この関数は未来を参照しない**: 各時刻 t で渡すのは ``df.iloc[:t+1]`` のみで、
    t+1 以降のバーには構造的に触れない(§10.1 / §12.5)。アウトカム計算は
    compute_outcomes 側に完全に分離する。

    start/end は「判定を行う t の範囲」であり、スライスの起点ではない。
    t < start のバーは助走(ATR/MACD/ZigZag の文脈)として必ず含める。

    RECENCY_MAX_BARS により同一ブレイクは最大 11 日連続でヒットするため、
    break_date でユニーク化して最初の検出だけを残す(重複を残すと同じ事象を
    11 回数えることになり、統計が壊れる)。
    """
    if df is None or len(df) < MIN_BARS:
        return []

    pre = precompute_series(df)
    dates = pre["dates"]
    seen: set[str] = set()
    out: list[dict] = []

    for t in range(MIN_BARS - 1, len(df)):
        if start is not None and dates[t] < start:
            continue
        if end is not None and dates[t] > end:
            break
        res = detect_n_pattern(df.iloc[: t + 1], precomputed=pre)
        if res is None:
            continue
        break_date = res["break_date"]
        if break_date in seen:
            continue
        seen.add(break_date)

        a, b, c, d = res["pivots"]
        span = b["price"] - a["price"]
        out.append(
            {
                "symbol": symbol,
                "name": name,
                "break_date": break_date,
                "detected_date": dates[t],
                "detect_lag_bars": t - d["index"],
                "score": res["score"],
                **{f"sd_{k}": v for k, v in res["score_detail"].items()},
                "a_date": a["date"], "a_price": a["price"],
                "b_date": b["date"], "b_price": b["price"],
                "c_date": c["date"], "c_price": c["price"],
                "d_date": d["date"], "d_price": d["price"],
                "pullback_ratio": (b["price"] - c["price"]) / span if span > 0 else 0.0,
                "duration_bars": d["index"] - a["index"],
            }
        )
    return out


def mark_overlaps(
    signals: list[dict],
    bar_index_of: dict[str, int],
    overlap_bars: int = OVERLAP_BARS,
) -> list[dict]:
    """同一銘柄で**直前に残ったシグナル**から overlap_bars 本以内のものに
    ``overlaps_prev=True`` を立てる(§5.2)。レコードは消さない — 除外は必ず集計側で行う。

    比較の基準は「直前のシグナル」ではなく「直前に残った(overlaps_prev=False の)
    シグナル」。基準を単に直前のシグナルにすると、25 本間隔で並んだ列で
    1本目=残る → 2本目=重複 → 3本目も「2本目から 25 本」で重複…と連鎖し、
    **何とも重なっていないイベントまで落ちる**(実測で独立イベントの約 35% が消えた)。
    重複した側は保有期間を持たない=次の判定の起点にならない、と考えるのが自然。

    bar_index_of は「その銘柄の日付 → バー位置」。営業日ベースで数えるために使う
    (暦日で数えると連休を跨いだシグナルが独立扱いになってしまう)。

    新しい list を返し、入力 dict は一切変更しない(イミュータブル)。
    """
    ordered = sorted(
        signals, key=lambda s: bar_index_of.get(s["detected_date"], -1)
    )
    kept_idx_by_symbol: dict[str, int] = {}
    marked: list[dict] = []
    for s in ordered:
        idx = bar_index_of.get(s["detected_date"])
        prev = kept_idx_by_symbol.get(s["symbol"])
        overlaps = (
            idx is not None and prev is not None and (idx - prev) <= overlap_bars
        )
        marked.append({**s, "overlaps_prev": bool(overlaps)})
        if idx is not None and not overlaps:
            kept_idx_by_symbol[s["symbol"]] = idx
    return marked


# --------------------------------------------------------------------------- #
# ③ エントリー日解決とアウトカム
# --------------------------------------------------------------------------- #
def next_bar_index(n_bars: int, signal_idx: int, offset: int = 1) -> int | None:
    """signal_idx から offset 本後ろのバー位置。範囲外なら None。"""
    idx = signal_idx + offset
    if signal_idx < 0 or idx < 0 or idx >= n_bars:
        return None
    return idx


def weekly_entry_index(dates: list[str], signal_idx: int) -> int | None:
    """週末スキャン再現のエントリー位置を返す(§6.1 entry_weekly)。

    「シグナル日を**含む**それ以降で、最初に現れる『その週の最終営業日』の翌営業日」。
    金曜が休場でも、その週の最後に実在するバーを基準にするので破綻しない。
    シグナル日自体が週最終営業日なら、その翌営業日(=通常は月曜)になる。

    週の切れ目を確認できないまま末尾に達した場合は None(データ不足)。
    """
    n = len(dates)
    if signal_idx < 0 or signal_idx >= n:
        return None
    for i in range(signal_idx, n):
        if i + 1 >= n:
            return None  # 週が終わったことを確認できない
        if _iso_week(dates[i]) != _iso_week(dates[i + 1]):
            return i + 1
    return None


def resolve_entries(
    dates: list[str],
    signal_idx: int,
    lags: tuple[int, ...] = ENTRY_LAGS,
) -> dict[str, int | None]:
    """entry 種別名 → バー位置(範囲外・暦日が離れすぎは None)。

    lag_k は next_open から追加で k 本後ろ(= signal_idx + 1 + k)。
    signal_idx には **detected_date のバー位置**を渡す(break_date ではない)。
    実運用では検出前に買えないため。

    シグナル日→エントリー日の暦日スパンも ``within_calendar_span`` で見る。
    index が疎な銘柄では「翌バー」が数年後になり得る。バー位置だけで前を見ると
    そのエントリーが元のシグナル日に紐付いたまま残り、**日付を揃えた比較**
    (§4.2 のランダムエントリー)の前提が崩れる。
    """
    n = len(dates)
    raw: dict[str, int | None] = {
        "next_open": next_bar_index(n, signal_idx, 1),
        "weekly": weekly_entry_index(dates, signal_idx),
    }
    for k in lags:
        raw[f"lag_{k}"] = next_bar_index(n, signal_idx, 1 + k)

    entries: dict[str, int | None] = {}
    for kind, idx in raw.items():
        near = idx is not None and within_calendar_span(
            dates[signal_idx], dates[idx], idx - signal_idx
        )
        entries[kind] = idx if near else None
    return entries


def compute_outcomes(
    dates: list[str],
    highs: list[float],
    lows: list[float],
    closes: list[float],
    opens: list[float],
    entry_idx: int,
    horizons: tuple[int, ...] = FWD_HORIZONS,
    mfe_window: int = MFE_WINDOW_BARS,
) -> dict:
    """1つの entry について生のアウトカムを返す(手数料・スリッページは引かない §6.4)。

    Returns:
      ``{'entry_px', 'fwd20', 'fwd60', 'mfe', 'mae', 'days_to_mfe'}``
      (fwd キーは horizons から動的に作る)

    entry_px は ``opens[entry_idx]``(始値で買う。§6.3 ブレイク日の終値は使わない)。
    fwd{h} = ``closes[entry_idx + h] / entry_px - 1``。データが尽きていれば None。
    **None を 0 で埋めない** — 未成熟イベントを 0% として混ぜるとリターンが薄まる。
    mfe/mae は ``[entry_idx, entry_idx + mfe_window]`` の High/Low から算出し、
    窓が尽きている場合は「取れた範囲」ではなく None を返す(打ち切りバイアス回避)。

    バー数が足りていても暦日スパンが ``within_calendar_span`` の上限を超えるものは
    打ち切りと同じく None にする。上場廃止・再上場を跨いだ系列では 20 バー先が
    2 年先になり(8303 で実測 825 日)、それを「20 営業日のリターン」として
    混ぜると平均が桁ごと壊れる。**ランダム側だけで落とすと N字側との母集団が
    食い違う**ので、判定はここ(両側が通る唯一の場所)に置く。
    """
    empty: dict = {"entry_px": None, "mfe": None, "mae": None, "days_to_mfe": None}
    for h in horizons:
        empty[f"fwd{h}"] = None

    n = len(closes)
    if entry_idx < 0 or entry_idx >= n:
        return empty
    entry_px = float(opens[entry_idx])
    if entry_px <= 0:
        return empty
    entry_date = dates[entry_idx]

    out: dict = {"entry_px": entry_px}
    for h in horizons:
        j = entry_idx + h
        mature = j < n and within_calendar_span(entry_date, dates[j], h)
        out[f"fwd{h}"] = (float(closes[j]) / entry_px - 1.0) if mature else None

    last = entry_idx + mfe_window
    if last >= n or not within_calendar_span(entry_date, dates[last], mfe_window):
        out["mfe"] = None
        out["mae"] = None
        out["days_to_mfe"] = None
        return out

    window_high = [float(v) for v in highs[entry_idx : last + 1]]
    window_low = [float(v) for v in lows[entry_idx : last + 1]]
    peak = max(window_high)
    out["mfe"] = peak / entry_px - 1.0
    out["mae"] = min(window_low) / entry_px - 1.0
    out["days_to_mfe"] = window_high.index(peak)  # entry からの本数(暦日ではない)
    return out


def benchmark_outcome(
    bench_dates: list[str],
    bench_opens: list[float],
    bench_closes: list[float],
    entry_date: str,
    horizons: tuple[int, ...] = FWD_HORIZONS,
) -> dict:
    """同じ entry 日のベンチマーク(TOPIX)側リターン(§4.1)。

    ベンチ側に entry_date そのものが無ければ**直後の営業日**に丸める
    (バー位置は銘柄ごとに違うので、暦日で突き合わせる)。
    """
    out: dict = {f"topix_fwd{h}": None for h in horizons}
    n = len(bench_dates)
    i = bisect_left(bench_dates, entry_date)
    if i >= n:
        return out
    entry_px = float(bench_opens[i])
    if entry_px <= 0:
        return out
    for h in horizons:
        j = i + h
        out[f"topix_fwd{h}"] = (
            float(bench_closes[j]) / entry_px - 1.0 if j < n else None
        )
    return out


# --------------------------------------------------------------------------- #
# 統計(日付単位ブロックブートストラップ)
# --------------------------------------------------------------------------- #
def block_bootstrap_means(
    values_by_date: dict[str, list[float]],
    n_iter: int = DEFAULT_BOOTSTRAP_ITERS,
    seed: int = 0,
) -> list[float]:
    """日付をまるごと復元抽出して平均を n_iter 個生成する(§4.3)。

    同じ日に出た複数銘柄は互いに独立でない(地合いの良い日にまとめて出る)ため、
    再サンプリングの単位は銘柄ではなく日付にする。銘柄単位で引くと信頼区間が
    実際の 1/3 程度に狭まり、有意でないものが有意に見える。

    1 iteration では len(values_by_date) 個の日付を復元抽出し、選ばれた日の値を
    すべて集めて平均する。seed 固定で決定的(``random.Random`` をローカルに作り
    global 状態を汚さない)。

    **値が空の日付は呼び出し側で除いておくこと**(空だけが引かれた iteration は
    平均を定義できないためスキップされ、実効反復数が n_iter を下回る)。
    """
    keys = [k for k in values_by_date]
    k_count = len(keys)
    if k_count == 0 or n_iter <= 0:
        return []

    rng = random.Random(seed)
    means: list[float] = []
    for _ in range(n_iter):
        pooled: list[float] = []
        for _ in range(k_count):
            pooled.extend(values_by_date[keys[rng.randrange(k_count)]])
        if pooled:
            means.append(sum(pooled) / len(pooled))
    return means


def paired_block_bootstrap_diffs(
    a_by_date: dict[str, list[float]],
    b_by_date: dict[str, list[float]],
    n_iter: int = DEFAULT_BOOTSTRAP_ITERS,
    seed: int = 0,
) -> list[float]:
    """同じ日付を引いて2系列の平均差 (a - b) を n_iter 個生成する(§4.3)。

    「N字の平均がランダム分布の何パーセンタイルか」は、N字側の平均が持つ
    不確実性を無視した比較になる(点推定 vs 分布)。数十イベント規模では
    N字側の分散の方が大きいことも多く、有意性を過大評価する。差そのものを
    ブートストラップすれば両方の不確実性が入る。

    引く日付は **両系列に値がある日付の共通集合**。同じ日を両系列から引くので
    地合いが対応付き(paired)でキャンセルされ、日付クラスタの非独立性も
    block_bootstrap_means と同様に保たれる。

    どちらかの pooled が空になった iteration はスキップする(差を定義できない)。
    """
    keys = [k for k in a_by_date if k in b_by_date and a_by_date[k] and b_by_date[k]]
    k_count = len(keys)
    if k_count == 0 or n_iter <= 0:
        return []

    rng = random.Random(seed)
    diffs: list[float] = []
    for _ in range(n_iter):
        pooled_a: list[float] = []
        pooled_b: list[float] = []
        for _ in range(k_count):
            k = keys[rng.randrange(k_count)]
            pooled_a.extend(a_by_date[k])
            pooled_b.extend(b_by_date[k])
        if pooled_a and pooled_b:
            diffs.append(
                sum(pooled_a) / len(pooled_a) - sum(pooled_b) / len(pooled_b)
            )
    return diffs


def percentile_of(distribution: list[float], value: float) -> float:
    """distribution の中で value 以下の割合(0-100)。空なら nan。"""
    if not distribution:
        return float("nan")
    below = sum(1 for v in distribution if v <= value)
    return below / len(distribution) * 100.0


def _percentile_at(sorted_values: list[float], pct: float) -> float:
    """ソート済み列の線形補間パーセンタイル。"""
    n = len(sorted_values)
    if n == 0:
        return float("nan")
    if n == 1:
        return sorted_values[0]
    pos = (pct / 100.0) * (n - 1)
    lo = int(pos)
    hi = min(lo + 1, n - 1)
    frac = pos - lo
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * frac


def confidence_interval(
    distribution: list[float],
    lower: float = CI_LOWER_PCT,
    upper: float = CI_UPPER_PCT,
) -> tuple[float, float]:
    """分布のパーセンタイル区間。空なら (nan, nan)。"""
    if not distribution:
        return (float("nan"), float("nan"))
    s = sorted(distribution)
    return (_percentile_at(s, lower), _percentile_at(s, upper))
