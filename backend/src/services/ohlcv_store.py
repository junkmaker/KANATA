"""OHLCV のローカル Parquet ストア(取得・正規化・差分更新・読み出し)。

バックテストは同じ価格系列を何度も舐めるため、yfinance を都度叩かずに
``<KANATA_DATA_DIR>/ohlcv/<symbol>.parquet`` を真実源にする。

役割分担:
- ``normalize_ohlcv`` / ``merge_ohlcv`` / ``needs_full_refetch`` / ``sanity_check``
  : 純粋な変換・判定(I/O なし)
- ``read_ohlcv`` / ``write_ohlcv`` : Parquet の読み書き(atomic)
- ``fetch_ohlcv`` : yfinance 取得
- ``update_symbol`` / ``sync_symbols`` : 上記を束ねた最新化

進捗表示はしない(§10.2)。呼び出し側の scripts 層が ``on_progress`` で出す。
"""
from __future__ import annotations

import re
import time
from collections.abc import Callable
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import yfinance as yf

from .storage import data_dir
from .yfinance_provider import to_yf_symbol

OHLCV_DIRNAME = "ohlcv"
BENCHMARK_SYMBOL = "1306"        # TOPIX ETF(to_yf_symbol で 1306.T)。macro_thresholds.json の topix_etf と同一
DEFAULT_PERIOD = "5y"            # 初回一括取得の期間
REFRESH_PERIOD = "1y"            # 差分更新時に取りに行く期間(重なりを確保して整合検査する)
FETCH_SLEEP_SECONDS = 0.2        # yfinance レート制限対策(テストで 0 に patch)
OHLCV_COLUMNS = ["Open", "High", "Low", "Close", "Volume"]
OHLC_COLUMNS = ["Open", "High", "Low", "Close"]
ADJUST_TOLERANCE = 0.005         # 重なり区間の Close 乖離がこれを超えたら全期間再取得(分割の遡及調整)
SANITY_MAX_DAILY_RETURN = 0.30   # 日次リターンの絶対値がこれを超えたらベンダー由来のスケール異常を疑う
SPIKE_WINDOW_HALF_BARS = 5       # 異常バー判定に使うローリング中央値の窓半径(macro_provider._despike と同じ)
SPIKE_RATIO_FACTOR = 3.0         # 局所中央値からこの倍率以上離れたバーを異常とみなす
BACKFILL_TOLERANCE_DAYS = 30     # 保存済み履歴の起点がこれ以上新しければ period 未達とみなす
PERIOD_UNIT_DAYS = {"d": 1, "wk": 7, "mo": 30, "y": 365}   # yfinance の period 接尾辞 → 暦日数

# 銘柄コードとして許すのは英数字始まりの [英数字 . _ -] のみ。
# 銘柄コードはユーザがアップロードした CSV の code 列に由来するため、
# 検証せずにパスへ埋めると "../../foo" でストア外に書き出せてしまう。
SYMBOL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
SYMBOL_MAX_LENGTH = 32


# --------------------------------------------------------------------------- #
# パス
# --------------------------------------------------------------------------- #
def is_valid_symbol(symbol: str) -> bool:
    """ファイル名として安全な銘柄コードか判定する(純粋な判定・I/O なし)。

    パス区切り・親ディレクトリ参照・非 ASCII をすべて弾く。連続ドット("..")は
    パターン上は通るが単独で禁止する(".." は先頭が英数字でないため実際は
    パターンで落ちるが、"a..b" のような形も予防的に拒否する)。
    """
    if not isinstance(symbol, str) or not symbol or len(symbol) > SYMBOL_MAX_LENGTH:
        return False
    if ".." in symbol:
        return False
    return bool(SYMBOL_PATTERN.match(symbol))


def ohlcv_dir() -> Path:
    """``<KANATA_DATA_DIR>/ohlcv`` を mkdir して返す。"""
    d = data_dir() / OHLCV_DIRNAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def parquet_path(symbol: str) -> Path:
    """銘柄の Parquet パス。不正な銘柄コードは ValueError(パス生成の関所)。"""
    if not is_valid_symbol(symbol):
        raise ValueError(f"銘柄コードとして不正: {symbol!r}")
    return ohlcv_dir() / f"{symbol}.parquet"


