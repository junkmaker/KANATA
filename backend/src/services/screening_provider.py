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
SHARES_LOOKBACK_DAYS = 548               # 発行済株式数の取得窓(yfinance の既定と同じ 18 ヶ月)
CAP_SANITY_RATIO = 10.0                  # 実測時価総額が CSV 値から何倍離れたら疑うか

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


def _fetch_shares(symbol: str) -> pd.Series | None:
    """発行済株式数の時系列を取得。失敗・空なら None(時価総額は未取得扱い)。

    ``.info`` や ``fast_info.market_cap`` を使わないのは、前者が銘柄あたり重い
    リクエストになり(docs/n_pattern_screening_spec.md §3.4)、後者が内部で
    1年分の履歴を**再取得**するため — その履歴は _fetch_daily_df で既に
    手元にある。ここは株式数だけを 1 リクエストで取り、価格は df から使う。
    """
    if not symbol.isascii():
        return None
    try:
        ticker = yf.Ticker(to_yf_symbol(symbol))
        start = pd.Timestamp.now("UTC").date() - pd.Timedelta(days=SHARES_LOOKBACK_DAYS)
        shares = ticker.get_shares_full(start=start)
    except Exception:
        return None
    if shares is None or len(shares) == 0:
        return None
    if isinstance(shares, pd.DataFrame):
        shares = shares[shares.columns[0]]
    return shares


def _closes_tail(df: pd.DataFrame) -> list[dict]:
    """サムネイル用に直近 CLOSES_TAIL 本の終値を {date, value} で返す。"""
    out: list[dict] = []
    for ts, row in df.tail(CLOSES_TAIL).iterrows():
        c = row["Close"]
        if pd.isna(c):
            continue
        out.append({"date": ts.date().isoformat(), "value": round(float(c), 4)})
    return out


def _last_bar(df: pd.DataFrame) -> tuple[str, float] | None:
    """最終日足バーの (日付ISO, 終値) を返す。NaN・空なら None。

    **最終バーだけを使う**。auto_adjust=True の df では過去バーが遡って
    調整されており実際の株価ではないため、時価総額の計算に使えない
    (最終バーはそれより後の配当・分割が無いので調整係数 1.0)。
    """
    if df is None or df.empty:
        return None
    ts = df.index[-1]
    close = df["Close"].iloc[-1]
    if pd.isna(close):
        return None
    return ts.date().isoformat(), float(close)


def _shares_as_of(shares: pd.Series | None, asof_date: str) -> int | None:
    """発行済株式数の系列から asof_date 以前の最新値を返す。無ければ None。

    系列を持つのは、上場廃止・データ停止で最終バーが古い銘柄でも
    「そのバー時点の株式数」を選べるようにするため(常に系列末尾を取ると
    バーの日付と株式数の日付が食い違う)。
    """
    if shares is None or len(shares) == 0:
        return None
    # tz-aware Timestamp と tz-naive を直接比較すると TypeError になるため、
    # 日付文字列へ落としてから比較する。
    picked = [
        v
        for ts, v in shares.items()
        if not pd.isna(v) and ts.date().isoformat() <= asof_date
    ]
    chosen = picked[-1] if picked else None
    if chosen is None or chosen <= 0:
        return None
    return int(chosen)


def _market_cap(shares: int | None, close: float | None) -> int | None:
    """発行済株式数 × 終値。どちらか欠けていれば None。"""
    if shares is None or close is None or close <= 0:
        return None
    return int(round(shares * close))


def _is_plausible_cap(cap: int, csv_cap: int | None) -> bool:
    """実測値が CSV 登録値と桁で食い違っていないか。比較対象が無ければ True。

    yfinance は分割を記録し損ねてスケールの壊れた値を返すことがある
    (macro_provider._despike と ohlcv_store.sanity_check が存在する理由)。
    桁違いの値をそのまま通すと **CSV 値より悪い嘘** になる — フォールバック表示なら
    `*` と muted 色が付くが、実測扱いの値には何の印も付かず、UI 上は確定値に見える。

    許容幅を CAP_SANITY_RATIO 倍と広く取るのは、CSV が数ヶ月前の登録値で本物の
    株価変動が入るため。ここで捕まえたいのは 10 倍・1/10 のスケール異常だけで、
    2〜3 倍の値動きを弾くのは目的ではない。
    """
    if csv_cap is None or csv_cap <= 0 or cap <= 0:
        return True
    ratio = cap / csv_cap
    return 1 / CAP_SANITY_RATIO < ratio < CAP_SANITY_RATIO


def _resolve_asof_cap(
    df: pd.DataFrame, symbol: str, csv_cap: int | None
) -> tuple[int | None, str | None]:
    """実施日時点の (時価総額, 基準日) を返す。解決できなければ (None, None)。

    例外を握るのは、ここで落ちるとスキャン全体が run_scan の外側ハンドラへ抜けるため。
    そのハンドラは atomic_write_json の**前**に status=error を立てるので、1 銘柄の
    時価総額の失敗で 900 銘柄ぶんの検出結果が丸ごと捨てられる。_fetch_shares の
    try は自身の HTTP 呼び出ししか覆っておらず、返り値の形の検査・_shares_as_of・
    _market_cap は素通しであることに注意。
    """
    bar = _last_bar(df)
    if bar is None:
        return None, None
    asof_date, close = bar
    try:
        cap = _market_cap(_shares_as_of(_fetch_shares(symbol), asof_date), close)
    except Exception:
        cap = None
    # 追加リクエストぶんのレート制限対策。**成否によらず**待つ: 失敗はレート制限で
    # 起きるのが典型で、成功時だけ待つと 429 を食っている最中ほど速く撃つことになる。
    # ここに到達した時点で symbol は ASCII(非 ASCII なら _fetch_daily_df が None を
    # 返しこの関数まで来ない)ため、リクエストは必ず 1 本出ている。
    if SCAN_SLEEP_SECONDS:
        time.sleep(SCAN_SLEEP_SECONDS)
    if cap is None or not _is_plausible_cap(cap, csv_cap):
        # 値が無い/桁が疑わしいときは日付も返さない。日付だけ残すと UI が
        # 「この日付時点の値」と言いながら CSV 値を出すことになる。
        return None, None
    return cap, asof_date


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
                    # 実施日の時価総額はヒット銘柄だけで解決する。ユニバース全体
                    # (800〜900銘柄)に追加リクエストを掛けるとスキャン時間がほぼ倍に
                    # なるうえ、表示に必要なのはヒット行だけ。
                    cap_asof, cap_date = _resolve_asof_cap(
                        df, row["code"], row["market_cap"]
                    )
                    results.append(
                        {
                            "ticker": row["code"],
                            "name": row["name"],
                            "market_cap": row["market_cap"],
                            "market_cap_asof": cap_asof,
                            "market_cap_date": cap_date,
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

        # ブレイク日の新しい順。スコア降順にしないのは、スコアに前方リターンの
        # 予測力が無いことがバックテストで確定したため(docs/n_pattern_backtest_spec.md
        # §16.2)。順位付けに期待値の含意を持たせない。
        # 同着は ticker 昇順にしたいので、sort の安定性を使って2段階で並べる
        # (タプルキー + reverse=True では ticker まで降順になってしまう)。
        results.sort(key=lambda r: r["ticker"])
        results.sort(key=lambda r: r["break_date"], reverse=True)
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
