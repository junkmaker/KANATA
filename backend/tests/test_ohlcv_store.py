"""Unit tests for services.ohlcv_store: 正規化・マージ・遡及調整検知・Parquet I/O。

合成データは乱数を使わず決定的な数列で構成する。
yfinance には一切出ない(``fetch_ohlcv`` を monkeypatch で遮断する)。
"""
from __future__ import annotations

import pandas as pd
import pytest

from src.services import ohlcv_store


@pytest.fixture
def ohlcv_env(tmp_path, monkeypatch):
    """KANATA_DATA_DIR を tmp に向け、レート制限スリープを無効化する。"""
    monkeypatch.setenv("KANATA_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(ohlcv_store, "FETCH_SLEEP_SECONDS", 0)
    return tmp_path


def _frame(closes: list[float], index: pd.DatetimeIndex) -> pd.DataFrame:
    """OHLCV 5 列の素直なフレーム(High/Low は Close と同値)。"""
    return pd.DataFrame(
        {
            "Open": closes,
            "High": closes,
            "Low": closes,
            "Close": closes,
            "Volume": [1000.0] * len(closes),
        },
        index=index,
    )


# --------------------------------------------------------------------------- #
# normalize / merge
# --------------------------------------------------------------------------- #
def test_normalize_drops_timezone_and_nan_rows():
    """tz-aware index は tz-naive の日付 0 時になり、OHLC が NaN の行は落ちる。"""
    idx = pd.date_range("2026-01-05 09:00", periods=3, freq="D", tz="Asia/Tokyo")
    df = _frame([100.0, 101.0, 102.0], idx)
    df.loc[df.index[1], "Close"] = float("nan")

    out = ohlcv_store.normalize_ohlcv(df)

    assert out.index.tz is None
    assert len(out) == 2
    assert [ts.isoformat() for ts in out.index] == [
        "2026-01-05T00:00:00",
        "2026-01-07T00:00:00",
    ]


def test_normalize_sorts_and_dedups_index():
    """逆順・重複 index は昇順に並び、重複は最後の行が残る。"""
    idx = pd.DatetimeIndex(["2026-01-07", "2026-01-05", "2026-01-05"])
    df = _frame([300.0, 100.0, 111.0], idx)

    out = ohlcv_store.normalize_ohlcv(df)

    assert len(out) == 2
    assert out.index.is_monotonic_increasing
    assert out.loc[pd.Timestamp("2026-01-05"), "Close"] == 111.0


def test_merge_prefers_new_on_overlap():
    """重なった日付は new 側の値を採用する。"""
    idx_old = pd.DatetimeIndex(["2026-01-05", "2026-01-06"])
    idx_new = pd.DatetimeIndex(["2026-01-06", "2026-01-07"])
    old = ohlcv_store.normalize_ohlcv(_frame([100.0, 101.0], idx_old))
    new = ohlcv_store.normalize_ohlcv(_frame([555.0, 102.0], idx_new))

    merged = ohlcv_store.merge_ohlcv(old, new)

    assert len(merged) == 3
    assert merged.loc[pd.Timestamp("2026-01-06"), "Close"] == 555.0


# --------------------------------------------------------------------------- #
# needs_full_refetch
# --------------------------------------------------------------------------- #
def test_needs_full_refetch_on_price_divergence():
    """重なり区間の Close が 1.5 倍になっていれば遡及調整とみなす。"""
    idx = pd.DatetimeIndex(["2026-01-05", "2026-01-06", "2026-01-07"])
    old = ohlcv_store.normalize_ohlcv(_frame([100.0, 101.0, 102.0], idx))
    new = ohlcv_store.normalize_ohlcv(_frame([150.0, 151.5, 153.0], idx))

    assert ohlcv_store.needs_full_refetch(old, new) is True


def test_needs_full_refetch_false_when_consistent():
    """重なり区間の値が一致していれば差分追記でよい。"""
    idx = pd.DatetimeIndex(["2026-01-05", "2026-01-06", "2026-01-07"])
    old = ohlcv_store.normalize_ohlcv(_frame([100.0, 101.0, 102.0], idx))
    new = ohlcv_store.normalize_ohlcv(_frame([101.0, 102.0], idx[1:]))

    assert ohlcv_store.needs_full_refetch(old, new) is False


def test_needs_full_refetch_true_when_no_overlap():
    """重なりが 0 本なら継ぎ目を検査できないので取り直す。"""
    old = ohlcv_store.normalize_ohlcv(
        _frame([100.0, 101.0], pd.DatetimeIndex(["2026-01-05", "2026-01-06"]))
    )
    new = ohlcv_store.normalize_ohlcv(
        _frame([110.0, 111.0], pd.DatetimeIndex(["2026-03-05", "2026-03-06"]))
    )

    assert ohlcv_store.needs_full_refetch(old, new) is True


# --------------------------------------------------------------------------- #
# sanity_check
# --------------------------------------------------------------------------- #
def test_sanity_check_flags_spike():
    """+40% の 1 日はスケール異常としてその日付が返る。"""
    idx = pd.DatetimeIndex(["2026-01-05", "2026-01-06", "2026-01-07"])
    df = ohlcv_store.normalize_ohlcv(_frame([100.0, 140.0, 141.0], idx))

    assert ohlcv_store.sanity_check(df) == ["2026-01-06"]


def test_sanity_check_clean_series_empty():
    """緩やかな系列では何もフラグされない。"""
    idx = pd.date_range("2026-01-05", periods=10, freq="B")
    df = ohlcv_store.normalize_ohlcv(
        _frame([100.0 + i for i in range(10)], idx)
    )

    assert ohlcv_store.sanity_check(df) == []


# --------------------------------------------------------------------------- #
# I/O
# --------------------------------------------------------------------------- #
def test_write_read_roundtrip(ohlcv_env):
    """書いて読んだ結果が index・列・値まで一致する。"""
    idx = pd.date_range("2026-01-05", periods=5, freq="B")
    df = ohlcv_store.normalize_ohlcv(_frame([100.0 + i for i in range(5)], idx))

    ohlcv_store.write_ohlcv("7203", df)
    loaded = ohlcv_store.read_ohlcv("7203")

    assert loaded is not None
    # Parquet は index の freq を保持しない(実データは営業日の欠落で freq=None になる)
    pd.testing.assert_frame_equal(loaded, df, check_freq=False)


def test_read_missing_returns_none(ohlcv_env):
    """未取得の銘柄は None(例外にしない)。"""
    assert ohlcv_store.read_ohlcv("9999") is None


def test_read_corrupt_returns_none(ohlcv_env):
    """壊れた Parquet は None を返し、再取得可能な状態にする。"""
    ohlcv_store.parquet_path("7203").write_bytes(b"not a parquet file")

    assert ohlcv_store.read_ohlcv("7203") is None


# --------------------------------------------------------------------------- #
# 銘柄コード検証(パストラバーサル)
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "symbol",
    ["../../evil", "..\\evil", "a/b", "a\\b", "..", "", "７２０３", "x" * 33],
)
def test_parquet_path_rejects_unsafe_symbols(ohlcv_env, symbol):
    """CSV 由来の不正な code をパスに埋めさせない(ストア外への書き出し防止)。"""
    assert ohlcv_store.is_valid_symbol(symbol) is False
    with pytest.raises(ValueError):
        ohlcv_store.parquet_path(symbol)