# --------------------------------------------------------------------------- #
# 純粋な変換・判定
# --------------------------------------------------------------------------- #
def normalize_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    """yfinance の生 DataFrame を保存形式に正規化する(純粋な変換・I/O なし)。

    - index を tz-naive の日付 0 時に落とす(銘柄をまたいで暦日で join するため)
    - OHLCV 5 列のみに絞り float64 に揃える
    - OHLC のいずれかが NaN の行を落とす
    - index 昇順ソート、重複 index は最後を残す
    """
    if df is None or len(df) == 0:
        return pd.DataFrame(columns=OHLCV_COLUMNS, index=pd.DatetimeIndex([], name=None))

    out = df.copy()
    idx = pd.DatetimeIndex(pd.to_datetime(out.index))
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    out.index = idx.normalize()

    for col in OHLCV_COLUMNS:
        if col not in out.columns:
            out[col] = float("nan")
    out = out[OHLCV_COLUMNS].astype("float64")
    out = out.dropna(subset=OHLC_COLUMNS)
    out = out.sort_index()
    out = out[~out.index.duplicated(keep="last")]
    out.index.name = None
    return out


def merge_ohlcv(old: pd.DataFrame, new: pd.DataFrame) -> pd.DataFrame:
    """既存と新規を結合し、重複 index は new を優先して残す。"""
    if old is None or len(old) == 0:
        return new
    if new is None or len(new) == 0:
        return old
    merged = pd.concat([old, new])
    merged = merged.sort_index()
    return merged[~merged.index.duplicated(keep="last")]


def needs_full_refetch(
    old: pd.DataFrame,
    new: pd.DataFrame,
    tolerance: float = ADJUST_TOLERANCE,
) -> bool:
    """重なり区間の Close が乖離していれば True(遡及調整が起きた)。

    ``auto_adjust=True`` は株式分割が起きると過去バーを遡って再調整するため、
    素朴に新しい日付だけ追記すると同一ファイル内でスケールが混ざる。

    重なりが 0 本のとき(取得間隔が空きすぎ)も True を返す —
    継ぎ目の整合を確認できないまま繋ぐより取り直す方が安全。
    """
    if old is None or len(old) == 0 or new is None or len(new) == 0:
        return False
    common = old.index.intersection(new.index)
    if len(common) == 0:
        return True
    old_close = old.loc[common, "Close"].astype(float)
    new_close = new.loc[common, "Close"].astype(float)
    denom = old_close.abs()
    # 0 円の終値は比率を取れないので比較から外す(実データでは現れない)
    usable = denom > 0
    if not bool(usable.any()):
        return True
    rel = ((new_close - old_close).abs() / denom)[usable]
    return bool((rel > tolerance).any())


def sanity_check(
    df: pd.DataFrame,
    max_daily_return: float = SANITY_MAX_DAILY_RETURN,
) -> list[str]:
    """Close の日次変化率が閾値を超えた日を ISO 日付のリストで返す(空なら健全)。

    1306.T は yfinance 側で分割が記録されずスケール異常のスパイクを出した実績があり
    (macro_provider._despike が存在する理由)、ベンチマークは特に確認が要る。
    判定のみ行い、除去や補正はしない — 生の値を残すのが本設計の方針(§12.1)。
    """
    if df is None or len(df) < 2 or "Close" not in df.columns:
        return []
    close = df["Close"].astype(float)
    ret = close.pct_change()
    flagged = ret[ret.abs() > max_daily_return]
    return [ts.date().isoformat() for ts in flagged.index]


def anomalous_bars(
    df: pd.DataFrame,
    half_window: int = SPIKE_WINDOW_HALF_BARS,
    ratio_factor: float = SPIKE_RATIO_FACTOR,
) -> list[str]:
    """**バー単位**でスケール異常を判定し、該当日を ISO 日付のリストで返す。

    ``sanity_check`` との違いが要点。あちらは日次「リターン」を見るので、
    連続する異常バーの**境界**しか発火しない。1306 実測(2 本続けて 1/10)では
    落ちた日と**戻った翌日**が挙がり、間に挟まれた本当に壊れているバーは挙がらず、
    無傷の日が代わりに挙がる。「どの銘柄が怪しいか」を知るには十分でも、
    「どのバーを使ってはいけないか」の答えにはならない。

    ここでは ``macro_provider._despike`` と同じくローリング中央値との比率で
    バーそのものを判定する。異常が何本続いても(窓の過半を占めない限り)
    全本が挙がり、無傷のバーは挙がらない。

    **Open も見る**。ベンチマークのエントリー価格は Open なので(``benchmark_outcome``)、
    Close だけ健全な壊れた Open は Close 基準では素通りする。

    非正値は比率を取れないため無条件に異常とみなす(``has_non_positive_prices``
    は銘柄単位の真偽しか返さないので、日付が要る用途にはここを使う)。

    窓を満たせない短い系列は判定せず空を返す。判定のみで除去・補正はしない(§12.1)。
    """
    if df is None or len(df) < 2 * half_window + 1:
        return []
    cols = [c for c in ("Open", "Close") if c in df.columns]
    if not cols:
        return []

    flagged: set[int] = set()
    window = 2 * half_window + 1
    for col in cols:
        values = df[col].astype(float)
        median = values.rolling(window, center=True, min_periods=1).median()
        # 比率は大小どちらの向きでも見たいので、常に 1 以上になる形に揃える
        ratio = pd.concat(
            [values / median, median / values], axis=1
        ).max(axis=1)
        bad = (values <= 0) | (median <= 0) | (ratio >= ratio_factor)
        flagged.update(int(i) for i in range(len(df)) if bool(bad.iloc[i]))
    return [df.index[i].date().isoformat() for i in sorted(flagged)]


