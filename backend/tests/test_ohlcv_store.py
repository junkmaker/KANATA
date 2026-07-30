"""Unit tests for services.ohlcv_store: 正規化・マージ・遡及調整検知・Parquet I/O。

合成データは乱数を使わず決定的な数列で構成する。
yfinance には一切出ない(``fetch_ohlcv`` を monkeypatch で遮断する)。
"""
from __future__ import annotations

from datetime import date, timedelta

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
# anomalous_bars(バー単位のスケール異常判定)
# --------------------------------------------------------------------------- #
def test_anomalous_bars_covers_every_bar_of_a_multi_bar_run():
    """異常が 2 本続いても両方挙がり、復帰した無傷のバーは挙がらない。

    sanity_check は日次リターンを見るので、この系列では index 12(下落)と
    index 14(復帰)が挙がり、本当に壊れている index 13 が漏れる。
    """
    idx = pd.date_range("2026-03-02", periods=20, freq="B")
    closes = [375.0 + i for i in range(20)]
    closes[12] = 38.7
    closes[13] = 38.8
    df = ohlcv_store.normalize_ohlcv(_frame(closes, idx))

    bad = ohlcv_store.anomalous_bars(df)

    assert bad == ["2026-03-18", "2026-03-19"]
    # 参考: リターン基準だと境界がずれる(この差が修正の理由)
    assert ohlcv_store.sanity_check(df) == ["2026-03-18", "2026-03-20"]


def test_anomalous_bars_flags_broken_open_with_intact_close():
    """Close が健全でも Open が壊れていれば挙がる。

    ベンチマークのエントリー価格は Open(benchmark_outcome)なので、
    Close だけを見ると壊れた Open がそのまま超過リターンに入る。
    """
    idx = pd.date_range("2026-03-02", periods=20, freq="B")
    closes = [375.0 + i for i in range(20)]
    df = _frame(closes, idx)
    df.loc[df.index[12], "Open"] = 38.7
    df = ohlcv_store.normalize_ohlcv(df)

    assert ohlcv_store.sanity_check(df) == []
    assert ohlcv_store.anomalous_bars(df) == ["2026-03-18"]


def test_anomalous_bars_clean_series_empty():
    """通常の値動きでは何も挙がらない(窓中央値が一緒に動く)。"""
    idx = pd.date_range("2026-01-05", periods=40, freq="B")
    df = ohlcv_store.normalize_ohlcv(_frame([100.0 * (1.02**i) for i in range(40)], idx))

    assert ohlcv_store.anomalous_bars(df) == []


def test_anomalous_bars_short_series_not_judged():
    """窓を満たせない短い系列は判定しない(空を返す)。"""
    idx = pd.date_range("2026-01-05", periods=6, freq="B")
    df = ohlcv_store.normalize_ohlcv(_frame([100.0, 101.0, 102.0, 10.0, 10.1, 104.0], idx))

    assert ohlcv_store.anomalous_bars(df) == []


# --------------------------------------------------------------------------- #
# period スパン判定 / 非正価格判定
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "period,expected",
    [("5y", 1825), ("1y", 365), ("6mo", 180), ("5d", 5), ("2wk", 14),
     ("max", None), ("ytd", None), ("", None)],
)
def test_period_to_days(period, expected):
    """yfinance の period 文字列を暦日数に換算する。起点が動的なものは None。"""
    assert ohlcv_store.period_to_days(period) == expected


def test_needs_backfill_true_when_history_truncated():
    """1年分しか保存されていないファイルは period=5y に対して backfill が要る。

    これが 243 行問題の再現。needs_full_refetch は重なり区間の価格しか見ないため
    この状態を検知できず、差分更新では永久に復旧しない。
    """
    idx = pd.date_range("2025-07-28", periods=243, freq="B")
    old = ohlcv_store.normalize_ohlcv(_frame([100.0] * 243, idx))

    assert ohlcv_store.needs_backfill(old, "5y", date(2026, 7, 28)) is True


