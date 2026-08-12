"""Unit tests for scripts/candle_backtest.py: 母集団の単一決定点と売買代金ランキング。

scripts/ はパッケージではないためファイルパスから直接ロードする
(candle_backtest.py 自身が backend/ を sys.path に入れるので src.* は解決される)。
yfinance にもファイルシステムにも触らない — read_ohlcv を monkeypatch で差し替える。
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from src.services import ohlcv_store

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_module():
    spec = importlib.util.spec_from_file_location(
        "candle_backtest", REPO_ROOT / "scripts" / "candle_backtest.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def cb():
    return _load_module()


def _frame(n: int = 80, close: float = 100.0, volume: float = 1000.0, start="2024-01-01"):
    idx = pd.bdate_range(start, periods=n)
    return pd.DataFrame(
        {
            "Open": np.full(n, close),
            "High": np.full(n, close * 1.01),
            "Low": np.full(n, close * 0.99),
            "Close": np.full(n, close),
            "Volume": np.full(n, volume),
        },
        index=idx,
    )


@pytest.fixture
def store(cb, monkeypatch):
    """コード → DataFrame の辞書でストアを差し替える。キャッシュも毎回空にする。"""
    data: dict[str, pd.DataFrame | None] = {}
    cb._STORE_CACHE.clear()
    monkeypatch.setattr(ohlcv_store, "read_ohlcv", lambda code: data.get(code))
    yield data
    cb._STORE_CACHE.clear()


# --- eligible_codes: 母集団の単一決定点 ---------------------------------------

def test_eligible_codes_splits_missing_bad_and_usable(cb, store):
    store["1111"] = _frame()                       # 健全
    store["2222"] = _frame(n=10)                   # バー不足
    store["3333"] = None                           # ストアに無い
    bad = _frame()
    bad.loc[bad.index[5], "Close"] = -1.0          # 非正の価格
    store["4444"] = bad
    spike = _frame()
    spike.loc[spike.index[7], "Close"] = 1000.0    # sanity_check が発火
    store["5555"] = spike

    usable, missing, flagged = cb.eligible_codes(["1111", "2222", "3333", "4444", "5555"])

    assert usable == ["1111"]
    assert set(missing) == {"2222", "3333"}
    assert set(flagged) == {"4444", "5555"}


def test_signal_and_random_populations_are_identical(cb, store, monkeypatch):
    """旧 §7 の回帰テスト。

    シグナル側だけに品質フィルタが掛かり、ランダム側の母集団だけが広い状態に
    戻っていないことを、**main が両者へ渡した codes を捕まえて**確認する。
    8303 のような系列が 1 サンプル引かれるだけで帰無平均が桁ごと壊れるため、
    ここが崩れると表全体が無言で壊れる。
    """
    store["1111"] = _frame()
    store["2222"] = _frame()
    broken = _frame()
    broken.loc[broken.index[3], "Close"] = -5.0
    store["9999"] = broken

    monkeypatch.setattr(
        cb, "load_universe",
        lambda path, min_market_cap=0: [{"code": c} for c in ("1111", "2222", "9999")],
    )

    seen: dict[str, list[str]] = {}
    real_collect, real_random = cb.collect_signals, cb.random_returns

    def spy_collect(codes, *a, **kw):
        seen["signal"] = list(codes)
        return real_collect(codes, *a, **kw)

    def spy_random(dates, codes, *a, **kw):
        seen["random"] = list(codes)
        return real_random(dates, codes, *a, **kw)

    monkeypatch.setattr(cb, "collect_signals", spy_collect)
    monkeypatch.setattr(cb, "random_returns", spy_random)

    cb.main(["--patterns", "doji", "--horizons", "5"])

    assert seen["signal"] == seen["random"]
    assert "9999" not in seen["signal"]


# --- select_by_turnover: 規模の指標 -------------------------------------------

def test_select_by_turnover_picks_top_n(cb, store):
    for code, vol in [("1111", 100.0), ("2222", 300.0), ("3333", 200.0)]:
        store[code] = _frame(n=80, volume=vol)
    asof = _frame(n=80).index[-1].date().isoformat()

    assert cb.select_by_turnover(list(store), top=2, asof=asof, window=60) == ["2222", "3333"]


def test_select_by_turnover_ignores_the_asof_day_itself(cb, store):
    """shift(1) の回帰テスト。

    当日の売買代金でその日の母集団を決めると「その日たまたま出来高が膨らんだ銘柄」を
    後知恵で選ぶことになる。最終日だけ出来高を跳ねさせても順位は動いてはいけない。
    """
    store["1111"] = _frame(n=80, volume=100.0)
    store["2222"] = _frame(n=80, volume=50.0)
    idx = store["2222"].index
    store["2222"].loc[idx[-1], "Volume"] = 10_000_000.0   # 判定日だけ急増
    asof = idx[-1].date().isoformat()

    assert cb.select_by_turnover(list(store), top=1, asof=asof, window=60) == ["1111"]


def test_select_by_turnover_rejects_asof_without_enough_history(cb, store):
    """窓が埋まらない日付を黙って通さない（前期先頭 40 営業日の問題）。"""
    for code in ("1111", "2222"):
        store[code] = _frame(n=80)
    asof = store["1111"].index[5].date().isoformat()

    with pytest.raises(ValueError, match="順位が付くのは"):
        cb.select_by_turnover(list(store), top=2, asof=asof, window=60)


def test_resolve_codes_filters_quality_before_ranking(cb, store, monkeypatch):
    """品質フィルタはランキングの前（§1.6）。

    8303 は負値を含むため ``Close * Volume`` の順位そのものが無意味で、
    後に掛けると母集団が top に満たなくなる。ここでは不良銘柄が最大の売買代金を
    持つ状況を作り、それでも top 2 が健全銘柄で埋まることを確認する。
    """
    store["1111"] = _frame(n=80, volume=100.0)
    store["2222"] = _frame(n=80, volume=200.0)
    bad = _frame(n=80, volume=999_999.0)
    bad.loc[bad.index[3], "Close"] = -1.0
    store["9999"] = bad

    monkeypatch.setattr(
        cb, "load_universe",
        lambda path, min_market_cap=0: [{"code": c} for c in ("1111", "2222", "9999")],
    )
    args = cb.argparse.Namespace(
        universe="dummy.csv", turnover_top=2, turnover_window=60,
        rank_asof=store["1111"].index[-1].date().isoformat(), start=None,
    )

    assert cb.resolve_codes(args) == ["1111", "2222"]


# --- compare: CI 上限 ----------------------------------------------------------

def test_compare_reports_absolute_ci_bound(cb):
    """``bound`` は max(|lo|, |hi|)。「効果があるとしてもこの幅以下」を読む列。"""
    rng = np.random.default_rng(0)
    dates = [f"2024-01-{d:02d}" for d in range(1, 26)]
    sig = pd.DataFrame(
        {
            "signal_date": np.repeat(dates, 4),
            "fwd5": rng.normal(0.0, 0.01, size=len(dates) * 4),
        }
    )
    rnd = {d: list(rng.normal(0.0, 0.01, size=6)) for d in dates}

    res = cb.compare(sig, rnd, 5)

    assert res is not None
    assert res["bound"] == pytest.approx(max(abs(res["lo"]), abs(res["hi"])))
    assert res["bound"] >= 0