def period_to_days(period: str) -> int | None:
    """yfinance の period 文字列("5y" / "6mo" / "250d")を暦日数に換算する。

    "max" / "ytd" のように起点が動的なものは None を返す(スパン判定をしない)。
    未知の書式も None — 判定できないときに False 側へ倒すのではなく、
    「判定しない」ことを呼び出し側に伝える。
    """
    if not isinstance(period, str):
        return None
    text = period.strip().lower()
    for suffix, days in sorted(PERIOD_UNIT_DAYS.items(), key=lambda kv: -len(kv[0])):
        if text.endswith(suffix):
            head = text[: -len(suffix)]
            if head.isdigit():
                return int(head) * days
            return None
    return None


def needs_backfill(
    old: pd.DataFrame,
    period: str,
    today: date,
    tolerance_days: int = BACKFILL_TOLERANCE_DAYS,
) -> bool:
    """保存済み履歴の起点が period の要求より新しければ True(履歴が足りない)。

    ``needs_full_refetch`` は**重なり区間の価格**しか見ないため、一度短く保存された
    ファイルは差分更新では永久に復旧しない。REFRESH_PERIOD("1y")で取り直した
    ``recent`` は古い日付を持たないので ``merge_ohlcv`` の結果が ``old`` と一致し、
    ``"unchanged"``(=最新である)と報告されてしまう。スパンの判定はここでしか行えない。

    新規上場銘柄も True になる(上場来の全データを持っていても period には届かない)。
    呼び出し側は取り直した結果を ``old`` と比較して ``"unchanged"`` に落とすこと —
    無条件に書き込むと毎回 ``"updated"`` を返し続ける。
    """
    if old is None or len(old) == 0:
        return False
    span_days = period_to_days(period)
    if span_days is None:
        return False
    expected_start = today - timedelta(days=span_days)
    stored_start = pd.Timestamp(old.index.min()).date()
    return (stored_start - expected_start).days > tolerance_days


def has_non_positive_prices(df: pd.DataFrame) -> bool:
    """OHLC のいずれかに 0 以下の値がある行を含むか(純粋な判定・I/O なし)。

    ベンダーが上場廃止・再上場を跨いだ系列を返すと、価格が負値や桁違いの値に
    なることがある(8303 は 691 行中 245 行が負値)。sanity_check と同じく
    判定だけを行い、除去や補正はしない(§12.1)。
    """
    if df is None or len(df) == 0:
        return False
    cols = [c for c in OHLC_COLUMNS if c in df.columns]
    if not cols:
        return False
    return bool((df[cols].astype(float) <= 0).any().any())


# --------------------------------------------------------------------------- #
# I/O
# --------------------------------------------------------------------------- #
def read_ohlcv(symbol: str) -> pd.DataFrame | None:
    """Parquet を読む。ファイルなし/破損時は None(呼び出し側でスキップ or 再取得)。

    pyarrow は ``ArrowInvalid`` など pandas/標準例外の階層に属さない例外を投げるため、
    破損検知は ``except Exception`` で受ける(サイレント失敗ではなく「未取得」と等価に扱う)。

    不正な銘柄コードも None(読みは「未取得」と同義。書きと違い実害がないので
    例外にせず、ユニバース全体のループを止めない)。
    """
    if not is_valid_symbol(symbol):
        return None
    path = parquet_path(symbol)
    if not path.exists():
        return None
    try:
        return pd.read_parquet(path)
    except Exception:
        return None


