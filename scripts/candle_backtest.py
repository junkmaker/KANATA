"""ローソク足パターンの検証（I/O と集計の層）。

`analysis/candle_patterns.py`（純関数）で検出し、OHLCV ストアから前方リターンを
取り、**同じ日にランダムに買った場合**と比較する。

使い方（リポジトリルートから）:
    python scripts/candle_backtest.py
    python scripts/candle_backtest.py --patterns morning_star,hammer --horizons 5,10
    python scripts/candle_backtest.py --start 2021-08-01 --end 2023-06-30
    # 売買代金上位159銘柄に絞る（大型株の検証。docs/large_cap_candle_backtest_spec.md）
    python scripts/candle_backtest.py --turnover-top 159 --rank-asof 2021-09-24 \
        --start 2021-08-01 --end 2023-06-30

なぜランダム比が必須か
----------------------
2021〜2026 の日本株では、**どの銘柄でもいいから 10 日持てば勝率 53〜55%** になる。
生の勝率だけを見ると、情報のないパターンでも「勝率 54.7% の有効なシグナル」に見える。
実測で明けの明星は勝率 54.7% だったが、同日ランダムは 55.3% で**負けていた**。
生の勝率を単独で出力しない（必ずランダム比を併記する）。

母集団は 1 箇所で決める
-----------------------
**品質フィルタは `eligible_codes` が 1 回だけ掛け、その結果をシグナル側と
ランダム側の両方に渡す。** 以前は `collect_signals` の内側でだけフィルタしており、
シグナル側 562 銘柄 / ランダム側 565 銘柄という母集団の不一致があった（旧 §7）。
8303 は 693 行中 245 行が負値で fwd10 の最大値が +1,977万% あり、**1 サンプル
引かれただけで帰無平均が桁ごと壊れる**。個々の関数の内側でフィルタを足す形に
戻さないこと — 片方に足し忘れた瞬間に同じ欠陥が復活する。
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))  # src.* を解決するため

import argparse  # noqa: E402
import random  # noqa: E402
from typing import Callable  # noqa: E402

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from src.analysis import backtest, candle_patterns  # noqa: E402
from src.services import ohlcv_store  # noqa: E402
from src.services.screening_provider import load_universe  # noqa: E402

DEFAULT_UNIVERSE = str(REPO_ROOT / "backend" / "data" / "topix_universe.csv")
DEFAULT_HORIZONS = (5, 10, 20)
DEFAULT_SAMPLES_PER_DATE = 6
BOOTSTRAP_ITERS = 2000
MIN_BARS = 40                    # 検出に必要な最低バー数（母集団判定にも使う）
TURNOVER_WINDOW = 60             # 売買代金ランキングのローリング窓（本）


def _log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


_STORE_CACHE: dict[str, pd.DataFrame | None] = {}


def read_cached(code: str) -> pd.DataFrame | None:
    """ストアの読み込みをプロセス内で 1 回に抑える。

    母集団判定・売買代金ランキング・シグナル検出が同じ Parquet を 3 度読むため。
    """
    if code not in _STORE_CACHE:
        _STORE_CACHE[code] = ohlcv_store.read_ohlcv(code)
    return _STORE_CACHE[code]


def eligible_codes(
    codes: list[str], min_bars: int = MIN_BARS
) -> tuple[list[str], list[str], list[str]]:
    """``(使える, OHLCV 不足, 品質不良)`` に分ける。**母集団の単一の決定点**。

    品質不良の条件は `backtest_report.partition_by_quality` と同じく
    「非正の価格を含む」または「`sanity_check` が発火する」。ストアの値は消さず、
    ここで母集団から外すだけにする。

    `min_bars` 未満をここで落とすのは、`collect_signals` が同じ条件で
    スキップするため — **シグナル側だけが落とす条件をここに集約しないと、
    ランダム側の母集団だけが広いという旧 §7 の不一致が再発する。**
    """
    usable: list[str] = []
    missing: list[str] = []
    bad: list[str] = []
    for code in codes:
        df = read_cached(code)
        if df is None or len(df) < min_bars:
            missing.append(code)
        elif ohlcv_store.has_non_positive_prices(df) or ohlcv_store.sanity_check(df):
            bad.append(code)
        else:
            usable.append(code)
    return (usable, missing, bad)


def select_by_turnover(
    codes: list[str],
    top: int,
    asof: str,
    window: int = TURNOVER_WINDOW,
) -> list[str]:
    """売買代金（``Close * Volume``）のローリング中央値で上位 ``top`` 銘柄を返す。

    **規模の指標に時価総額を使わない。** ストアは ``auto_adjust=True`` で保存されており
    過去バーは実際の株価ではないため、過去時点の時価総額は計算できない
    （`screening_provider._last_bar` のコメント参照）。``Close * Volume`` は分割に対して
    不変（価格 1/n・出来高 n 倍）なので、調整済みストアのままで正しく計算できる
    唯一の規模指標である。

    **``shift(1)`` を落とさないこと。** 当日の売買代金でその日の母集団を決めると、
    「その日たまたま出来高が膨らんだ銘柄」を後知恵で選ぶことになる。

    ``asof`` 時点で 1 回だけ判定し、期間中は固定する（日次リバランスとの母集団一致率は
    実測 78%。日次にすると `random_returns` を日次母集団対応に変える必要があり、
    旧 §7 と同種の不一致を 1200 倍の面で再導入することになる）。

    設計の根拠は docs/large_cap_candle_backtest_spec.md §1.2〜§1.4。
    """
    series: dict[str, pd.Series] = {}
    for code in codes:
        df = read_cached(code)
        if df is None or df.empty:
            continue
        series[code] = (df["Close"].astype(float) * df["Volume"].astype(float))
    if not series:
        raise ValueError("売買代金を計算できる銘柄が無い")
    panel = pd.DataFrame(series).sort_index()
    min_periods = max(window * 2 // 3, 2)
    roll = panel.rolling(window, min_periods=min_periods).median().shift(1)
    upto = roll.loc[roll.index <= pd.Timestamp(asof)]
    if upto.empty:
        raise ValueError(f"--rank-asof {asof} 以前のバーがストアに無い")
    row = upto.iloc[-1]
    ranked = row.dropna().sort_values(ascending=False)
    if len(ranked) < top:
        raise ValueError(
            f"--rank-asof {asof} 時点で順位が付くのは {len(ranked)} 銘柄しかない"
            f"（--turnover-top {top} を満たせない）。ローリング窓 {window} 本には"
            f" 最低 {min_periods} 本が要る — ストア先頭から十分に離れた日付を指定する"
        )
    return sorted(ranked.index[:top].tolist())


def collect_masked(
    codes: list[str],
    masks: dict[str, "Callable[[pd.DataFrame], np.ndarray]"],
    horizons: tuple[int, ...],
    start: str | None,
    end: str | None,
) -> dict[str, pd.DataFrame]:
    """任意の bool マスクについて entry と前方リターンを記録する。

    entry は **成立バーの翌営業日始値**。リターンは ``close[j+h] / open[j] - 1`` で
    ``backtest.benchmark_outcome`` と同じ規約に揃える（土俵を揃えないと比較できない）。

    銘柄ループを外側にしているのは I/O のため — 系列ごとに全銘柄を読み直すと
    Parquet の読み込みが系列数倍になる。

    **パターン検出と §4 の要素分解が同じ関数を通ることに意味がある。** entry の取り方が
    1 バーでもズレた系列を混ぜると、差を取る 2 つの平均が別の規約の上で計算される。
    `collect_signals`（パターン名）と `candle_factor_backtest`（形状/文脈のマスク）は
    どちらもここへ集約する。

    **品質フィルタはここで掛けない。** `eligible_codes` を通した `codes` を渡すこと
    （母集団の決定点は 1 箇所にする。旧 §7 の再発防止）。`len(df) < MIN_BARS` の
    ガードだけは構造上の要請として残してあるが、事前フィルタ済みなら no-op になる。
    """
    rows: dict[str, list[dict]] = {name: [] for name in masks}
    for code in codes:
        df = read_cached(code)
        if df is None or len(df) < MIN_BARS:
            continue
        dates = backtest.iso_dates(df.index)
        o = df["Open"].astype(float).to_numpy()
        c = df["Close"].astype(float).to_numpy()
        n = len(c)
        for name, mask_fn in masks.items():
            hit = mask_fn(df)
            if not hit.any():
                continue
            for i in np.flatnonzero(hit):
                j = i + 1                      # entry = 翌営業日
                if j >= n or o[j] <= 0:
                    continue
                if (start and dates[i] < start) or (end and dates[i] > end):
                    continue
                rec = {"symbol": code, "signal_date": dates[i], "entry_date": dates[j]}
                for h in horizons:
                    k = j + h
                    rec[f"fwd{h}"] = (c[k] / o[j] - 1.0) if k < n else np.nan
                rows[name].append(rec)
    return {name: pd.DataFrame(r) for name, r in rows.items()}


def collect_signals(
    codes: list[str],
    patterns: list[str],
    horizons: tuple[int, ...],
    start: str | None,
    end: str | None,
    require_gap: bool = False,
) -> dict[str, pd.DataFrame]:
    """名前付きパターンを検出して `collect_masked` に流す薄いラッパ。"""
    gapped = {"morning_star", "evening_star"}

    def _mask(pattern: str):
        kwargs = {"require_gap": require_gap} if pattern in gapped else {}
        return lambda df: candle_patterns.detect(pattern, df, **kwargs)

    return collect_masked(codes, {p: _mask(p) for p in patterns}, horizons, start, end)


def random_returns(
    dates: list[str],
    codes: list[str],
    horizon: int,
    samples_per_date: int,
    seed: int,
) -> dict[str, list[float]]:
    """各シグナル日に同ユニバースからランダムに引いた場合の同期間リターン。

    **日付は揃え、銘柄は揃えない**（地合いを相殺するため）。母集団は
    シグナルが出た銘柄ではなく**ユニバース全体**にする（帰無分布が寄るのを防ぐ）。

    **`codes` は `eligible_codes` を通したものであること。** ここで独自にフィルタを
    足さない — 母集団の決定点が 2 つになると、片方を直し忘れた瞬間に旧 §7 が復活する。
    """
    rng = random.Random(seed)
    cache: dict[str, tuple[list[str], dict[str, int], np.ndarray, np.ndarray] | None] = {}

    def _load(code: str):
        if code not in cache:
            df = read_cached(code)
            if df is None or df.empty:
                cache[code] = None
            else:
                d = backtest.iso_dates(df.index)
                cache[code] = (
                    d,
                    {v: k for k, v in enumerate(d)},
                    df["Open"].astype(float).to_numpy(),
                    df["Close"].astype(float).to_numpy(),
                )
        return cache[code]

    out: dict[str, list[float]] = {}
    for day in dates:
        picked: list[float] = []
        for _ in range(samples_per_date * 3):       # 欠損で落ちる分を見込んで多めに試行
            if len(picked) >= samples_per_date:
                break
            loaded = _load(rng.choice(codes))
            if loaded is None:
                continue
            d, pos, o, c = loaded
            i = pos.get(day)
            if i is None:
                continue
            j, k = i + 1, i + 1 + horizon
            if k >= len(c) or o[j] <= 0:
                continue
            picked.append(float(c[k] / o[j] - 1.0))
        if picked:
            out[day] = picked
    return out


def compare(
    sig: pd.DataFrame, rnd: dict[str, list[float]], horizon: int, seed: int = 3
) -> dict | None:
    """日付ブロックブートストラップでパターン − ランダムの差を出す。

    再抽出の単位は**日付**。同じ日に出たシグナルは互いに独立でないため、
    シグナル単位で引くと信頼区間が実際より狭くなる。

    ``bound`` は CI の絶対値上限（``max(|lo|, |hi|)``）。**「効果があるとしても
    この幅以下」を読むための列で、有意/非有意の二値判定の代わりに使う。**
    CI が 0 を跨いだことは「効果が無い」ではなく「n が足りないかもしれない」を
    含むため、否決を主張するには上限そのものを示す必要がある
    （docs/large_cap_candle_backtest_spec.md §2.2）。
    """
    col = f"fwd{horizon}"
    g = sig[sig[col].notna()]
    by = {d: s[col].to_numpy() for d, s in g.groupby("signal_date")}
    dts = [d for d in by if d in rnd and rnd[d]]
    if len(dts) < 10:
        return None
    ns = np.array([by[d].sum() for d in dts]); nc = np.array([len(by[d]) for d in dts])
    nw = np.array([(by[d] > 0).sum() for d in dts])
    rs = np.array([np.sum(rnd[d]) for d in dts]); rc = np.array([len(rnd[d]) for d in dts])
    rw = np.array([np.sum(np.asarray(rnd[d]) > 0) for d in dts])
    rng = np.random.default_rng(seed)
    i = rng.integers(0, len(dts), size=(BOOTSTRAP_ITERS, len(dts)))
    dm = (ns[i].sum(1) / nc[i].sum(1)) - (rs[i].sum(1) / rc[i].sum(1))
    lo, hi = np.percentile(dm, [2.5, 97.5])
    return {
        "n": len(g),
        "win": nw.sum() / nc.sum(),
        "rnd_win": rw.sum() / rc.sum(),
        "mean": ns.sum() / nc.sum(),
        "rnd_mean": rs.sum() / rc.sum(),
        "diff": ns.sum() / nc.sum() - rs.sum() / rc.sum(),
        "lo": lo,
        "hi": hi,
        "bound": max(abs(lo), abs(hi)),
    }


def resolve_codes(args) -> list[str]:
    """CSV → 品質フィルタ → （任意で）売買代金上位 N、の順で母集団を確定する。

    **品質フィルタはランキングの前に掛ける。** 8303 は負値を含むため
    ``Close * Volume`` の順位そのものが無意味で、後に掛けると母集団が
    ``top`` に満たなくなる（docs/large_cap_candle_backtest_spec.md §1.6）。
    """
    raw = [str(r["code"]) for r in load_universe(args.universe, min_market_cap=0)]
    codes, missing, bad = eligible_codes(raw)
    _log(
        f"ユニバース {len(raw)} 銘柄 → 使える {len(codes)}"
        f"（OHLCV 不足 {len(missing)} / 品質不良 {len(bad)}"
        + (f": {','.join(bad)}" if bad else "")
        + "）"
    )
    if args.turnover_top:
        asof = args.rank_asof or args.start
        if not asof:
            raise SystemExit("--turnover-top を使うときは --rank-asof か --start が要る")
        codes = select_by_turnover(codes, args.turnover_top, asof, args.turnover_window)
        _log(
            f"売買代金上位 {args.turnover_top} 銘柄に絞る"
            f"（{args.turnover_window}本中央値・shift(1)・判定日 {asof}）"
        )
    return codes


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="ローソク足パターンの検証")
    p.add_argument("--patterns", default=",".join(candle_patterns.PATTERN_NAMES))
    p.add_argument("--horizons", default=",".join(str(h) for h in DEFAULT_HORIZONS))
    p.add_argument("--universe", default=DEFAULT_UNIVERSE)
    p.add_argument("--start", default=None)
    p.add_argument("--end", default=None)
    p.add_argument("--require-gap", action="store_true", help="明星に窓の条件を課す（古典的定義）")
    p.add_argument("--samples-per-date", type=int, default=DEFAULT_SAMPLES_PER_DATE)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument(
        "--turnover-top", type=int, default=0,
        help="売買代金上位 N 銘柄に絞る（0 で無効）。シグナル側とランダム側の両方に効く",
    )
    p.add_argument("--turnover-window", type=int, default=TURNOVER_WINDOW)
    p.add_argument(
        "--rank-asof", default=None,
        help="売買代金ランキングの判定日（省略時は --start）",
    )
    args = p.parse_args(argv)

    horizons = tuple(int(h) for h in args.horizons.split(","))
    patterns = [s.strip() for s in args.patterns.split(",") if s.strip()]
    unknown = [s for s in patterns if s not in candle_patterns.DETECTORS]
    if unknown:
        _log(f"エラー: 未知のパターン {unknown}")
        return 1

    codes = resolve_codes(args)
    _log(f"母集団 {len(codes)} 銘柄 / 期間 {args.start or '最初'} 〜 {args.end or '最後'}")

    signals = collect_signals(
        codes, patterns, horizons, args.start, args.end, args.require_gap
    )
    _log("検出: " + " / ".join(f"{n}={len(s)}" for n, s in signals.items()))

    # ランダム母集団は全営業日ぶん 1 度だけ引く（パターンごとに引き直すと
    # 同じ日の帰無分布がパターン間で食い違い、横並び比較にならない）。
    # codes はシグナル側と同一（eligible_codes を通した集合）。
    all_dates = sorted({d for s in signals.values() if not s.empty
                        for d in s["signal_date"].unique()})
    rnd_by_h = {
        h: random_returns(all_dates, codes, h, args.samples_per_date, args.seed)
        for h in horizons
    }

    print("| パターン | 方向 | h | n | 件/週 | 勝率 | ランダム勝率 | 平均 | 差 | 95% CI | 上限 |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for name in patterns:
        sig = signals[name]
        if sig.empty:
            _log(f"{name}: 検出 0 件")
            continue
        weeks = max(sig["signal_date"].nunique() / 5.0, 1.0)
        for h in horizons:
            res = compare(sig, rnd_by_h[h], h)
            if res is None:
                continue
            star = " ★" if (res["lo"] > 0 or res["hi"] < 0) else ""
            print(
                f"| {candle_patterns.LABELS[name]} | {candle_patterns.SIGNALS[name]} | {h} "
                f"| {res['n']} | {res['n']/weeks:.1f} | {res['win']*100:.1f}% "
                f"| {res['rnd_win']*100:.1f}% | {res['mean']*100:+.2f}% "
                f"| {res['diff']*100:+.2f}% | [{res['lo']*100:+.2f}%, {res['hi']*100:+.2f}%]{star} "
                f"| {res['bound']*100:.2f}% |"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
