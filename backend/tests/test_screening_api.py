"""Integration tests for the N-pattern screening API.

yfinance は ``_fetch_daily_df`` / ``_fetch_shares`` の patch で完全に遮断し、KANATA_DATA_DIR を tmp に
向けて結果 JSON を隔離する。スキャン完了は run_scan の同期呼び出しで検証する
(start_scan_thread は薄いラッパのため、ルート経由の 202/409 のみ確認)。
"""
from __future__ import annotations

import pandas as pd
import pytest

from src.services import screening_provider


# --------------------------------------------------------------------------- #
# Synthetic data helpers
# --------------------------------------------------------------------------- #
def _path(waypoints, total):
    vals: list[float] = []
    for k in range(len(waypoints) - 1):
        (i0, p0), (i1, p1) = waypoints[k], waypoints[k + 1]
        seg = [p0 + (p1 - p0) * j / (i1 - i0) for j in range(i1 - i0 + 1)]
        vals.extend(seg if k == 0 else seg[1:])
    while len(vals) < total:
        vals.append(waypoints[-1][1])
    return vals[:total]


def _df(closes, volume=None):
    n = len(closes)
    idx = pd.date_range("2026-01-01", periods=n, freq="B")
    vol = volume if volume is not None else [1000.0] * n
    return pd.DataFrame(
        {"Open": closes, "High": closes, "Low": closes, "Close": closes, "Volume": vol},
        index=idx,
    )


def _n_df(volume_spike=False, d_index=34):
    # D は末尾付近に置き、直近性フィルタ(RECENCY_MAX_BARS=10)を満たす。
    # d_index をずらすと break_date が変わる — 並び順の検証に使う。
    closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (d_index, 125.0)], total=40)
    vol = [1000.0] * 40
    if volume_spike:
        vol[d_index] = 1600.0
    return _df(closes, vol)


def _flat_df():
    return _df([100.0 + i * 0.5 for i in range(40)])  # 単調上昇 → 非該当


