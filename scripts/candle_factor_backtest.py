"""ハンマー/首吊り線の「形状」と「トレンド文脈」を分けて測る（docs §4 のスクリプト化）。

`hammer` = 「ハンマー型の**形状**」かつ「直前 10 本で -5% 以上の**下降**」という
2 条件の合成である。合成後の数字からはどちらが効いているのか分からないため、
条件ごとに分けて測る（[CLAUDE.md](../CLAUDE.md)「条件を 2 つ以上持つ検出器を足したら、
条件ごとに分けて測ること」）。

大型株フィルタを掛けると条件は 3 つ（形状 × 文脈 × 大型株）になる。**ランダム比だけの
表を作ると「大型株では形状が効く」と読める行が生まれるが、3 条件の合成数字からは
どの条件の寄与かを分離できない。**

出力は 2 つの表:

- **§4.1 ランダム比** — 5 系列それぞれを「同じ日にランダムに買った場合」と比べる
- **§4.2 増分検定** — 対照群を**「同じ文脈で形状が出ていないバー」**に置き換え、
  形状そのものの増分を直接測る。4.1 はどちらもランダムに対して測っているので、
  形状の増分は点推定の目視比較にとどまるため

使い方（リポジトリルートから）:
    python scripts/candle_factor_backtest.py --horizons 5,10 --start 2023-07-01
    python scripts/candle_factor_backtest.py --horizons 5,10 \
        --start 2021-08-01 --end 2023-06-30
    # 大型株 159 銘柄
    python scripts/candle_factor_backtest.py --horizons 5,10 --start 2023-07-01 \
        --turnover-top 159 --rank-asof 2023-07-03

**7 系列すべてを 1 回の run に入れること。** 系列を絞ると `random_returns` が消費する
日付集合が変わって帰無分布がズレ、系列間の横並び比較が成立しなくなる（1 run = 1 表）。
"""
from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from src.analysis import candle_patterns as cp  # noqa: E402