def test_needs_backfill_false_for_full_history():
    """5年分そろっていれば発火しない(健全な銘柄を毎回取り直させない)。"""
    idx = pd.date_range("2021-07-28", periods=1223, freq="B")
    old = ohlcv_store.normalize_ohlcv(_frame([100.0] * 1223, idx))

    assert ohlcv_store.needs_backfill(old, "5y", date(2026, 7, 28)) is False


def test_needs_backfill_false_for_unknown_period():
    """"max" のように起点が動的な period では判定しない。"""
    idx = pd.date_range("2025-07-28", periods=243, freq="B")
    old = ohlcv_store.normalize_ohlcv(_frame([100.0] * 243, idx))

    assert ohlcv_store.needs_backfill(old, "max", date(2026, 7, 28)) is False


def test_has_non_positive_prices():
    """負値・ゼロを含む系列を検知し、健全な系列では False。"""
    idx = pd.date_range("2026-01-05", periods=3, freq="B")
    clean = ohlcv_store.normalize_ohlcv(_frame([100.0, 101.0, 102.0], idx))
    dirty = ohlcv_store.normalize_ohlcv(_frame([100.0, -2.3e8, 102.0], idx))

    assert ohlcv_store.has_non_positive_prices(clean) is False
    assert ohlcv_store.has_non_positive_prices(dirty) is True


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


def test_update_symbol_backfills_truncated_history(ohlcv_env, monkeypatch):
    """1年分に切り詰められたファイルは period=5y の取得で全期間に復旧する。

    差分更新(REFRESH_PERIOD)だけでは古い日付が返らず、merge の結果が old と
    一致して "unchanged" に固定される — その回帰を防ぐ。

    needs_backfill は差し替えず ``today`` を注入する。述語をスタブすると
    「述語 → update_symbol」の配線そのものが検証されない。
    """
    long_idx = pd.date_range("2021-07-28", periods=300, freq="B")
    full = ohlcv_store.normalize_ohlcv(_frame([100.0] * 300, long_idx))
    short = full.iloc[-60:]
    ohlcv_store.write_ohlcv("7203", short)

    def fake_fetch(symbol: str, period: str):
        return full if period == "5y" else short

    monkeypatch.setattr(ohlcv_store, "fetch_ohlcv", fake_fetch)
    today = long_idx.max().date()

    assert ohlcv_store.update_symbol("7203", period="5y", today=today) == "updated"
    assert len(ohlcv_store.read_ohlcv("7203")) == 300


def test_update_symbol_takes_incremental_path_when_history_is_full(ohlcv_env, monkeypatch):
    """period を満たしている銘柄は backfill に入らず差分(REFRESH_PERIOD)で更新する。

    無条件に全期間を取り直すと毎回フルフェッチになり、差分更新の意味が消える。
    """
    idx = pd.date_range("2021-07-28", periods=1200, freq="B")
    full = ohlcv_store.normalize_ohlcv(_frame([100.0] * 1200, idx))
    ohlcv_store.write_ohlcv("7203", full)
    asked: list[str] = []

    def fake_fetch(symbol: str, period: str):
        asked.append(period)
        return full.iloc[-60:]

    monkeypatch.setattr(ohlcv_store, "fetch_ohlcv", fake_fetch)
    # 起点がちょうど 5 年前 = period を満たしている状態
    today = idx.min().date() + timedelta(days=ohlcv_store.period_to_days("5y"))

    result = ohlcv_store.update_symbol("7203", period="5y", today=today)

    assert result == "unchanged"
    assert asked == [ohlcv_store.REFRESH_PERIOD]  # 5y を取り直していない


def test_update_symbol_unchanged_when_backfill_returns_same_data(ohlcv_env, monkeypatch):
    """新規上場銘柄は period に届かなくても、取り直した結果が同じなら unchanged。

    無条件に書き込むと毎回 updated を返し続け、件数が意味を持たなくなる。
    """
    idx = pd.date_range("2025-10-16", periods=189, freq="B")
    listed = ohlcv_store.normalize_ohlcv(_frame([100.0] * 189, idx))
    ohlcv_store.write_ohlcv("429A", listed)
    monkeypatch.setattr(ohlcv_store, "fetch_ohlcv", lambda symbol, period: listed)

    result = ohlcv_store.update_symbol("429A", period="5y", today=idx.max().date())

    assert result == "unchanged"