@pytest.fixture
def screening_env(tmp_path, monkeypatch):
    monkeypatch.setenv("KANATA_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(screening_provider, "SCAN_SLEEP_SECONDS", 0)
    # 株式数取得も既定で遮断する。ヒット行の解決で走る経路なので、塞がないと
    # 時価総額に関心のないテストまで実ネットワークを叩く。必要なテストは
    # 各自 monkeypatch.setattr で上書きする(後勝ち)。
    monkeypatch.setattr(screening_provider, "_fetch_shares", lambda code: None)
    screening_provider.reset_state()
    yield tmp_path
    screening_provider.reset_state()


def _write_universe(tmp_path, rows):
    path = tmp_path / "uni.csv"
    lines = ["code,name,market_cap"] + [f"{c},{n},{m}" for c, n, m in rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return str(path)


# --------------------------------------------------------------------------- #
# GET (cache) behaviour
# --------------------------------------------------------------------------- #
def test_get_before_scan_returns_empty(client, screening_env):
    resp = client.get("/api/screening/n-pattern")
    assert resp.status_code == 200
    body = resp.json()
    assert body["generated_at"] is None
    assert body["results"] == []


def test_post_starts_scan_and_status(client, screening_env, monkeypatch):
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: None)
    resp = client.post("/api/screening/n-pattern/scan")
    assert resp.status_code == 202
    assert resp.json()["status"] == "started"
    if screening_provider._thread:
        screening_provider._thread.join(timeout=5)
    status = client.get("/api/screening/n-pattern/status").json()
    assert status["status"] in ("done", "running")


def test_double_post_returns_409(client, screening_env):
    with screening_provider._state_lock:
        screening_provider._scan_state["status"] = "running"
    resp = client.post("/api/screening/n-pattern/scan")
    assert resp.status_code == 409
    assert "already running" in resp.json()["detail"]


# --------------------------------------------------------------------------- #
# run_scan (synchronous) — 並び順とユニバースのフィルタ
# --------------------------------------------------------------------------- #
def test_scan_sorts_by_break_date_desc(client, screening_env, monkeypatch):
    """並びは **ブレイク日の新しい順**（スコア降順ではない）。

    スコアに前方リターンの予測力が無いことがバックテストで確定したため、
    順位付けに期待値の含意を持たせない（docs/n_pattern_backtest_spec.md §16.2）。
    """
    csv_path = _write_universe(
        screening_env,
        [
            ("7203", "Old", 5_000_000_000_000),     # 古いブレイク + 出来高急増(高スコア)
            ("6758", "New", 4_000_000_000_000),     # 新しいブレイク + 急増なし(低スコア)
            ("9984", "Broken", 3_000_000_000_000),  # fetch 失敗 → スキップ
            ("1301", "Tiny", 9_000_000_000),        # < 100 億 → fetch 前に除外
        ],
    )

    def fake_fetch(code):
        if code == "7203":
            return _n_df(volume_spike=True, d_index=30)   # 古い
        if code == "6758":
            return _n_df(volume_spike=False, d_index=34)  # 新しい
        if code == "9984":
            return None
        raise AssertionError(f"unexpected fetch for {code}")  # 1301 は除外されているはず

    monkeypatch.setattr(screening_provider, "_fetch_daily_df", fake_fetch)

    payload = screening_provider.run_scan(csv_path=csv_path)
    assert payload["universe_count"] == 3  # 1301 は時価総額で除外
    results = payload["results"]

    # 新しいブレイクが先。**スコアの高い 7203 が後ろに来る**のがこのテストの要点。
    assert [r["ticker"] for r in results] == ["6758", "7203"]
    assert results[0]["break_date"] > results[1]["break_date"]
    assert results[0]["score"] < results[1]["score"]

    # GET はキャッシュ済み結果をそのまま返す（min_score による絞り込みは廃止）
    body = client.get("/api/screening/n-pattern").json()
    assert [r["ticker"] for r in body["results"]] == ["6758", "7203"]


def test_scan_breaks_ties_by_ticker_ascending(client, screening_env, monkeypatch):
    """ブレイク日が同着なら ticker 昇順。日ごとの並びを決定的にするため。"""
    csv_path = _write_universe(
        screening_env,
        [("7203", "A", 5_000_000_000_000), ("6758", "B", 4_000_000_000_000)],
    )
    monkeypatch.setattr(
        screening_provider, "_fetch_daily_df", lambda code: _n_df(d_index=34)
    )

    results = screening_provider.run_scan(csv_path=csv_path)["results"]

    assert len(results) == 2
    assert results[0]["break_date"] == results[1]["break_date"]
    assert [r["ticker"] for r in results] == ["6758", "7203"]


def test_min_score_query_is_ignored(client, screening_env, monkeypatch):
    """廃止した min_score を付けても結果が変わらない（絞り込みは表示側の責務）。"""
    csv_path = _write_universe(screening_env, [("7203", "A", 5_000_000_000_000)])
    monkeypatch.setattr(
        screening_provider, "_fetch_daily_df", lambda code: _n_df(d_index=34)
    )
    screening_provider.run_scan(csv_path=csv_path)

    plain = client.get("/api/screening/n-pattern").json()
    with_query = client.get("/api/screening/n-pattern?min_score=999").json()

    assert plain["results"] == with_query["results"]
    assert len(plain["results"]) == 1
    # score / score_detail はレスポンスに残す（再検証の経路を潰さないため）
    assert "score" in plain["results"][0]
    assert "score_detail" in plain["results"][0]


def test_scan_missing_csv_sets_error_status(client, screening_env):
    payload = screening_provider.run_scan(csv_path=str(screening_env / "does-not-exist.csv"))
    assert payload["results"] == []
    assert screening_provider.get_scan_status()["status"] == "error"


def test_scan_all_fetch_fail_completes_empty(client, screening_env, monkeypatch):
    csv_path = _write_universe(screening_env, [("7203", "A", 5_000_000_000_000)])
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: None)
    payload = screening_provider.run_scan(csv_path=csv_path)
    assert payload["results"] == []
    assert screening_provider.get_scan_status()["status"] == "done"