def _load_backtest_module():
    """scripts/ はパッケージではないのでファイルパスからロードする。

    統計（`compare`）・母集団（`eligible_codes` / `select_by_turnover`）・
    entry 規約（`collect_masked`）を candle_backtest と**共有する**ことが要点。
    ここで再実装すると、差を取る 2 つの平均が別の規約の上で計算されうる。
    """
    spec = importlib.util.spec_from_file_location(
        "candle_backtest", REPO_ROOT / "scripts" / "candle_backtest.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cb = _load_backtest_module()

# 5 系列 + 増分検定の対照群 2 つ。ラベルは docs の表とそろえる
SERIES_LABELS = {
    "hammer": "ハンマー（形状 かつ 下降文脈）",
    "hanging_man": "首吊り線（形状 かつ 上昇文脈）",
    "shape_only": "形状のみ（文脈を問わない）",
    "down_only": "下降文脈のみ（形状を問わない）",
    "up_only": "上昇文脈のみ（形状を問わない）",
    "down_no_shape": "下降文脈で形状なし（対照群）",
    "up_no_shape": "上昇文脈で形状なし（対照群）",
}
# §4.1 に出す 5 系列（対照群は単独では出さない）
RANDOM_ROWS = ("hammer", "shape_only", "down_only", "hanging_man", "up_only")
# §4.2 の (被験群, 対照群)
INCREMENT_PAIRS = (("hammer", "down_no_shape"), ("hanging_man", "up_no_shape"))


def _masks() -> dict:
    """7 系列の bool マスク。

    `_hammer_shape` と `trend_change_ratio` は `candle_patterns` の内部関数を直接使う。
    **検出器の定義を写し書きしない** — 写した時点で `detect_hammer` との一致が
    テストの管轄外になり、閾値を変えたときに分解だけが古い定義で走る。
    """
    def cols(df: pd.DataFrame):
        return [df[x].astype(float).to_numpy() for x in ("Open", "High", "Low", "Close")]

    def shape(df):
        o, h, l, c = cols(df)
        return cp._hammer_shape(o, h, l, c)

    def down(df):
        return cp.trend_change_ratio(cols(df)[3]) <= -cp.HAMMER_TREND_RATIO

    def up(df):
        return cp.trend_change_ratio(cols(df)[3]) >= cp.HAMMER_TREND_RATIO

    return {
        "hammer": lambda df: shape(df) & down(df),
        "hanging_man": lambda df: shape(df) & up(df),
        "shape_only": shape,
        "down_only": down,
        "up_only": up,
        "down_no_shape": lambda df: down(df) & ~shape(df),
        "up_no_shape": lambda df: up(df) & ~shape(df),
    }


def by_date(sig: pd.DataFrame, horizon: int) -> dict[str, list[float]]:
    """DataFrame を `compare` が対照群として受け取れる ``{日付: [リターン]}`` にする。

    `compare(sig, rnd, h)` の ``rnd`` はランダム専用ではない — 同じ形なら
    任意の対照群を渡せる。§4.2 はこれを使って「同じ文脈で形状なし」を対照群にする。
    """
    col = f"fwd{horizon}"
    g = sig[sig[col].notna()]
    return {d: s[col].tolist() for d, s in g.groupby("signal_date")}


def _row(label: str, h: int, res: dict, n_override: int | None = None) -> str:
    star = " ★" if (res["lo"] > 0 or res["hi"] < 0) else ""
    return (
        f"| {label} | {h} | {n_override if n_override is not None else res['n']} "
        f"| {res['mean']*100:+.2f}% | {res['rnd_mean']*100:+.2f}% "
        f"| {res['diff']*100:+.2f}% "
        f"| [{res['lo']*100:+.2f}%, {res['hi']*100:+.2f}%]{star} | {res['bound']*100:.2f}% |"
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="ハンマーの形状と文脈を分けて測る")
    p.add_argument("--horizons", default="5,10")
    p.add_argument("--universe", default=cb.DEFAULT_UNIVERSE)
    p.add_argument("--start", default=None)
    p.add_argument("--end", default=None)
    p.add_argument("--samples-per-date", type=int, default=cb.DEFAULT_SAMPLES_PER_DATE)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--turnover-top", type=int, default=0)
    p.add_argument("--turnover-window", type=int, default=cb.TURNOVER_WINDOW)
    p.add_argument("--rank-asof", default=None)
    args = p.parse_args(argv)

    horizons = tuple(int(h) for h in args.horizons.split(","))
    codes = cb.resolve_codes(args)
    print(
        f"母集団 {len(codes)} 銘柄 / 期間 {args.start or '最初'} 〜 {args.end or '最後'}",
        file=sys.stderr, flush=True,
    )

    series = cb.collect_masked(codes, _masks(), horizons, args.start, args.end)
    print(
        "検出: " + " / ".join(f"{k}={len(v)}" for k, v in series.items()),
        file=sys.stderr, flush=True,
    )

    # ランダム母集団は全系列の日付の和集合について 1 度だけ引く
    all_dates = sorted({d for s in series.values() if not s.empty
                        for d in s["signal_date"].unique()})
    rnd_by_h = {
        h: cb.random_returns(all_dates, codes, h, args.samples_per_date, args.seed)
        for h in horizons
    }

    print("\n### 4.1 ランダム比\n")
    print("| 系列 | h | n | 平均 | ランダム | 差 | 95% CI | 上限 |")
    print("|---|---|---|---|---|---|---|---|")
    for name in RANDOM_ROWS:
        sig = series[name]
        if sig.empty:
            continue
        for h in horizons:
            res = cb.compare(sig, rnd_by_h[h], h)
            if res:
                print(_row(SERIES_LABELS[name], h, res))

    print("\n### 4.2 増分検定（対照群 = 同じ文脈で形状なし）\n")
    print("| 比較 | h | n(形状あり) | 形状あり | 形状なし | 差 | 95% CI | 上限 |")
    print("|---|---|---|---|---|---|---|---|")
    for subject, control in INCREMENT_PAIRS:
        sig, ctl = series[subject], series[control]
        if sig.empty or ctl.empty:
            continue
        for h in horizons:
            res = cb.compare(sig, by_date(ctl, h), h)
            if res:
                label = f"{SERIES_LABELS[subject].split('（')[0]} − {SERIES_LABELS[control].split('（')[0]}"
                print(_row(label, h, res))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
