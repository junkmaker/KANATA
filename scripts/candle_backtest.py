"""ローソク足パターンの検証（I/O と集計の層）。

`analysis/candle_patterns.py`（純関数）で検出し、OHLCV ストアから前方リターンを
取り、**同じ日にランダムに買った場合**と比較する。

使い方（リポジトリルートから）:
    python scripts/candle_backtest.py
    python scripts/candle_backtest.py --patterns morning_star,hammer --horizons 5,10
    python scripts/candle_backtest.py --start 2021-08-01 --end 2023-06-30

なぜランダム比が必須か
----------------------
2021〜2026 の日本株では、**どの銘柄でもいいから 10 日持てば勝率 53〜55%** になる。
生の勝率だけを見ると、情報のないパターンでも「勝率 54.7% の有効なシグナル」に見える。
実測で明けの明星は勝率 54.7% だったが、同日ランダムは 55.3% で**負けていた**。
生の勝率を単独で出力しない（必ずランダム比を併記する）。
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))  # src.* を解決するため

import argparse  # noqa: E402
import random  # noqa: E402

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from src.analysis import backtest, candle_patterns  # noqa: E402
from src.services import ohlcv_store  # noqa: E402
from src.services.screening_provider import load_universe  # noqa: E402

DEFAULT_UNIVERSE = str(REPO_ROOT / "backend" / "data" / "topix_universe.csv")
DEFAULT_HORIZONS = (5, 10, 20)
DEFAULT_SAMPLES_PER_DATE = 6
BOOTSTRAP_ITERS = 2000


def _log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def collect_signals(
    codes: list[str],
    patterns: list[str],
    horizons: tuple[int, ...],
    start: str | None,
    end: str | None,
    require_gap: bool = False,
) -> dict[str, pd.DataFrame]:
    """全パターンを 1 回の読み込みで検出し、entry と前方リターンを記録する。

    entry は **成立バーの翌営業日始値**。リターンは ``close[j+h] / open[j] - 1`` で
    ``backtest.benchmark_outcome`` と同じ規約に揃える（土俵を揃えないと比較できない）。

    銘柄ループを外側にしているのは I/O のため — パターンごとに全銘柄を読み直すと
    Parquet の読み込みがパターン数倍になり、7 パターンで実用的な時間を超える。
    """
    gapped = {"morning_star", "evening_star"}
    rows: dict[str, list[dict]] = {p: [] for p in patterns}
    for code in codes:
        df = ohlcv_store.read_ohlcv(code)
        if df is None or len(df) < 40:
            continue
        if ohlcv_store.has_non_positive_prices(df) or ohlcv_store.sanity_check(df):
            continue  # 品質不良は母集団から外す（§14.2）。ストアの値は消さない
        dates = backtest.iso_dates(df.index)
        o = df["Open"].astype(float).to_numpy()
        c = df["Close"].astype(float).to_numpy()
        n = len(c)
        for pattern in patterns:
            kwargs = {"require_gap": require_gap} if pattern in gapped else {}
            hit = candle_patterns.detect(pattern, df, **kwargs)
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
                rows[pattern].append(rec)
    return {p: pd.DataFrame(r) for p, r in rows.items()}


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
    """
    rng = random.Random(seed)
    cache: dict[str, tuple[list[str], dict[str, int], np.ndarray, np.ndarray] | None] = {}

    def _load(code: str):
        if code not in cache:
            df = ohlcv_store.read_ohlcv(code)
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
    }


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
    args = p.parse_args(argv)

    horizons = tuple(int(h) for h in args.horizons.split(","))
    patterns = [s.strip() for s in args.patterns.split(",") if s.strip()]
    unknown = [s for s in patterns if s not in candle_patterns.DETECTORS]
    if unknown:
        _log(f"エラー: 未知のパターン {unknown}")
        return 1

    codes = [str(r["code"]) for r in load_universe(args.universe, min_market_cap=0)]
    _log(f"ユニバース {len(codes)} 銘柄 / 期間 {args.start or '最初'} 〜 {args.end or '最後'}")

    signals = collect_signals(
        codes, patterns, horizons, args.start, args.end, args.require_gap
    )
    _log("検出: " + " / ".join(f"{n}={len(s)}" for n, s in signals.items()))

    # ランダム母集団は全営業日ぶん 1 度だけ引く（パターンごとに引き直すと
    # 同じ日の帰無分布がパターン間で食い違い、横並び比較にならない）
    all_dates = sorted({d for s in signals.values() if not s.empty
                        for d in s["signal_date"].unique()})
    rnd_by_h = {
        h: random_returns(all_dates, codes, h, args.samples_per_date, args.seed)
        for h in horizons
    }

    print("| パターン | 方向 | h | n | 件/週 | 勝率 | ランダム勝率 | 平均 | 差 | 95% CI |")
    print("|---|---|---|---|---|---|---|---|---|---|")
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
                f"| {res['diff']*100:+.2f}% | [{res['lo']*100:+.2f}%, {res['hi']*100:+.2f}%]{star} |"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