# --------------------------------------------------------------------------- #
# Universe selection (registered universes)
# --------------------------------------------------------------------------- #
def test_scan_with_registered_universe(client, screening_env, monkeypatch):
    # 登録済みユニバースを universe_id 指定でスキャン → payload に反映される。
    # スキャン実行中の削除は無害: csv_path はスレッド起動前に解決済みで、
    # load_universe はスキャン冒頭の一回しか読まない。
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: None)
    created = client.post(
        "/api/screening/universes",
        json={"name": "Custom", "csv_text": "code\n7203\n6758\n"},
    ).json()

    resp = client.post("/api/screening/n-pattern/scan", json={"universe_id": created["id"]})
    assert resp.status_code == 202
    if screening_provider._thread:
        screening_provider._thread.join(timeout=5)

    body = client.get("/api/screening/n-pattern").json()
    assert body["universe_id"] == created["id"]
    assert body["universe_name"] == "Custom"
    assert body["universe_count"] == 2


def test_scan_without_market_cap_column(client, screening_env, monkeypatch):
    # market_cap 列の無い CSV → フィルタ非適用で全銘柄スキャン、market_cap は None。
    csv_path = screening_env / "no_cap.csv"
    csv_path.write_text("code,name\n7203,Toyota\n", encoding="utf-8")
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: _n_df())

    payload = screening_provider.run_scan(csv_path=str(csv_path))
    assert payload["universe_count"] == 1
    assert payload["results"][0]["market_cap"] is None


def test_scan_unknown_universe_returns_404(client, screening_env):
    resp = client.post("/api/screening/n-pattern/scan", json={"universe_id": "nope"})
    assert resp.status_code == 404


def test_scan_without_body_uses_default_universe(client, screening_env, monkeypatch):
    # 後方互換: ボディ無し POST は内蔵デフォルトでスキャンされる。
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: None)
    resp = client.post("/api/screening/n-pattern/scan")
    assert resp.status_code == 202
    if screening_provider._thread:
        screening_provider._thread.join(timeout=10)
    body = client.get("/api/screening/n-pattern").json()
    assert body["universe_id"] == "default"


def test_scan_result_has_thumbnail_closes(client, screening_env, monkeypatch):
    csv_path = _write_universe(screening_env, [("7203", "A", 5_000_000_000_000)])
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: _n_df())
    payload = screening_provider.run_scan(csv_path=csv_path)
    result = payload["results"][0]
    assert len(result["pivots"]) == 4
    assert len(result["closes"]) > 0
    assert all({"date", "value"} <= set(p) for p in result["closes"])


# --------------------------------------------------------------------------- #
# 実施日の時価総額（発行済株式数 × 最終日足終値）
# --------------------------------------------------------------------------- #
def _shares_series(pairs):
    """[(日付, 株式数)] を tz-aware な Series にする（yfinance の返り値を模す）。"""
    idx = pd.to_datetime([d for d, _ in pairs], utc=True)
    return pd.Series([s for _, s in pairs], index=idx)


def test_scan_computes_market_cap_at_scan_date(client, screening_env, monkeypatch):
    """実施日の時価総額 = 発行済株式数 × 最終日足終値。基準日は最終バーの日付。"""
    csv_path = _write_universe(screening_env, [("7203", "A", 5_000_000_000_000)])
    df = _n_df(d_index=34)
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: df)
    # 株数は CSV 値(5兆) と同じ桁の時価総額になるよう選ぶ。桁が離れていると
    # _is_plausible_cap のスケール検査に弾かれ、算出そのものを検証できない。
    monkeypatch.setattr(
        screening_provider,
        "_fetch_shares",
        lambda code: _shares_series([("2026-01-01", 20_000_000_000), ("2026-02-01", 40_000_000_000)]),
    )

    row = screening_provider.run_scan(csv_path=csv_path)["results"][0]

    last_date = df.index[-1].date().isoformat()
    assert row["market_cap_date"] == last_date
    # 2月の報告値(40e9)を採る。1月の 20e9 ではない
    assert row["market_cap_asof"] == round(40_000_000_000 * float(df["Close"].iloc[-1]))
    # CSV 値は消さない（足切りフィルタとフォールバックに使い続ける）
    assert row["market_cap"] == 5_000_000_000_000