def test_parquet_path_accepts_normal_symbols(ohlcv_env):
    """通常の銘柄コード(JP 4桁・米国ティッカー・ドット付き)は通す。"""
    for symbol in ["7203", "AAPL", "BRK.B", "1306"]:
        assert ohlcv_store.is_valid_symbol(symbol) is True
        assert ohlcv_store.parquet_path(symbol).name == f"{symbol}.parquet"


def test_unsafe_symbol_never_writes_outside_store(ohlcv_env, monkeypatch):
    """不正な code は failed になり、ストア外にファイルを作らない。"""
    idx = pd.date_range("2026-01-05", periods=5, freq="B")
    fixed = ohlcv_store.normalize_ohlcv(_frame([100.0 + i for i in range(5)], idx))
    monkeypatch.setattr(ohlcv_store, "fetch_ohlcv", lambda symbol, period: fixed)

    summary = ohlcv_store.sync_symbols(["../../evil", "7203"])

    assert summary["failed"] == ["../../evil"]
    assert summary["created"] == 1
    assert not (ohlcv_env.parent / "evil.parquet").exists()
    assert ohlcv_store.read_ohlcv("../../evil") is None


# --------------------------------------------------------------------------- #
# update_symbol の状態遷移
# --------------------------------------------------------------------------- #
def test_update_symbol_created_then_unchanged(ohlcv_env, monkeypatch):
    """初回は created、同じデータの2回目は unchanged(yfinance には出ない)。"""
    idx = pd.date_range("2026-01-05", periods=5, freq="B")
    fixed = ohlcv_store.normalize_ohlcv(_frame([100.0 + i for i in range(5)], idx))
    monkeypatch.setattr(ohlcv_store, "fetch_ohlcv", lambda symbol, period: fixed)

    assert ohlcv_store.update_symbol("7203") == "created"
    assert ohlcv_store.update_symbol("7203") == "unchanged"


def test_update_symbol_full_reports_updated_when_file_existed(ohlcv_env, monkeypatch):
    """--full での取り直しは、既存ファイルがあれば created ではなく updated。"""
    idx = pd.date_range("2026-01-05", periods=5, freq="B")
    fixed = ohlcv_store.normalize_ohlcv(_frame([100.0 + i for i in range(5)], idx))
    monkeypatch.setattr(ohlcv_store, "fetch_ohlcv", lambda symbol, period: fixed)

    assert ohlcv_store.update_symbol("7203", full=True) == "created"
    assert ohlcv_store.update_symbol("7203", full=True) == "updated"


def test_update_symbol_corrupt_file_reports_updated(ohlcv_env, monkeypatch):
    """破損ファイルの取り直しも「新規作成」ではない(実態を誤報告しない)。"""
    idx = pd.date_range("2026-01-05", periods=5, freq="B")
    fixed = ohlcv_store.normalize_ohlcv(_frame([100.0 + i for i in range(5)], idx))
    monkeypatch.setattr(ohlcv_store, "fetch_ohlcv", lambda symbol, period: fixed)
    ohlcv_store.parquet_path("7203").write_bytes(b"not a parquet file")

    assert ohlcv_store.update_symbol("7203") == "updated"


def test_sync_symbols_collects_failures(ohlcv_env, monkeypatch):
    """取得に失敗した銘柄はスキップして続行し、failed に積まれる。"""
    idx = pd.date_range("2026-01-05", periods=5, freq="B")
    fixed = ohlcv_store.normalize_ohlcv(_frame([100.0 + i for i in range(5)], idx))

    def fake_fetch(symbol: str, period: str):
        return None if symbol == "9999" else fixed

    monkeypatch.setattr(ohlcv_store, "fetch_ohlcv", fake_fetch)

    summary = ohlcv_store.sync_symbols(["7203", "9999", "6758"])

    assert summary["created"] == 2
    assert summary["failed"] == ["9999"]
