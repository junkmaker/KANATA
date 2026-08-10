"""スクリーニングのユニバース読込・スキャン実行・結果永続化。

役割分担:
- ``load_universe`` : 銘柄マスタ CSV を読み、時価総額でフィルタ
- ``run_scan``      : 同期スキャン本体(各銘柄で detect_n_pattern と detect_ppp の
  両方を回し、パターン別 JSON に保存)
- ``start_scan_thread`` : run_scan をバックグラウンドスレッドで起動する薄いラッパ
- ``get_scan_status`` / ``load_results`` : 進捗・結果の読み出し

真実源はパターン別の JSON ファイル(``<KANATA_DATA_DIR>/n_pattern_results.json``
と ``ppp_results.json``)。1 JSON に混在させないのは、レスポンスモデルを全 optional の
ユニオンにしてしまうため。

**スキャンジョブは 1 本**。銘柄あたりの yfinance 取得を 1 回に保つため、パターンごとに
独立したスキャンにはしない(数十分の取得をもう一周払うことになる)。代償として
「N字だけスキャンし直す」ができず、常に両方走る。ジョブ状態(``_scan_state``)も
共通のまま 1 つ — 進捗 done/total は銘柄単位なのでパターンが増えても意味が変わらない。

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
from ..analysis.ppp import detect_ppp
from .storage import atomic_write_json, data_dir, now_iso
from .universe_provider import DEFAULT_UNIVERSE_CSV
from .yfinance_provider import to_yf_symbol

DEFAULT_MIN_MARKET_CAP = 10_000_000_000  # 100 億円
SCAN_SLEEP_SECONDS = 0.2                 # yfinance レート制限対策(テストで 0 に patch)

N_PATTERN = "n-pattern"
PPP_PATTERN = "ppp"
# パターン名 → 結果ファイル名。名前はエンドポイントのパス片と同じ綴りにしてある。
RESULTS_FILENAMES = {
    N_PATTERN: "n_pattern_results.json",
    PPP_PATTERN: "ppp_results.json",
}
PATTERNS = tuple(RESULTS_FILENAMES)
CLOSES_TAIL = 120                        # サムネイル用に保持する終値本数
SHARES_LOOKBACK_DAYS = 548               # 発行済株式数の取得窓(yfinance の既定と同じ 18 ヶ月)
# 実施日の時価総額を解決する対象の本数上限(_needs_asof_cap 参照)。
# n_pattern.RECENCY_MAX_BARS と同じ 10 本に揃えてある。営業日 10 本 ≒ 暦日 14 日で、
# UI の鮮度フィルタの最大値(7 日)を余裕をもって覆う。
CAP_RESOLVE_MAX_BARS = 10
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


def _results_path(pattern: str) -> Path:
    return data_dir() / RESULTS_FILENAMES[pattern]


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


def load_results(pattern: str) -> dict:
    """指定パターンの最新スキャン結果を返す。ファイルなし/破損時は未スキャン扱い。"""
    empty = {
        "generated_at": None,
        "universe_count": 0,
        "scanned_count": 0,
        "universe_id": None,
        "universe_name": None,
        "results": [],
    }
    path = _results_path(pattern)
    if not path.exists():
        return empty
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return empty


def get_scan_status() -> dict:
    with _state_lock:
        return dict(_scan_state)


def _needs_asof_cap(n_hit: dict | None, ppp_hit: dict | None) -> bool:
    """実施日の時価総額を解決する価値がある行か(＝表示されうる行か)。

    「ヒット銘柄だけ解決する」という条件は N字だけの頃はユニバースの一部にしか
    当たらなかったが、**PPP のヒット率が高いためそのままでは条件が効かない** —
    実測で N字 30%(170/563) に対し PPP は 82%(464/563) がヒットし、
    _resolve_asof_cap の呼び出しが 170 → 491 回(2.9 倍)に膨らむ。
    追加リクエストと SCAN_SLEEP_SECONDS ぶんの待ちがそのままスキャン時間に乗る。

    しかも増分の大半は無駄になる。PPP の成立が CAP_RESOLVE_MAX_BARS 以内なのは
    11%(63/563) しかなく、残りは UI の鮮度フィルタ(最大 7 日)で表示されない行。

    そこで**時価総額の解決だけ**を鮮度で絞る。**行そのものは落とさない**ので
    docs/ppp_screening_spec.md §5.2 の決定(バックエンドで打ち切らない)は保たれ、
    落ちるのは表示用フィールドだけ。その場合は CSV 登録値へのフォールバックが
    `*` 付きで出るので、値の出所は UI 上も区別できる。

    N字は detect_n_pattern が RECENCY_MAX_BARS=10 で進行中のブレイクに限っている
    ため、ヒットした時点で常に対象。
    """
    if n_hit is not None:
        return True
    return ppp_hit is not None and ppp_hit["duration_days"] <= CAP_RESOLVE_MAX_BARS


def _sort_results(rows: list[dict], date_key: str) -> None:
    """日付の新しい順に並べる(同着は ticker 昇順)。in-place。

    スコア降順にしないのは、スコアに前方リターンの予測力が無いことがバックテストで
    確定したため(docs/n_pattern_backtest_spec.md §16.2)。順位付けに期待値の含意を
    持たせない。同着は ticker 昇順にしたいので、sort の安定性を使って2段階で並べる
    (タプルキー + reverse=True では ticker まで降順になってしまう)。

    日付フィールド名はパターンで違う(break_date / established_date)ので引数に取る。
    """
    rows.sort(key=lambda r: r["ticker"])
    rows.sort(key=lambda r: r[date_key], reverse=True)


def run_scan(
    csv_path: str | None = None,
    min_market_cap: int = DEFAULT_MIN_MARKET_CAP,
    universe_id: str | None = None,
    universe_name: str | None = None,
) -> dict:
    """スキャン本体(同期)。ユニバース全銘柄を全パターンで判定して JSON に保存する。

    Returns: ``{pattern: payload}``(パターン別のペイロード)。

    銘柄ごとに ``_fetch_daily_df`` は **1 回**だけ呼び、その df で detect_n_pattern と
    detect_ppp の両方を回す。時価総額の解決も**どちらかにヒットした銘柄で 1 回だけ**
    行い、両パターンの行で使い回す(同じ銘柄に 2 回リクエストを撃たない)。

    テストからは直接同期呼び出しでき、start_scan_thread は本関数を包むだけ。
    予期せぬ例外はスレッド内 silent failure を避けるため status=error に反映する。
    """
    with _state_lock:
        _scan_state.update(status="running", done=0, total=0, started_at=now_iso(), error=None)
    try:
        universe = load_universe(csv_path, min_market_cap)
        with _state_lock:
            _scan_state["total"] = len(universe)

        n_results: list[dict] = []
        ppp_results: list[dict] = []
        for i, row in enumerate(universe):
            df = _fetch_daily_df(row["code"])
            if df is not None:
                try:
                    n_hit = detect_n_pattern(df)
                except Exception:
                    n_hit = None
                try:
                    ppp_hit = detect_ppp(df)
                except Exception:
                    ppp_hit = None
                if n_hit is not None or ppp_hit is not None:
                    # 実施日の時価総額は**表示されうる行だけ**で解決する。
                    # **両パターンで 1 回だけ**解決する(2 回撃つとレート制限を無駄に食う)。
                    if _needs_asof_cap(n_hit, ppp_hit):
                        cap_asof, cap_date = _resolve_asof_cap(
                            df, row["code"], row["market_cap"]
                        )
                    else:
                        cap_asof, cap_date = None, None
                    # base は ** 展開で複製して使う。base 自体を mutate すると
                    # 2 パターン間で辞書が共有され、片方の編集がもう片方に漏れる。
                    base = {
                        "ticker": row["code"],
                        "name": row["name"],
                        "market_cap": row["market_cap"],
                        "market_cap_asof": cap_asof,
                        "market_cap_date": cap_date,
                        "closes": _closes_tail(df),
                    }
                    if n_hit is not None:
                        n_results.append(
                            {
                                **base,
                                "score": n_hit["score"],
                                "score_detail": n_hit["score_detail"],
                                "pivots": n_hit["pivots"],
                                "break_date": n_hit["break_date"],
                            }
                        )
                    if ppp_hit is not None:
                        ppp_results.append(
                            {
                                **base,
                                "established_date": ppp_hit["established_date"],
                                "duration_days": ppp_hit["duration_days"],
                            }
                        )
            with _state_lock:
                _scan_state["done"] = i + 1
            if SCAN_SLEEP_SECONDS:
                time.sleep(SCAN_SLEEP_SECONDS)

        _sort_results(n_results, "break_date")
        _sort_results(ppp_results, "established_date")
        # メタ情報は同一スキャンの値なので両ファイルで共有する。
        meta = {
            "generated_at": now_iso(),
            "universe_count": len(universe),
            "scanned_count": len(universe),
            "universe_id": universe_id,
            "universe_name": universe_name,
        }
        payloads = {
            N_PATTERN: {**meta, "results": n_results},
            PPP_PATTERN: {**meta, "results": ppp_results},
        }
        for pattern, payload in payloads.items():
            atomic_write_json(_results_path(pattern), payload)
        with _state_lock:
            _scan_state.update(status="done")
        return payloads
    except Exception as exc:  # noqa: BLE001 - surface to status instead of dying silently
        with _state_lock:
            _scan_state.update(status="error", error=str(exc))
        return {p: load_results(p) for p in PATTERNS}


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
