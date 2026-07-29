"""N字バックテストの集計とレポート生成(④)。

``outcomes.parquet`` を読み、「今のスコアは機能しているのか」に答えるための
Markdown レポートを出す。ここは探索的に書き換える層(§9.2)——
検出とアウトカムの計算には触れず、見方だけを変える。

使い方(リポジトリルートから):
    python scripts/backtest_report.py
    python scripts/backtest_report.py --entry next_open --include-overlaps
    python scripts/backtest_report.py --universe backend/data/topix_universe.csv
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))  # src.* を解決するため

import argparse  # noqa: E402 - sys.path 設定後に import する必要がある
import random  # noqa: E402

import pandas as pd  # noqa: E402

from src.analysis import backtest  # noqa: E402
from src.services import ohlcv_store  # noqa: E402
from src.services.screening_provider import load_universe  # noqa: E402

BACKTEST_DIRNAME = "backtest"
OUTCOMES_FILENAME = "outcomes.parquet"
REPORT_FILENAME = "report.md"
DEFAULT_UNIVERSE = str(REPO_ROOT / "backend" / "data" / "topix_universe.csv")

SCORE_BANDS = ((0, 50), (50, 70), (70, 85), (85, 100))   # §7.2 左閉右開(最上位のみ右も閉)
PRIMARY_ENTRY = "weekly"        # §6.1 主指標(期待値の見積もり)
TEST_ENTRY = "next_open"        # §6.1 検定用(シグナルに情報があるか)
ENTRY_ORDER = ("next_open", "lag_1", "lag_3", "lag_5", "weekly")

# §7.3 要素別寄与を見るスコア内訳列(加点は >0、減点は >0 で「発火」とみなす)
SCORE_FACTORS = (
    "sd_trend",
    "sd_breakout",
    "sd_volume",
    "sd_macd",
    "sd_pullback_penalty",
    "sd_duration_penalty",
)

DEFAULT_SAMPLES_PER_DATE = 20
PRIMARY_HORIZON = 20            # ランダムエントリー比較に使うホライズン


def backtest_dir() -> Path:
    from src.services.storage import data_dir

    return data_dir() / BACKTEST_DIRNAME


def _log(msg: str) -> None:
    """進捗は stderr(stdout はレポート本体)。"""
    print(msg, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- #
# 表組みヘルパ(依存を増やさず素の Markdown を組み立てる)
# --------------------------------------------------------------------------- #
def _table(headers: list[str], rows: list[list[str]]) -> str:
    head = "| " + " | ".join(headers) + " |"
    sep = "|" + "|".join(["---"] * len(headers)) + "|"
    body = ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join([head, sep, *body])


def _pct(value: float | None, digits: int = 2) -> str:
    """比率を % 表示に。None/NaN は明示的に n/a(0 と区別する)。"""
    if value is None or pd.isna(value):
        return "n/a"
    return f"{value * 100:.{digits}f}%"


def _num(value: float | None, digits: int = 1) -> str:
    if value is None or pd.isna(value):
        return "n/a"
    return f"{value:.{digits}f}"


def _stats(series: pd.Series) -> tuple[int, float | None, float | None]:
    """(件数, 平均, 中央値)。**打ち切りの欠損を落としてから件数を数える**。

    n を落とし忘れると母数が食い違い、平均だけ欠損 skip で計算されてしまう。
    """
    s = series.dropna()
    if s.empty:
        return (0, None, None)
    return (len(s), float(s.mean()), float(s.median()))


# --------------------------------------------------------------------------- #
# ランダムエントリー(§4.2 の比較対象)
# --------------------------------------------------------------------------- #
def partition_by_quality(codes: list[str]) -> tuple[list[str], list[str], list[str]]:
    """ユニバースを ``(使える, OHLCV 未取得, 品質不良)`` に分ける。

    品質不良の条件は「非正の価格を含む」または「sanity_check が発火する」。
    上場廃止・再上場を跨いだ系列(8303)はベンダーが負値や桁違いの Close を返し、
    **1 サンプル引かれただけでランダム母集団の平均が桁ごと壊れる**(実測で
    ランダム平均 fwd20 が 287754% になった)。ストアの値は消さず、ここで
    母集団から外すだけにする(§12.1「判定のみで除去しない」)。
    """
    usable: list[str] = []
    missing: list[str] = []
    bad: list[str] = []
    for code in codes:
        df = ohlcv_store.read_ohlcv(code)
        if df is None or df.empty:
            missing.append(code)
        elif ohlcv_store.has_non_positive_prices(df) or ohlcv_store.sanity_check(df):
            bad.append(code)
        else:
            usable.append(code)
    return (usable, missing, bad)


def resolve_populations(
    universe_path: str | None,
    signal_codes: list[str],
) -> tuple[list[str], set[str], list[str]]:
    """``(ランダム母集団, 除外する品質不良銘柄, 注記のリスト)`` を返す。

    ランダム側の母集団は**ユニバース全体**でなければならない。シグナルが出た
    銘柄だけから引くと「N字が出るような銘柄」で条件付けた比較になり、帰無分布が
    N字側に寄って有意判定が甘くなる。

    品質判定はランダム候補と**シグナル銘柄の両方**に掛ける。片側だけ落とすと、
    差を取る2つの平均が別の母集団の上で計算されてしまう。返した除外集合は
    呼び出し側が N字側の集計からも必ず外すこと。

    ユニバース CSV を読めない場合はシグナル銘柄にフォールバックするが、
    **その経路でも品質フィルタは通す**。``backend/data/*`` は git 管理外なので
    クリーンな clone では既定の CSV が無く、このフォールバックは普通に踏まれる —
    ここを素通しにすると品質不良銘柄が母集団に戻り、除外した意味が消える。
    フォールバックした旨はレポート本文に残す(黙って偏った数字を出さない)。
    """
    universe_codes: list[str] = []
    fallback_reason: str | None = None
    if not universe_path:
        fallback_reason = "`--universe` 未指定"
    else:
        try:
            rows = load_universe(universe_path, min_market_cap=0)
            universe_codes = sorted({str(r["code"]) for r in rows})
        except (FileNotFoundError, ValueError) as exc:
            fallback_reason = f"ユニバース `{universe_path}` を読めなかった: {exc}"

    # 判定は和集合に対して1回だけ(同じ Parquet を2度読まない)
    usable, _missing, bad = partition_by_quality(
        sorted(set(universe_codes) | set(signal_codes))
    )
    usable_set, bad_set = set(usable), set(bad)

    notes: list[str] = []
    population = [c for c in universe_codes if c in usable_set]
    if not population and fallback_reason is None:
        n_bad = sum(1 for c in universe_codes if c in bad_set)
        fallback_reason = (
            f"ユニバース `{universe_path}` に銘柄が無い"
            if not universe_codes
            else f"ユニバース `{universe_path}` の {len(universe_codes)} 銘柄が"
            f"すべて使えない(OHLCV 未取得 {len(universe_codes) - n_bad} /"
            f" 品質不良 {n_bad})"
        )

    if fallback_reason is not None:
        population = [c for c in signal_codes if c in usable_set]
        notes.append(
            f"ランダムエントリーの母集団に**シグナルが出た銘柄しか使えていない**"
            f"({fallback_reason})。帰無分布が N字側に寄るため、有意判定は甘い方向に偏る。"
            " `--universe` に実在する CSV を指定して取り直すこと。"
        )
    elif len(population) < len(universe_codes):
        # 一部しか使えない場合も黙って進めない。母集団が痩せるほど
        # 「シグナルが出た銘柄だけ」に近づき、帰無分布が N字側に寄る。
        n_bad = sum(1 for c in universe_codes if c in bad_set)
        n_missing = len(universe_codes) - len(population) - n_bad
        notes.append(
            f"ランダムエントリーの母集団はユニバース {len(universe_codes)} 銘柄のうち"
            f" **{len(population)} 銘柄のみ**(OHLCV 未取得 {n_missing} / 品質不良 {n_bad})。"
            " 母集団が痩せるほど帰無分布が N字側に寄り、有意判定は甘い方向に偏る。"
            " `scripts/backtest.py fetch` をユニバース全体に対して実行すること。"
        )
    if bad:
        notes.append(
            f"品質不良のため **{len(bad)} 銘柄を集計から除外**した({', '.join(bad)})。"
            " N字側・ランダム側の**両方**から外している"
            "(片側だけ外すと、差を取る2つの平均が別の母集団の上で計算される)。"
            f" 除外条件は「非正の価格を含む」または"
            f"「日次変化率の絶対値が {ohlcv_store.SANITY_MAX_DAILY_RETURN:.0%} を超える日がある」。"
            " ストアのデータは残してあるので、除外の当否は人間が確認できる(§12.1)。"
        )
    return (population, bad_set, notes)


def random_entry_returns(
    dates: list[str],
    universe_codes: list[str],
    horizon: int,
    samples_per_date: int,
    seed: int,
    entry_kind: str = PRIMARY_ENTRY,
) -> dict[str, list[float]]:
    """各シグナル日について、同じ日に同ユニバースからランダムに銘柄を引いた
    場合の同期間リターンを返す(§4.2)。

    entry ルールは N字側と同一にする(同じ weekly / next_open 解決を通す)ことで
    比較の土俵を揃える。**シグナルが出た日だけから引く**のが要点で、全営業日から
    引くと地合いの補正が効かなくなる。一方 universe_codes は逆に**ユニバース全体**
    を渡すこと(resolve_populations 参照)。日付は揃え、銘柄は揃えない。

    Returns: ``{シグナル日: [リターン, ...]}``(日付単位ブートストラップに渡せる形)
    """
    rng = random.Random(seed)
    cache: dict[str, tuple[list[str], dict[str, int], list[float], list[float]] | None] = {}

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
                    [float(v) for v in df["Open"].tolist()],
                    [float(v) for v in df["Close"].tolist()],
                )
        return cache[code]

    out: dict[str, list[float]] = {}
    for day in dates:
        picks: list[float] = []
        for _ in range(samples_per_date):
            loaded = _load(universe_codes[rng.randrange(len(universe_codes))])
            if loaded is None:
                continue
            d, index_of, opens, closes = loaded
            signal_idx = index_of.get(day)
            if signal_idx is None:
                continue
            entries = backtest.resolve_entries(d, signal_idx)
            entry_idx = entries.get(entry_kind)
            if entry_idx is None:
                continue
            j = entry_idx + horizon
            entry_px = opens[entry_idx]
            if j >= len(closes) or entry_px <= 0:
                continue  # 打ち切りは 0 で埋めずに落とす(N字側と同じ扱い)
            if not backtest.within_calendar_span(d[entry_idx], d[j], horizon):
                # index が疎な銘柄では horizon バー先が数年先になる。
                # N字側は compute_outcomes が同じ判定をしている(母集団を揃えるため、
                # 片側だけに掛けない)。シグナル日→エントリー日は resolve_entries が見る。
                continue
            picks.append(closes[j] / entry_px - 1.0)
        if picks:
            out[day] = picks
    return out


# --------------------------------------------------------------------------- #
# セクション
# --------------------------------------------------------------------------- #
def _section_summary(df: pd.DataFrame, raw: pd.DataFrame, entry: str) -> str:
    fwd60 = f"{entry}_fwd60"
    dates = df["detected_date"].dropna()
    truncated = int(df[fwd60].isna().sum()) if fwd60 in df.columns else 0
    lines = [
        "## 1. サマリ",
        "",
        f"- 期間: {dates.min()} 〜 {dates.max()}" if len(dates) else "- 期間: n/a",
        f"- 銘柄数: {df['symbol'].nunique()}",
        f"- ユニーク (symbol, break_date): {len(raw)}",
        f"- 独立イベント数(overlaps_prev 除外後): {int((~raw['overlaps_prev']).sum())}",
        f"- 集計対象: {len(df)} 件(entry={entry})",
        f"- 打ち切りで fwd60 が取れない: {truncated} 件",
    ]
    return "\n".join(lines)


def _band_label(lo: int, hi: int, is_last: bool) -> str:
    return f"{lo}-{hi}" + ("" if is_last else " (右開)")


def _band_mask(scores: pd.Series, lo: int, hi: int, is_last: bool) -> pd.Series:
    return (scores >= lo) & (scores <= hi if is_last else scores < hi)


def _section_bands(df: pd.DataFrame, entry: str) -> str:
    """スコア帯別の単調性(§7.2 — 最初に見る)。"""
    headers = [
        "band", "n", "fwd20 平均", "fwd20 中央", "fwd60 平均", "fwd60 中央",
        "excess20 平均", "mfe 平均", "mae 平均", "days_to_mfe 中央",
    ]
    rows: list[list[str]] = []
    excess = df[f"{entry}_fwd20"] - df[f"{entry}_topix_fwd20"]
    for k, (lo, hi) in enumerate(SCORE_BANDS):
        is_last = k == len(SCORE_BANDS) - 1
        mask = _band_mask(df["score"], lo, hi, is_last)
        sub = df[mask]
        n20, m20, md20 = _stats(sub[f"{entry}_fwd20"])
        _, m60, md60 = _stats(sub[f"{entry}_fwd60"])
        _, mex, _ = _stats(excess[mask])
        _, mfe, _ = _stats(sub[f"{entry}_mfe"])
        _, mae, _ = _stats(sub[f"{entry}_mae"])
        _, _, dmed = _stats(sub[f"{entry}_days_to_mfe"])
        rows.append([
            _band_label(lo, hi, is_last), str(n20),
            _pct(m20), _pct(md20), _pct(m60), _pct(md60),
            _pct(mex), _pct(mfe), _pct(mae), _num(dmed),
        ])
    note = (
        "スコアが機能しているなら fwd20/fwd60/excess20 が band を上がるにつれ単調に増える。"
        "n は各列の欠損を落とした後の件数(fwd20 基準)。"
    )
    return "## 2. スコア帯別の単調性\n\n" + _table(headers, rows) + f"\n\n{note}"


def _section_bootstrap(df: pd.DataFrame, entry: str, args: argparse.Namespace,
                       universe_codes: list[str], notes: list[str]) -> str:
    """ブロックブートストラップ(§4.2/4.3)。"""
    col = f"{entry}_fwd{PRIMARY_HORIZON}"
    usable = df[["detected_date", col]].dropna()
    if usable.empty:
        return "## 3. ブロックブートストラップ\n\nfwd20 が取れたシグナルが無いため算出しない。"
    if not universe_codes:
        return (
            "## 3. ブロックブートストラップ\n\n"
            "ランダムエントリーの母集団が空のため算出しない"
            "(比較対象のない数字は出さない §4)。"
        )

    by_date: dict[str, list[float]] = {}
    for day, value in zip(usable["detected_date"], usable[col]):
        by_date.setdefault(str(day), []).append(float(value))
    observed = sum(sum(v) for v in by_date.values()) / sum(len(v) for v in by_date.values())

    _log(f"ランダムエントリーを構築中({len(by_date)} 日 x {args.samples_per_date} 銘柄)")
    rand_by_date = random_entry_returns(
        sorted(by_date), universe_codes, PRIMARY_HORIZON,
        args.samples_per_date, args.seed, entry_kind=entry,
    )

    n_dist = backtest.block_bootstrap_means(by_date, args.bootstrap, args.seed)
    r_dist = backtest.block_bootstrap_means(rand_by_date, args.bootstrap, args.seed)
    # 有意性は「差そのもの」をブートストラップして判定する。N字の点推定を
    # ランダム分布のパーセンタイルに当てるだけでは N字側の不確実性が入らず、
    # 数十イベント規模では有意性を過大評価する。
    d_dist = backtest.paired_block_bootstrap_diffs(
        by_date, rand_by_date, args.bootstrap, args.seed
    )
    n_lo, n_hi = backtest.confidence_interval(n_dist)
    r_lo, r_hi = backtest.confidence_interval(r_dist)
    d_lo, d_hi = backtest.confidence_interval(d_dist)
    d_mean = sum(d_dist) / len(d_dist) if d_dist else float("nan")
    # 差 <= 0 の割合 = 片側の経験的 p 値(%)
    p_one_sided = backtest.percentile_of(d_dist, 0.0)

    headers = ["系列", "平均 fwd20", "95% CI 下限", "95% CI 上限", "反復数"]
    rows = [
        ["N字シグナル", _pct(observed), _pct(n_lo), _pct(n_hi), str(len(n_dist))],
        [
            "ランダムエントリー(同日付分布)",
            _pct(sum(r_dist) / len(r_dist)) if r_dist else "n/a",
            _pct(r_lo), _pct(r_hi), str(len(r_dist)),
        ],
        ["**差(N字 − ランダム)**", _pct(d_mean), _pct(d_lo), _pct(d_hi), str(len(d_dist))],
    ]
    if d_dist:
        verdict = (
            f"判定基準は**差の 95% CI 下限(2.5%点)が 0 を上回るか**。"
            f" 実測は [{_pct(d_lo)}, {_pct(d_hi)}]、差が 0 以下だった割合(片側 p)は"
            f" **{_num(p_one_sided / 100.0, 3)}**。"
            + (
                " 下限が 0 を上回っており、ランダムエントリーより優位と言える。"
                if d_lo > 0
                else " **下限が 0 を跨いでいるため「今のスコアはランダム以上とは言えない」**"
                "(p が 0.05 前後でも 2.5%点が 0 未満ならこの基準では有意としない)。"
            )
        )
    else:
        verdict = "同一日でN字とランダムの両方が揃わず、差の分布を作れなかった。"
    caution = (
        "再抽出の単位は**日付**(銘柄ではない)。同じ日に出たシグナルは互いに独立でないため、"
        "銘柄単位で引くと信頼区間が実際の 1/3 程度に狭まり有意でないものが有意に見える。"
        " 判定は上下2行の CI の重なりではなく**差の CI** で行う"
        "(2つの CI が重なっていても差が有意なことはある。逆もある)。"
    )
    note = "".join(f"\n\n> 注意: {t}" for t in notes)
    return "## 3. ブロックブートストラップ\n\n" + _table(headers, rows) + \
        f"\n\n{verdict}\n\n{caution}{note}"


def _section_factors(df: pd.DataFrame, entry: str) -> str:
    """要素別寄与(§7.3)。発火群 vs 非発火群の平均 fwd20 差。"""
    col = f"{entry}_fwd{PRIMARY_HORIZON}"
    headers = ["要素", "発火 n", "発火 平均", "非発火 n", "非発火 平均", "差"]
    rows: list[list[str]] = []
    for factor in SCORE_FACTORS:
        if factor not in df.columns:
            continue
        fired = df[df[factor] > 0]
        idle = df[df[factor] <= 0]
        nf, mf, _ = _stats(fired[col])
        ni, mi, _ = _stats(idle[col])
        diff = (mf - mi) if (mf is not None and mi is not None) else None
        rows.append([factor, str(nf), _pct(mf), str(ni), _pct(mi), _pct(diff)])
    note = (
        "減点要素(pullback_penalty / duration_penalty)は「発火 = 減点された群」。"
        " 差がほぼ 0 の要素は、スコアに入れても情報を足していない。"
    )
    return "## 4. 要素別寄与\n\n" + _table(headers, rows) + f"\n\n{note}"


def _section_lag(df: pd.DataFrame) -> str:
    """遅延感応度(§6.5 / §7.4)。"""
    headers = ["entry", "n", "平均 fwd20", "平均 fwd60"]
    rows: list[list[str]] = []
    for kind in ENTRY_ORDER:
        col20, col60 = f"{kind}_fwd20", f"{kind}_fwd60"
        if col20 not in df.columns:
            continue
        n, m20, _ = _stats(df[col20])
        _, m60, _ = _stats(df[col60])
        rows.append([kind, str(n), _pct(m20), _pct(m60)])
    note = (
        "数バー遅らせただけで優位が消えるなら、それは実運用で取れない優位。"
        " RECENCY_MAX_BARS の妥当性を判断する材料でもある。"
    )
    return "## 5. 遅延感応度\n\n" + _table(headers, rows) + f"\n\n{note}"


def _section_caveats(entry: str, include_overlaps: bool,
                     notes: list[str] | None = None) -> str:
    items = [
        "ユニバースは**現在時点の構成**を過去に遡って適用しており、緩やかな先読みが残る(§3.3)。"
        " 上場廃止・指数除外銘柄が抜けているため、生存バイアスでリターンは上振れ・分散は過小評価される。",
        "手数料・スリッページは**一切控除していない**(§6.4)。実運用の期待値はこれより低い。",
        "出口ルールは実装していない。fwd20/fwd60 は固定期間保有であり、"
        " MFE/MAE は「取れたはずの最大値」であって到達可能な損益ではない。",
        f"エントリーは `{entry}`。打ち切り(保有期間が尽きたシグナル)は 0 ではなく欠損として除外している。",
    ]
    if include_overlaps:
        items.append(
            "**`--include-overlaps` 指定のため、保有期間が重なるシグナルを含めている**。"
            " 同一の値動きを複数回数えるので独立性の仮定が壊れ、信頼区間は実際より狭くなる。"
        )
    else:
        items.append("保有期間が重なるシグナル(`overlaps_prev`)は除外済み(§5.2)。")
    if notes:
        items.extend(notes)
    return "## 6. 注記\n\n" + "\n".join(f"- {t}" for t in items)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def build_report(df: pd.DataFrame, raw: pd.DataFrame, args: argparse.Namespace,
                 universe_codes: list[str], notes: list[str] | None = None) -> str:
    entry = args.entry
    parts = [
        "# N字シグナル バックテストレポート",
        "",
        _section_summary(df, raw, entry),
        "",
        _section_bands(df, entry),
        "",
        _section_bootstrap(df, entry, args, universe_codes, notes or []),
        "",
        _section_factors(df, entry),
        "",
        _section_lag(df),
        "",
        _section_caveats(entry, args.include_overlaps, notes),
        "",
    ]
    return "\n".join(parts)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="N字バックテストの集計レポート")
    parser.add_argument("--entry", default=PRIMARY_ENTRY, choices=list(ENTRY_ORDER))
    parser.add_argument("--include-overlaps", action="store_true",
                        help="保有期間が重なるシグナルも含める(既定は除外)")
    parser.add_argument("--bootstrap", type=int, default=backtest.DEFAULT_BOOTSTRAP_ITERS)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--samples-per-date", type=int, default=DEFAULT_SAMPLES_PER_DATE)
    parser.add_argument("--out", default=None, help="レポート出力先(既定は backtest/report.md)")
    parser.add_argument(
        "--universe", default=DEFAULT_UNIVERSE,
        help="ランダムエントリーの母集団にするユニバース CSV(detect と同じものを指定する)",
    )
    args = parser.parse_args(argv)

    path = backtest_dir() / OUTCOMES_FILENAME
    if not path.exists():
        _log(f"エラー: {path} が無い。先に scripts/backtest.py outcomes を実行すること")
        return 1
    raw = pd.read_parquet(path)
    signal_codes = sorted(raw["symbol"].astype(str).unique())
    universe_codes, excluded, notes = resolve_populations(args.universe, signal_codes)
    for note in notes:
        _log(f"警告: {note}")
    if excluded:
        # N字側からも同じ銘柄を落とす。ランダム側だけ落とすと、差を取る2つの
        # 平均が別の母集団の上で計算される(ペアードブートストラップの前提が壊れる)
        before = len(raw)
        raw = raw[~raw["symbol"].astype(str).isin(excluded)].copy()
        _log(f"品質不良 {len(excluded)} 銘柄を除外: {before} → {len(raw)} 行")

    df = raw if args.include_overlaps else raw[~raw["overlaps_prev"]].copy()
    _log(f"outcomes={len(raw)} 集計対象={len(df)} entry={args.entry}")
    if df.empty:
        _log("集計対象が 0 件。--include-overlaps を試すこと")
        return 1
    _log(f"ランダムエントリーの母集団: {len(universe_codes)} 銘柄")
    report = build_report(df, raw, args, universe_codes, notes)

    out_path = Path(args.out) if args.out else backtest_dir() / REPORT_FILENAME
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report, encoding="utf-8")
    print(report)
    _log(f"出力: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
