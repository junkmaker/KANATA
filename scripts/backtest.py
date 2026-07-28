"""N字バックテストの実行 CLI(①取得 / ②検出 / ③アウトカム)。

段階ごとに出力をファイルへ残し、個別に再実行できる(§10)。
④集計は scripts/backtest_report.py。

使い方(リポジトリルートから):
    python scripts/backtest.py fetch    --period 5y
    python scripts/backtest.py detect   --start 2023-07-01
    python scripts/backtest.py outcomes
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))  # src.* を解決するため

import argparse  # noqa: E402 - sys.path 設定後に import する必要がある

import pandas as pd  # noqa: E402

from src.analysis import backtest  # noqa: E402
from src.services import ohlcv_store  # noqa: E402
from src.services.screening_provider import load_universe  # noqa: E402
from src.services.storage import data_dir  # noqa: E402

BACKTEST_DIRNAME = "backtest"
SIGNALS_FILENAME = "signals.parquet"
OUTCOMES_FILENAME = "outcomes.parquet"
DEFAULT_UNIVERSE = str(REPO_ROOT / "backend" / "data" / "topix_universe.csv")

# エントリー種別。backtest.resolve_entries が返すキーと一致させる
ENTRY_KINDS = ("next_open", "weekly", "lag_1", "lag_3", "lag_5")
# Parquet で欠損を保持するための nullable dtype(None を入れると object になるのを防ぐ)
NULLABLE_FLOAT = "Float64"
NULLABLE_INT = "Int64"


def backtest_dir() -> Path:
    """``<KANATA_DATA_DIR>/backtest`` を mkdir して返す。"""
    d = data_dir() / BACKTEST_DIRNAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def _log(msg: str) -> None:
    """進捗・警告は stderr へ(stdout はレポート本体のために空けておく §10.2)。"""
    print(msg, file=sys.stderr, flush=True)


def _write_parquet_atomic(df: pd.DataFrame, path: Path) -> None:
    """tmp に書いて replace する(storage.atomic_write_json と同じ形)。"""
    tmp = path.with_name(path.name + ".tmp")
    df.to_parquet(tmp, engine="pyarrow")
    tmp.replace(path)


def _cast_nullable(df: pd.DataFrame, float_cols: list[str], int_cols: list[str]) -> pd.DataFrame:
    """打ち切りの None を欠損として保持できる nullable dtype に揃える。

    素の float64 に入れると None が NaN に潰れて型が object になりやすく、
    「未成熟で測れない」と「0%」の区別が Parquet 往復で失われる。
    """
    out = df.copy()
    for col in float_cols:
        if col in out.columns:
            out[col] = out[col].astype(NULLABLE_FLOAT)
    for col in int_cols:
        if col in out.columns:
            out[col] = out[col].astype(NULLABLE_INT)
    return out


def _universe_codes(universe: str, limit: int | None) -> list[dict]:
    """ユニバース CSV を読み、--limit があれば先頭 N 銘柄に絞る。

    topix_universe.csv は market_cap 列を持たないためフィルタは元々効かないが、
    ``min_market_cap=0`` を明示して「絞らない」意図を残す。
    """
    rows = load_universe(universe, min_market_cap=0)
    return rows[:limit] if limit else rows


# --------------------------------------------------------------------------- #
# ① 取得
# --------------------------------------------------------------------------- #
def cmd_fetch(args: argparse.Namespace) -> int:
    rows = _universe_codes(args.universe, args.limit)
    codes = [r["code"] for r in rows]
    targets = codes + [ohlcv_store.BENCHMARK_SYMBOL]
    _log(f"出力先: {ohlcv_store.ohlcv_dir()}")
    _log(f"取得対象 {len(targets)} 銘柄(ベンチマーク {ohlcv_store.BENCHMARK_SYMBOL} を含む)")

    def on_progress(i: int, total: int, symbol: str) -> None:
        _log(f"  {i}/{total} {symbol}")

    summary = ohlcv_store.sync_symbols(
        targets, period=args.period, full=args.full, on_progress=on_progress
    )
    _log(
        f"created={summary['created']} updated={summary['updated']} "
        f"unchanged={summary['unchanged']} failed={len(summary['failed'])}"
    )
    if summary["failed"]:
        # 黙って統計から抜けさせない(§12)
        _log(f"取得失敗: {', '.join(summary['failed'])}")

    bench = ohlcv_store.read_ohlcv(ohlcv_store.BENCHMARK_SYMBOL)
    if bench is None:
        _log(f"警告: ベンチマーク {ohlcv_store.BENCHMARK_SYMBOL} を取得できていない")
    else:
        spikes = ohlcv_store.sanity_check(bench)
        if spikes:
            # 除去はしない。判定結果だけ出して人間が確認する(§12.1)
            _log(f"警告: ベンチマークに異常変化率の日 {len(spikes)} 件: {', '.join(spikes[:10])}")
    return 0


# --------------------------------------------------------------------------- #
# ② 検出
# --------------------------------------------------------------------------- #
def cmd_detect(args: argparse.Namespace) -> int:
    rows = _universe_codes(args.universe, args.limit)
    total = len(rows)
    _log(f"出力先: {backtest_dir()}")

    all_rows: list[dict] = []
    missing = 0
    for i, r in enumerate(rows, start=1):
        code = r["code"]
        df = ohlcv_store.read_ohlcv(code)
        if df is None or df.empty:
            missing += 1
            continue
        signals = backtest.walk_forward_signals(
            df, code, r.get("name", code), start=args.start, end=args.end
        )
        if signals:
            bar_index_of = {d: k for k, d in enumerate(backtest.iso_dates(df.index))}
            all_rows.extend(backtest.mark_overlaps(signals, bar_index_of))
        if i % 20 == 0 or i == total:
            _log(f"  {i}/{total} 銘柄 signals={len(all_rows)}")

    if missing:
        _log(f"警告: OHLCV 未取得の銘柄 {missing} 件(fetch を先に実行すること)")
    if not all_rows:
        _log("シグナルが 0 件だった。start/end とユニバースを確認すること")
        return 1

    df_out = pd.DataFrame(all_rows)
    df_out = _cast_nullable(df_out, ["pullback_ratio"], ["score", "detect_lag_bars", "duration_bars"])
    _write_parquet_atomic(df_out, backtest_dir() / SIGNALS_FILENAME)

    unique_events = int((~df_out["overlaps_prev"]).sum())
    _log(
        f"signals={len(df_out)} unique_events={unique_events} "
        f"symbols={df_out['symbol'].nunique()}"
    )
    return 0


# --------------------------------------------------------------------------- #
# ③ アウトカム
# --------------------------------------------------------------------------- #
def _outcome_columns() -> tuple[list[str], list[str]]:
    """(nullable float 列, nullable int 列) を返す。"""
    floats: list[str] = ["pullback_ratio"]
    ints: list[str] = ["score", "detect_lag_bars", "duration_bars"]
    for e in ENTRY_KINDS:
        floats += [
            f"{e}_px",
            f"{e}_fwd20",
            f"{e}_fwd60",
            f"{e}_mfe",
            f"{e}_mae",
            f"{e}_topix_fwd20",
            f"{e}_topix_fwd60",
        ]
        ints.append(f"{e}_days_to_mfe")
    return floats, ints


def cmd_outcomes(args: argparse.Namespace) -> int:
    signals_path = backtest_dir() / SIGNALS_FILENAME
    if not signals_path.exists():
        _log(f"エラー: {signals_path} が無い。先に detect を実行すること")
        return 1
    signals = pd.read_parquet(signals_path)
    _log(f"signals={len(signals)} を読み込んだ")

    # ベンチマークは1回だけ読んで list 化して使い回す
    bench_df = ohlcv_store.read_ohlcv(ohlcv_store.BENCHMARK_SYMBOL)
    if bench_df is None or bench_df.empty:
        # 比較対象のない数字は出さない(§4)。黙って bench 無しで進めない
        _log(
            f"エラー: ベンチマーク {ohlcv_store.BENCHMARK_SYMBOL} の OHLCV が無い。"
            " fetch を実行すること"
        )
        return 1
    bench_dates = backtest.iso_dates(bench_df.index)
    bench_opens = [float(v) for v in bench_df["Open"].tolist()]
    bench_closes = [float(v) for v in bench_df["Close"].tolist()]

    rows: list[dict] = []
    symbols = list(signals["symbol"].unique())
    for i, code in enumerate(symbols, start=1):
        df = ohlcv_store.read_ohlcv(code)
        if df is None or df.empty:
            _log(f"警告: {code} の OHLCV が無いためスキップ")
            continue
        dates = backtest.iso_dates(df.index)
        index_of = {d: k for k, d in enumerate(dates)}
        highs = [float(v) for v in df["High"].tolist()]
        lows = [float(v) for v in df["Low"].tolist()]
        closes = [float(v) for v in df["Close"].tolist()]
        opens = [float(v) for v in df["Open"].tolist()]

        for sig in signals[signals["symbol"] == code].to_dict("records"):
            signal_idx = index_of.get(sig["detected_date"])
            if signal_idx is None:
                _log(f"警告: {code} {sig['detected_date']} がバーに見つからずスキップ")
                continue
            row = dict(sig)
            entries = backtest.resolve_entries(dates, signal_idx)
            for kind in ENTRY_KINDS:
                idx = entries.get(kind)
                if idx is None:
                    row[f"{kind}_date"] = None
                    row[f"{kind}_px"] = None
                    for h in backtest.FWD_HORIZONS:
                        row[f"{kind}_fwd{h}"] = None
                        row[f"{kind}_topix_fwd{h}"] = None
                    row[f"{kind}_mfe"] = None
                    row[f"{kind}_mae"] = None
                    row[f"{kind}_days_to_mfe"] = None
                    continue
                entry_date = dates[idx]
                out = backtest.compute_outcomes(highs, lows, closes, opens, idx)
                bench = backtest.benchmark_outcome(
                    bench_dates, bench_opens, bench_closes, entry_date
                )
                row[f"{kind}_date"] = entry_date
                row[f"{kind}_px"] = out["entry_px"]
                for h in backtest.FWD_HORIZONS:
                    row[f"{kind}_fwd{h}"] = out[f"fwd{h}"]
                    row[f"{kind}_topix_fwd{h}"] = bench[f"topix_fwd{h}"]
                row[f"{kind}_mfe"] = out["mfe"]
                row[f"{kind}_mae"] = out["mae"]
                row[f"{kind}_days_to_mfe"] = out["days_to_mfe"]
            rows.append(row)
        if i % 20 == 0 or i == len(symbols):
            _log(f"  {i}/{len(symbols)} 銘柄 outcomes={len(rows)}")

    if not rows:
        _log("アウトカムが 0 件だった")
        return 1

    float_cols, int_cols = _outcome_columns()
    df_out = _cast_nullable(pd.DataFrame(rows), float_cols, int_cols)
    _write_parquet_atomic(df_out, backtest_dir() / OUTCOMES_FILENAME)

    longest = backtest.FWD_HORIZONS[-1]
    mature_col = f"weekly_fwd{longest}"
    mature = int(df_out[mature_col].notna().sum()) if mature_col in df_out.columns else 0
    _log(f"outcomes={len(df_out)} {mature_col} が取れた件数={mature}(残りは打ち切り)")
    _log(f"出力: {backtest_dir() / OUTCOMES_FILENAME}")
    return 0


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="N字バックテストの実行 CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_fetch = sub.add_parser("fetch", help="① OHLCV をローカル Parquet に取得")
    p_fetch.add_argument("--universe", default=DEFAULT_UNIVERSE)
    p_fetch.add_argument("--period", default=ohlcv_store.DEFAULT_PERIOD)
    p_fetch.add_argument("--limit", type=int, default=None, help="先頭 N 銘柄のみ")
    p_fetch.add_argument("--full", action="store_true", help="差分ではなく全期間を取り直す")
    p_fetch.set_defaults(func=cmd_fetch)

    p_detect = sub.add_parser("detect", help="② ウォークフォワード検出")
    p_detect.add_argument("--universe", default=DEFAULT_UNIVERSE)
    p_detect.add_argument("--start", default=None, help="判定を始める日(ISO)")
    p_detect.add_argument("--end", default=None, help="判定を終える日(ISO)")
    p_detect.add_argument("--limit", type=int, default=None, help="先頭 N 銘柄のみ")
    p_detect.set_defaults(func=cmd_detect)

    p_out = sub.add_parser("outcomes", help="③ エントリー解決とアウトカム計算")
    p_out.set_defaults(func=cmd_outcomes)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