def test_scan_market_cap_asof_none_when_shares_unavailable(client, screening_env, monkeypatch):
    """株式数を取れない銘柄は asof=None かつ **date も None**（日付だけ残すと嘘になる）。"""
    csv_path = _write_universe(screening_env, [("7203", "A", 5_000_000_000_000)])
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: _n_df())
    monkeypatch.setattr(screening_provider, "_fetch_shares", lambda code: None)

    row = screening_provider.run_scan(csv_path=csv_path)["results"][0]

    assert row["market_cap_asof"] is None
    assert row["market_cap_date"] is None
    assert row["market_cap"] == 5_000_000_000_000


def test_shares_fetched_only_for_hits(client, screening_env, monkeypatch):
    """株式数はヒット銘柄だけで取りに行く（ユニバース全体には掛けない）。"""
    csv_path = _write_universe(
        screening_env,
        [("7203", "Hit", 5_000_000_000_000), ("6758", "Miss", 4_000_000_000_000)],
    )
    monkeypatch.setattr(
        screening_provider,
        "_fetch_daily_df",
        lambda code: _n_df() if code == "7203" else _flat_df(),
    )
    called: list[str] = []

    def fake_shares(code):
        called.append(code)
        return _shares_series([("2026-01-01", 1_000_000)])

    monkeypatch.setattr(screening_provider, "_fetch_shares", fake_shares)

    screening_provider.run_scan(csv_path=csv_path)

    assert called == ["7203"]  # 非該当の 6758 には行かない


def test_shares_as_of_picks_value_at_or_before_date():
    """as-of は基準日以前の最新値。基準日より後の報告値は使わない。"""
    s = _shares_series(
        [("2026-01-01", 100), ("2026-03-01", 200), ("2026-06-01", 300)]
    )
    assert screening_provider._shares_as_of(s, "2026-04-15") == 200
    assert screening_provider._shares_as_of(s, "2026-06-01") == 300
    assert screening_provider._shares_as_of(s, "2025-12-31") is None
    assert screening_provider._shares_as_of(None, "2026-04-15") is None


def test_last_bar_rejects_empty_and_nan_close():
    """終値が NaN のバー・空 df は None（時価総額の計算に使わせない）。"""
    assert screening_provider._last_bar(_df([])) is None
    nan_tail = _df([100.0, 101.0, float("nan")])
    assert screening_provider._last_bar(nan_tail) is None
    ok = _df([100.0, 101.0, 102.0])
    assert screening_provider._last_bar(ok) == (ok.index[-1].date().isoformat(), 102.0)


def test_scan_rejects_asof_cap_that_differs_in_scale_from_csv(
    client, screening_env, monkeypatch
):
    """桁がずれた実測値は採らず CSV 値へ落とす。

    yfinance は分割の記録漏れでスケールの壊れた値を返すことがある。無印の実測値として
    出すとフォールバック(`*` + muted)より悪い嘘になるため、日付ごと捨てる。
    """
    csv_path = _write_universe(screening_env, [("7203", "A", 5_000_000_000_000)])
    df = _n_df(d_index=34)
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: df)
    # 終値 125 前後 × この株数 ≒ CSV 値の 100 倍
    huge = int(5_000_000_000_000 * 100 / float(df["Close"].iloc[-1]))
    monkeypatch.setattr(
        screening_provider, "_fetch_shares", lambda code: _shares_series([("2026-01-01", huge)])
    )

    row = screening_provider.run_scan(csv_path=csv_path)["results"][0]

    assert row["market_cap_asof"] is None
    assert row["market_cap_date"] is None
    assert row["market_cap"] == 5_000_000_000_000