def write_ohlcv(symbol: str, df: pd.DataFrame) -> None:
    """tmp に書いて replace する atomic 書込(storage.atomic_write_json と同じ形)。

    不正な銘柄コードは parquet_path が ValueError を投げる。書きはストア外への
    書き出しに直結するため、読みと違ってここは握り潰さない。
    """
    path = parquet_path(symbol)
    tmp = path.with_name(path.name + ".tmp")
    df.to_parquet(tmp, engine="pyarrow")
    tmp.replace(path)


def fetch_ohlcv(symbol: str, period: str) -> pd.DataFrame | None:
    """yfinance から日足を取得して normalize する。失敗・空なら None。"""
    if not is_valid_symbol(symbol):
        return None
    try:
        ticker = yf.Ticker(to_yf_symbol(symbol))
        df = ticker.history(period=period, interval="1d", auto_adjust=True)
    except Exception:
        return None
    if df is None or df.empty:
        return None
    out = normalize_ohlcv(df)
    if out.empty:
        return None
    return out


def update_symbol(
    symbol: str,
    period: str = DEFAULT_PERIOD,
    full: bool = False,
    today: date | None = None,
) -> str:
    """1銘柄を最新化し ``"created" | "updated" | "unchanged" | "failed"`` を返す。

    created / updated の区別は **ファイルが既にあったか**で決める。``full=True`` は
    既存を読まずに取り直すので ``old`` では判別できず、破損ファイルの取り直しも
    「新規作成」ではない。

    ``today`` は backfill 判定の基準日(既定は実行日)。テストが述語を差し替えずに
    経路そのものを踏めるように注入点を開けてある。
    """
    if not is_valid_symbol(symbol):
        return "failed"
    existed = parquet_path(symbol).exists()
    old = None if full else read_ohlcv(symbol)

    if old is None or old.empty:
        fetched = fetch_ohlcv(symbol, period)
        if fetched is None:
            return "failed"
        write_ohlcv(symbol, fetched)
        return "updated" if existed else "created"

    # 履歴が period に届いていなければ差分ではなく全期間を取り直す。
    # 差分の recent(REFRESH_PERIOD)には古い日付が無いため、この判定を
    # 飛ばすと切り詰められたファイルが "unchanged" のまま固定される。
    if needs_backfill(old, period, today or date.today()):
        fetched = fetch_ohlcv(symbol, period)
        if fetched is None:
            return "failed"
        # 新規上場銘柄は取り直しても同じ内容になる。merge ではなく置換なのは、
        # 分割の遡及調整が入った場合に old と new のスケールを混ぜないため
        # (needs_full_refetch の経路と同じ判断)。
        if fetched.equals(old):
            return "unchanged"
        write_ohlcv(symbol, fetched)
        return "updated"

    recent = fetch_ohlcv(symbol, REFRESH_PERIOD)
    if recent is None:
        return "failed"

    if needs_full_refetch(old, recent):
        fetched = fetch_ohlcv(symbol, period)
        if fetched is None:
            return "failed"
        write_ohlcv(symbol, fetched)
        return "updated"

    merged = merge_ohlcv(old, recent)
    if merged.equals(old):
        return "unchanged"
    write_ohlcv(symbol, merged)
    return "updated"


def sync_symbols(
    symbols: list[str],
    period: str = DEFAULT_PERIOD,
    full: bool = False,
    on_progress: Callable[[int, int, str], None] | None = None,
) -> dict:
    """複数銘柄を順に最新化する。

    Returns: ``{"created": n, "updated": n, "unchanged": n, "failed": [symbols]}``

    各銘柄の後に FETCH_SLEEP_SECONDS スリープする(yfinance レート制限対策)。
    ``on_progress(i, total, symbol)`` は1銘柄ごとに呼ばれる(進捗表示は呼び出し側の責務)。
    """
    total = len(symbols)
    summary: dict = {"created": 0, "updated": 0, "unchanged": 0, "failed": []}
    for i, symbol in enumerate(symbols):
        status = update_symbol(symbol, period=period, full=full)
        if status == "failed":
            summary["failed"].append(symbol)
        else:
            summary[status] += 1
        if on_progress is not None:
            on_progress(i + 1, total, symbol)
        if FETCH_SLEEP_SECONDS:
            time.sleep(FETCH_SLEEP_SECONDS)
    return summary
