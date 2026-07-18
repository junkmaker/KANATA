"""N字スクリーニングのユニバース読込・スキャン実行・結果永続化。

役割分担:
- ``load_universe`` : 銘柄マスタ CSV を読み、時価総額でフィルタ
- ``run_scan``      : 同期スキャン本体(各銘柄で detect_n_pattern → JSON 保存)
- ``start_scan_thread`` : run_scan をバックグラウンドスレッドで起動する薄いラッパ
- ``get_scan_status`` / ``load_results`` : 進捗・結果の読み出し

真実源は JSON ファイル(``<KANATA_DATA_DIR>/n_pattern_results.json``)。
ジョブ状態はメモリ(モジュールレベルの dict + Lock)のみで、プロセス再起動で idle に戻る。
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

import pandas as pd
import yfinance as yf

from ..analysis.n_pattern import detect_n_pattern
from .storage import atomic_write_json, data_dir, now_iso
from .universe_provider import DEFAULT_UNIVERSE_CSV
from .yfinance_provider import to_yf_symbol

DEFAULT_MIN_MARKET_CAP = 10_000_000_000  # 100 億円
SCAN_SLEEP_SECONDS = 0.2                 # yfinance レート制限対策(テストで 0 に patch)
RESULTS_FILENAME = "n_pattern_results.json"
CLOSES_TAIL = 120                        # サムネイル用に保持する終値本数

_state_lock = threading.Lock()
_scan_state: dict = {
    "status": "idle",  # idle | running | done | error
    "done": 0,
    "total": 0,
    "started_at": None,
    "error": None,
}
_thread: threading.Thread | None = None


def _results_path() -> Path:
    return data_dir() / RESULTS_FILENAME


def load_universe(
    csv_path: str | None = None,
    min_market_cap: int = DEFAULT_MIN_MARKET_CAP,
) -> list[dict]:
    """銘柄マスタ CSV を読み、時価総額フィルタを適用した行を返す。

    code 列のみ必須(文字列として読む — ゼロ埋め4桁や 3桁+英字コードを壊さない)。
    name 欠落は code で代用。market_cap は列欠落・空欄なら None(フィルタ非適用)、
    値があるのに数値化できない行は従来どおりスキップ。
    """
    path = Path(csv_path) if csv_path else Path(DEFAULT_UNIVERSE_CSV)
    if not path.exists():
        raise FileNotFoundError(
            f"universe CSV not found: {path} (expected column: code)"
        )
    df = pd.read_csv(path, dtype={"code": str})
    if "code" not in df.columns:
        raise ValueError("universe CSV missing column 'code'")
    has_name = "name" in df.columns
    has_cap = "market_cap" in df.columns
    rows: list[dict] = []
    for _, r in df.iterrows():
        code = "" if pd.isna(r["code"]) else str(r["code"]).strip()
        if not code:
            continue
        name = ""
        if has_name and not pd.isna(r["name"]):
            name = str(r["name"]).strip()
        cap: int | None = None
        if has_cap and not pd.isna(r["market_cap"]):
            try:
                cap = int(r["market_cap"])
            except (ValueError, TypeError):
                continue
            if cap < min_market_cap:
                continue
        rows.append({"code": code, "name": name or code, "market_cap": cap})
    return rows


def _fetch_daily_df(symbol: str) -> pd.DataFrame | None:
    """直近1年の日足 OHLCV を取得。失敗・空なら None(呼び出し側でスキップ)。"""
    if not symbol.isascii():
        return None
    try:
        ticker = yf.Ticker(to_yf_symbol(symbol))
        df = ticker.history(period="1y", interval="1d", auto_adjust=True)
    except Exception:
        return None
    if df is None or df.empty:
        return None
    return df


def _closes_tail(df: pd.DataFrame) -> list[dict]:
    """サムネイル用に直近 CLOSES_TAIL 本の終値を {date, value} で返す。"""
    out: list[dict] = []
    for ts, row in df.tail(CLOSES_TAIL).iterrows():
        c = row["Close"]
        if pd.isna(c):
            continue
        out.append({"date": ts.date().isoformat(), "value": round(float(c), 4)})
    return out


def load_results() -> dict:
    """最新スキャン結果を返す。ファイルなし/破損時は未スキャン扱い。"""
    empty = {
        "generated_at": None,
        "universe_count": 0,
        "scanned_count": 0,
        "universe_id": None,
        "universe_name": None,
        "results": [],
    }
    path = _results_path()
    if not path.exists():
        return empty
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return empty


def get_scan_status() -> dict:
    with _state_lock:
        return dict(_scan_state)


def run_scan(
    csv_path: str | None = None,
    min_market_cap: int = DEFAULT_MIN_MARKET_CAP,
    universe_id: str | None = None,
    universe_name: str | None = None,
) -> dict:
    """スキャン本体(同期)。ユニバース全銘柄を判定して JSON に保存する。

    テストからは直接同期呼び出しでき、start_scan_thread は本関数を包むだけ。
    予期せぬ例外はスレッド内 silent failure を避けるため status=error に反映する。
    """
    with _state_lock:
        _scan_state.update(status="running", done=0, total=0, started_at=now_iso(), error=None)
    try:
        universe = load_universe(csv_path, min_market_cap)
        with _state_lock:
            _scan_state["total"] = len(universe)

        results: list[dict] = []
        for i, row in enumerate(universe):
            df = _fetch_daily_df(row["code"])
            if df is not None:
                try:
                    detected = detect_n_pattern(df)
                except Exception:
                    detected = None
                if detected is not None:
                    results.append(
                        {
                            "ticker": row["code"],
                            "name": row["name"],
                            "market_cap": row["market_cap"],
                            "score": detected["score"],
                            "score_detail": detected["score_detail"],
                            "pivots": detected["pivots"],
                            "break_date": detected["break_date"],
                            "closes": _closes_tail(df),
                        }
                    )
            with _state_lock:
                _scan_state["done"] = i + 1
            if SCAN_SLEEP_SECONDS:
                time.sleep(SCAN_SLEEP_SECONDS)

        results.sort(key=lambda r: r["score"], reverse=True)
        payload = {
            "generated_at": now_iso(),
            "universe_count": len(universe),
            "scanned_count": len(universe),
            "universe_id": universe_id,
            "universe_name": universe_name,
            "results": results,
        }
        atomic_write_json(_results_path(), payload)
        with _state_lock:
            _scan_state.update(status="done")
        return payload
    except Exception as exc:  # noqa: BLE001 - surface to status instead of dying silently
        with _state_lock:
            _scan_state.update(status="error", error=str(exc))
        return load_results()


def start_scan_thread(
    csv_path: str | None = None,
    min_market_cap: int = DEFAULT_MIN_MARKET_CAP,
    universe_id: str | None = None,
    universe_name: str | None = None,
) -> bool:
    """スキャンをバックグラウンドで起動。既に実行中なら False。"""
    global _thread
    with _state_lock:
        if _scan_state["status"] == "running":
            return False
        _scan_state.update(status="running", done=0, total=0, started_at=now_iso(), error=None)

    def _worker() -> None:
        run_scan(csv_path, min_market_cap, universe_id, universe_name)

    _thread = threading.Thread(target=_worker, daemon=True)
    _thread.start()
    return True


def reset_state() -> None:
    """テスト用: ジョブ状態を idle に戻す。"""
    with _state_lock:
        _scan_state.update(status="idle", done=0, total=0, started_at=None, error=None)