def test_is_plausible_cap_bounds():
    """比較対象が無ければ通す。本物の値動き(数倍)は通し、桁違いだけ弾く。"""
    assert screening_provider._is_plausible_cap(1_000, None) is True
    assert screening_provider._is_plausible_cap(1_000, 0) is True
    assert screening_provider._is_plausible_cap(3_000_000, 1_000_000) is True  # 3倍は通す
    assert screening_provider._is_plausible_cap(200_000, 1_000_000) is True  # 1/5 も通す
    assert screening_provider._is_plausible_cap(10_000_000, 1_000_000) is False  # 10倍
    assert screening_provider._is_plausible_cap(100_000, 1_000_000) is False  # 1/10


def test_scan_survives_shares_exception(client, screening_env, monkeypatch):
    """時価総額の解決で例外が出てもスキャン結果を失わない。

    run_scan の外側ハンドラは atomic_write_json の前に status=error を立てるため、
    ここで例外を抜けさせると 900 銘柄ぶんの検出結果が丸ごと捨てられる。
    """
    csv_path = _write_universe(screening_env, [("7203", "A", 5_000_000_000_000)])
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: _n_df())

    def boom(code):
        raise RuntimeError("yfinance exploded")

    monkeypatch.setattr(screening_provider, "_fetch_shares", boom)

    payload = screening_provider.run_scan(csv_path=csv_path)

    assert screening_provider.get_scan_status()["status"] == "done"
    assert len(payload["results"]) == 1
    assert payload["results"][0]["market_cap_asof"] is None
    assert payload["results"][0]["market_cap"] == 5_000_000_000_000


def test_sleeps_after_shares_request_even_when_it_fails(client, screening_env, monkeypatch):
    """株式数の取得に失敗しても待つ。

    失敗はレート制限で起きるのが典型なので、成功時だけ待つ実装だと 429 を食っている
    最中ほど速くリクエストを撃つことになる。
    """
    csv_path = _write_universe(screening_env, [("7203", "A", 5_000_000_000_000)])
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: _n_df())
    monkeypatch.setattr(screening_provider, "_fetch_shares", lambda code: None)
    monkeypatch.setattr(screening_provider, "SCAN_SLEEP_SECONDS", 0.01)
    naps: list[float] = []
    monkeypatch.setattr(screening_provider.time, "sleep", lambda s: naps.append(s))

    screening_provider.run_scan(csv_path=csv_path)

    assert len(naps) == 2  # 履歴取得ぶん(ループ末尾) + 株式数ぶん


def test_market_cap_returns_none_on_missing_parts():
    assert screening_provider._market_cap(None, 100.0) is None
    assert screening_provider._market_cap(1000, None) is None
    assert screening_provider._market_cap(1000, 0.0) is None
    assert screening_provider._market_cap(1000, 12.5) == 12500


def test_response_fills_null_for_legacy_results(client, screening_env):
    """新フィールドの無い旧 JSON でも 200 で返り、値は null になる。"""
    import json

    (screening_env / "n_pattern_results.json").write_text(
        json.dumps(
            {
                "generated_at": "2026-07-01T09:00:00+09:00",
                "universe_count": 1,
                "scanned_count": 1,
                "universe_id": "default",
                "universe_name": "旧",
                "results": [
                    {
                        "ticker": "7203",
                        "name": "A",
                        "market_cap": 5_000_000_000_000,
                        "score": 50,
                        "score_detail": {
                            "trend": 0, "breakout": 25, "volume": 0,
                            "macd": 0, "pullback_penalty": 0, "duration_penalty": 0,
                        },
                        "pivots": [],
                        "break_date": "2026-06-30",
                        "closes": [],
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    body = client.get("/api/screening/n-pattern").json()

    assert body["results"][0]["market_cap_asof"] is None
    assert body["results"][0]["market_cap_date"] is None
