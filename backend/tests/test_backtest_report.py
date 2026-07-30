"""Unit tests for scripts/backtest_report.py: 母集団の品質フィルタと暦日ガード。

scripts/ はパッケージではないためファイルパスから直接ロードする
(backtest_report.py 自身が backend/ を sys.path に入れるので src.* は解決される)。
yfinance にもファイルシステムにも触らない — read_ohlcv を monkeypatch で差し替える。
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pandas as pd
import pytest

from src.services import ohlcv_store

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_report_module():
    spec = importlib.util.spec_from_file_location(
        "backtest_report", REPO_ROOT / "scripts" / "backtest_report.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def report():
    return _load_report_module()


def _frame(closes: list[float], index: pd.DatetimeIndex) -> pd.DataFrame:
    return pd.DataFrame(
        {"Open": closes, "High": closes, "Low": closes, "Close": closes,
         "Volume": [1000.0] * len(closes)},
        index=index,
    )


def test_partition_by_quality_excludes_non_positive_and_spikes(report, monkeypatch):
    """非正の価格 / sanity_check 発火の銘柄を母集団から外し、未取得と区別する。"""
    idx = pd.date_range("2026-01-05", periods=5, freq="B")
    clean = ohlcv_store.normalize_ohlcv(_frame([100.0 + i for i in range(5)], idx))
    negative = ohlcv_store.normalize_ohlcv(_frame([100.0, -2.3e8, 102.0, 103.0, 104.0], idx))
    spiked = ohlcv_store.normalize_ohlcv(_frame([100.0, 101.0, 200.0, 201.0, 202.0], idx))

    store = {"7203": clean, "8303": negative, "6632": spiked}
    monkeypatch.setattr(ohlcv_store, "read_ohlcv", lambda code: store.get(code))

    usable, missing, bad = report.partition_by_quality(["7203", "8303", "6632", "9999"])

    assert usable == ["7203"]
    assert missing == ["9999"]
    assert bad == ["8303", "6632"]


def test_resolve_populations_filters_quality_on_fallback(report, monkeypatch):
    """ユニバース CSV を読めないフォールバック経路でも品質フィルタを通す。

    backend/data/* は git 管理外なので、クリーンな clone ではこの経路が普通に
    踏まれる。素通しにすると 8303 が母集団に戻り、除外した意味が消える。
    """
    idx = pd.date_range("2026-01-05", periods=5, freq="B")
    store = {
        "7203": ohlcv_store.normalize_ohlcv(_frame([100.0 + i for i in range(5)], idx)),
        "8303": ohlcv_store.normalize_ohlcv(_frame([100.0, -2.3e8, 102.0, 103.0, 104.0], idx)),
    }
    monkeypatch.setattr(ohlcv_store, "read_ohlcv", lambda code: store.get(code))

    def missing_csv(path, min_market_cap=0):
        raise FileNotFoundError(path)

    monkeypatch.setattr(report, "load_universe", missing_csv)

    population, excluded, notes = report.resolve_populations("absent.csv", ["7203", "8303"])

    assert population == ["7203"]
    assert excluded == {"8303"}
    assert any("シグナルが出た銘柄しか使えていない" in n for n in notes)


def test_resolve_populations_note_reports_actual_population(report, monkeypatch):
    """注記の母集団数は「OHLCV がある数」ではなく**実際に使う数**。

    品質不良を引いた後の数を出さないと、読み手が母集団の痩せ具合を過小評価する。
    """
    idx = pd.date_range("2026-01-05", periods=5, freq="B")
    store = {
        "7203": ohlcv_store.normalize_ohlcv(_frame([100.0 + i for i in range(5)], idx)),
        "8303": ohlcv_store.normalize_ohlcv(_frame([100.0, -2.3e8, 102.0, 103.0, 104.0], idx)),
    }
    monkeypatch.setattr(ohlcv_store, "read_ohlcv", lambda code: store.get(code))
    monkeypatch.setattr(
        report, "load_universe",
        lambda path, min_market_cap=0: [{"code": c} for c in ("7203", "8303", "9999")],
    )

    population, excluded, notes = report.resolve_populations("u.csv", ["7203", "8303"])

    assert population == ["7203"]
    assert excluded == {"8303"}
    assert any("**1 銘柄のみ**(OHLCV 未取得 1 / 品質不良 1)" in n for n in notes)


def test_benchmark_bad_dates_flags_every_bar_of_the_run(report, monkeypatch):
    """ベンチマークにも品質検査を通す(以前は素通りしていた)。

    挙がるのは**壊れているバーそのもの**。日次リターン基準(sanity_check)だと
    異常の境界しか発火せず、2 本続いた異常の内側が漏れて、代わりに復帰した
    無傷のバーが挙がっていた。
    """
    idx = pd.date_range("2026-03-02", periods=20, freq="B")
    # 1306 実測と同じ形: 2 本だけ 1/10 のスケールになる(index 12, 13)
    closes = [375.0 + i for i in range(20)]
    closes[12] = 38.7
    closes[13] = 38.8
    monkeypatch.setattr(
        ohlcv_store, "read_ohlcv",
        lambda code: ohlcv_store.normalize_ohlcv(_frame(closes, idx)),
    )

    dates, bad = report.benchmark_bad_dates()

    assert len(dates) == 20
    assert bad == ["2026-03-18", "2026-03-19"]   # index 12, 13 の両方


def test_mask_contaminated_benchmark_covers_all_fwd_horizons(report):
    """マスクのホライズンは backtest.FWD_HORIZONS に追従する。

    固定値で持つと、ホライズンを増やしたとき新しい列だけ無警告で
    マスク対象から外れる(列が無ければ continue するのでエラーにもならない)。
    """
    bench = [d.date().isoformat() for d in pd.date_range("2026-01-05", periods=80, freq="B")]
    bad_day = bench[70]
    df = pd.DataFrame({
        # bench[10] は 60 本先、bench[50] は 20 本先が不正バーに当たる
        "weekly_date": [bench[10], bench[50]],
        "weekly_topix_fwd20": [0.01, 0.01],
        "weekly_topix_fwd60": [0.02, 0.02],
    })

    out, masked = report.mask_contaminated_benchmark(df, bench, [bad_day])

    assert out["weekly_topix_fwd20"].isna().tolist() == [False, True]
    assert out["weekly_topix_fwd60"].isna().tolist() == [True, False]
    assert masked == 2


def test_mask_contaminated_benchmark_catches_entry_rolled_onto_bad_bar(report):
    """ベンチに存在しない entry 日も、丸めた先が不正バーならマスクする。

    銘柄ごとに営業日が違うので、entry 日がベンチの日付と一致しないことがある。
    benchmark_outcome は bisect_left で直後の営業日へ丸めるため、完全一致で
    照合すると丸めの先で不正バーを踏んだケースをすり抜ける。
    """
    bench = [d.date().isoformat() for d in pd.date_range("2026-01-05", periods=40, freq="B")]
    bad_day = bench[30]
    # ベンチが休場でシグナル銘柄だけ取引された日(bench[29] と bench[30] の間)
    gap_day = (pd.Timestamp(bench[30]) - pd.Timedelta(days=1)).date().isoformat()
    assert gap_day not in bench

    df = pd.DataFrame({
        "weekly_date": [gap_day],
        "weekly_topix_fwd20": [9.7],
    })

    out, masked = report.mask_contaminated_benchmark(df, bench, [bad_day], horizons=(20,))

    assert masked == 1
    assert bool(out["weekly_topix_fwd20"].isna().iloc[0])


def test_score_bands_splits_mode_concentrated_scores(report):
    """最頻値に集中した分布でも帯が 1 本に潰れない。

    件数の分位を素朴に取ると境界がすべて最頻値に落ちて重複し、§2 が
    無情報な 1 行になる。出現値が少ないときは 1 値 1 帯に落とす。
    """
    scores = pd.Series([40] * 400 + [50] * 50 + [65] * 30 + [75] * 20)

    bands = report.score_bands(scores)

    assert bands == [(40, 50), (50, 65), (65, 75), (75, 75)]
    counts = [
        int(report._band_mask(scores, lo, hi, k == len(bands) - 1).sum())
        for k, (lo, hi) in enumerate(bands)
    ]
    assert counts == [400, 50, 30, 20]   # どの帯にも重複なく1回ずつ入る


def test_score_bands_falls_back_to_value_quantiles(report):
    """出現値が多くても件数が偏っていれば、値の分位で切り直す。"""
    scores = pd.Series([40] * 400 + list(range(41, 71)))

    bands = report.score_bands(scores)

    assert len(bands) == report.SCORE_BAND_COUNT
    assert bands[0][0] == 40 and bands[-1][1] == 70


def test_mask_contaminated_benchmark_tolerates_unresolved_entry_dates(report):
    """entry 日が欠損した行があってもマスクは動く(pandas 3.x での TypeError 回帰)。"""
    bench = [d.date().isoformat() for d in pd.date_range("2026-01-05", periods=60, freq="B")]
    bad_day = bench[40]
    df = pd.DataFrame({
        "weekly_date": [bench[20], None, bad_day],   # 2 行目は entry を解決できなかった行
        "weekly_fwd20": [0.01, 0.02, 0.03],
        "weekly_topix_fwd20": [9.7, 0.01, 9.7],
    })

    out, masked = report.mask_contaminated_benchmark(
        df, bench, [bad_day], horizons=(20,)
    )

    assert masked == 2
    assert out["weekly_topix_fwd20"].isna().tolist() == [True, False, True]


def test_mask_contaminated_benchmark_nulls_only_bench_columns(report):
    """汚染した超過リターンだけ欠損にし、生リターンと行は残す。

    行ごと落とすと §3 のブートストラップ(生 fwd20 を使う)まで母数が減る。
    horizon は窓の長さと列名(topix_fwd{h})の両方を決めるので連動している。
    """
    bench = [d.date().isoformat() for d in pd.date_range("2026-01-05", periods=40, freq="B")]
    bad_day = bench[30]
    df = pd.DataFrame({
        # 汚染されるのは窓の両端だけ: entry=bench[30](entry 価格) と
        # entry=bench[10](決済日が bench[30])。bench[15] は窓の**途中**に
        # 不正バーが来るだけなので値には入らず、無傷で残る。
        "weekly_date": [bench[10], bench[15], bad_day],
        "weekly_fwd20": [0.01, 0.02, 0.03],
        "weekly_topix_fwd20": [9.7, 0.01, 9.7],
    })

    out, masked = report.mask_contaminated_benchmark(
        df, bench, [bad_day], horizons=(20,)
    )

    assert masked == 2
    assert out["weekly_topix_fwd20"].isna().tolist() == [True, False, True]
    assert out["weekly_fwd20"].tolist() == [0.01, 0.02, 0.03]   # 生は無傷
    assert len(out) == len(df)                                   # 行は落とさない


def test_random_entry_returns_drops_samples_spanning_years(report, monkeypatch):
    """index が疎で horizon 先が数年後になるサンプルは採用しない。

    8303 は上場廃止を跨いで 20 バー先が 825 日先になり、1 サンプルで
    ランダム母集団の平均が桁ごと壊れた。
    """
    dense = pd.date_range("2026-01-05", periods=40, freq="B")
    sparse = pd.DatetimeIndex(
        list(pd.date_range("2026-01-05", periods=20, freq="B"))
        + list(pd.date_range("2028-01-05", periods=20, freq="B"))
    )
    store = {
        "7203": ohlcv_store.normalize_ohlcv(_frame([100.0] * 40, dense)),
        "8303": ohlcv_store.normalize_ohlcv(_frame([100.0] * 40, sparse)),
    }
    monkeypatch.setattr(ohlcv_store, "read_ohlcv", lambda code: store.get(code))
    day = "2026-01-05"

    dense_out = report.random_entry_returns([day], ["7203"], 20, 5, seed=0)
    sparse_out = report.random_entry_returns([day], ["8303"], 20, 5, seed=0)

    assert dense_out.get(day)          # 通常の銘柄は採用される
    assert day not in sparse_out       # 2 年先に飛ぶサンプルは全て落ちる
