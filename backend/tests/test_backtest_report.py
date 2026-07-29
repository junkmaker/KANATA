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
