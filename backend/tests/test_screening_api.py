"""Integration tests for the screening API (N-pattern + PPP).

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


def _ppp_df():
    """PPP だけにヒットする系列(前半で崩壊 → 後半で成立)。

    N字には当たらない: 最後の 4 ピボットが low→high→low→high にならない
    (単調な下降 → 単調な上昇で、押し目 C が存在しない)。
    """
    return _df(_path([(0, 200.0), (119, 100.0), (239, 260.0)], total=240))


def _both_df():
    """N字と PPP の両方にヒットする系列。

    前半の下降で PPP の崩壊を作り、後半に N字(安値→高値→押し目→高値更新)を置く。
    最後の高値更新が末尾から 4 本目なので RECENCY_MAX_BARS=10 も満たす。
    """
    return _df(
        _path(
            [(0, 200.0), (119, 100.0), (180, 150.0), (200, 130.0), (235, 170.0)],
            total=240,
        )
    )


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
    resp = client.post("/api/screening/scan")
    assert resp.status_code == 202
    assert resp.json()["status"] == "started"
    if screening_provider._thread:
        screening_provider._thread.join(timeout=5)
    status = client.get("/api/screening/status").json()
    assert status["status"] in ("done", "running")


def test_double_post_returns_409(client, screening_env):
    with screening_provider._state_lock:
        screening_provider._scan_state["status"] = "running"
    resp = client.post("/api/screening/scan")
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

    payload = screening_provider.run_scan(csv_path=csv_path)["n-pattern"]
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

    results = screening_provider.run_scan(csv_path=csv_path)["n-pattern"]["results"]

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
    payload = screening_provider.run_scan(csv_path=str(screening_env / "does-not-exist.csv"))["n-pattern"]
    assert payload["results"] == []
    assert screening_provider.get_scan_status()["status"] == "error"


def test_scan_all_fetch_fail_completes_empty(client, screening_env, monkeypatch):
    csv_path = _write_universe(screening_env, [("7203", "A", 5_000_000_000_000)])
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: None)
    payload = screening_provider.run_scan(csv_path=csv_path)["n-pattern"]
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

    resp = client.post("/api/screening/scan", json={"universe_id": created["id"]})
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

    payload = screening_provider.run_scan(csv_path=str(csv_path))["n-pattern"]
    assert payload["universe_count"] == 1
    assert payload["results"][0]["market_cap"] is None


def test_scan_unknown_universe_returns_404(client, screening_env):
    resp = client.post("/api/screening/scan", json={"universe_id": "nope"})
    assert resp.status_code == 404


def test_scan_without_body_uses_default_universe(client, screening_env, monkeypatch):
    # 後方互換: ボディ無し POST は内蔵デフォルトでスキャンされる。
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: None)
    resp = client.post("/api/screening/scan")
    assert resp.status_code == 202
    if screening_provider._thread:
        screening_provider._thread.join(timeout=10)
    body = client.get("/api/screening/n-pattern").json()
    assert body["universe_id"] == "default"


def test_scan_result_has_thumbnail_closes(client, screening_env, monkeypatch):
    csv_path = _write_universe(screening_env, [("7203", "A", 5_000_000_000_000)])
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: _n_df())
    payload = screening_provider.run_scan(csv_path=csv_path)["n-pattern"]
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

    row = screening_provider.run_scan(csv_path=csv_path)["n-pattern"]["results"][0]

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

    row = screening_provider.run_scan(csv_path=csv_path)["n-pattern"]["results"][0]

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

    row = screening_provider.run_scan(csv_path=csv_path)["n-pattern"]["results"][0]

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

    payload = screening_provider.run_scan(csv_path=csv_path)["n-pattern"]

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


# --------------------------------------------------------------------------- #
# 2 パターン同時スキャン（PPP）
# --------------------------------------------------------------------------- #
def test_get_ppp_before_scan_returns_empty(client, screening_env):
    resp = client.get("/api/screening/ppp")
    assert resp.status_code == 200
    body = resp.json()
    assert body["generated_at"] is None
    assert body["results"] == []


def test_unknown_pattern_path_returns_404(client, screening_env):
    """未知のパターンは 404（明示ルートなので FastAPI が自動で返す）。"""
    assert client.get("/api/screening/unknown").status_code == 404


def test_scan_writes_both_pattern_files(client, screening_env, monkeypatch):
    """1 スキャンで両パターンの JSON が生成され、メタ情報が同値になる。"""
    csv_path = _write_universe(
        screening_env,
        [("7203", "Both", 5_000_000_000_000), ("6758", "PppOnly", 4_000_000_000_000)],
    )
    monkeypatch.setattr(
        screening_provider,
        "_fetch_daily_df",
        lambda code: _both_df() if code == "7203" else _ppp_df(),
    )

    payloads = screening_provider.run_scan(
        csv_path=csv_path, universe_id="u1", universe_name="Custom"
    )

    assert (screening_env / "n_pattern_results.json").exists()
    assert (screening_env / "ppp_results.json").exists()
    n_payload, ppp_payload = payloads["n-pattern"], payloads["ppp"]
    # メタ 5 項目は同一スキャンの値なので一致する
    for key in ("generated_at", "universe_id", "universe_name", "universe_count", "scanned_count"):
        assert n_payload[key] == ppp_payload[key], key
    # 7203 は両方、6758 は PPP だけ
    assert [r["ticker"] for r in n_payload["results"]] == ["7203"]
    assert sorted(r["ticker"] for r in ppp_payload["results"]) == ["6758", "7203"]

    body = client.get("/api/screening/ppp").json()
    assert body["universe_name"] == "Custom"
    assert len(body["results"]) == 2
    row = body["results"][0]
    assert "established_date" in row and "duration_days" in row
    # 乖離値は載せない（検出条件そのもので、同じ df から常に再計算できる）
    assert "gap_short" not in row and "gap_long" not in row
    # PPP に N字固有のフィールドは無い
    assert "score" not in row and "pivots" not in row


def test_scan_resolves_market_cap_once_for_both_patterns(client, screening_env, monkeypatch):
    """両パターンにヒットしても株式数の取得は銘柄あたり 1 回。

    素直に書くと _resolve_asof_cap が 2 回走り、レート制限とスキャン時間を無駄に食う。
    """
    csv_path = _write_universe(screening_env, [("7203", "Both", 5_000_000_000_000)])
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: _both_df())
    called: list[str] = []

    def fake_shares(code):
        called.append(code)
        return None

    monkeypatch.setattr(screening_provider, "_fetch_shares", fake_shares)

    payloads = screening_provider.run_scan(csv_path=csv_path)

    assert len(payloads["n-pattern"]["results"]) == 1
    assert len(payloads["ppp"]["results"]) == 1
    assert called == ["7203"]  # 2 回撃たない


def test_scan_skips_market_cap_when_neither_pattern_hits(client, screening_env, monkeypatch):
    """どちらにも当たらない銘柄には追加リクエストを掛けない。"""
    csv_path = _write_universe(screening_env, [("6758", "Miss", 4_000_000_000_000)])
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: _flat_df())
    called: list[str] = []
    monkeypatch.setattr(screening_provider, "_fetch_shares", lambda code: called.append(code))

    payloads = screening_provider.run_scan(csv_path=csv_path)

    assert payloads["n-pattern"]["results"] == []
    assert payloads["ppp"]["results"] == []
    assert called == []


def test_stale_ppp_hit_does_not_trigger_market_cap_request(client, screening_env, monkeypatch):
    """成立が古い PPP 銘柄には時価総額の追加リクエストを撃たない。

    「ヒット銘柄だけ解決する」は N字だけの頃はユニバースの一部にしか当たらなかったが、
    PPP は実測 82% の銘柄がヒットするため、そのままだと _resolve_asof_cap が
    ほぼ全銘柄で走る（実測 170 → 491 回）。しかも増分の大半は鮮度フィルタで
    表示されない行のためのもの。**行は残したまま**解決だけを鮮度で絞る。
    """
    csv_path = _write_universe(screening_env, [("7203", "StalePpp", 5_000_000_000_000)])
    # _ppp_df は成立が 100 本以上前（CAP_RESOLVE_MAX_BARS=10 を大きく超える）
    stale = _ppp_df()
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: stale)
    called: list[str] = []
    monkeypatch.setattr(screening_provider, "_fetch_shares", lambda code: called.append(code))

    payloads = screening_provider.run_scan(csv_path=csv_path)
    row = payloads["ppp"]["results"][0]

    assert called == []  # 追加リクエストを撃たない
    # **行は落とさない**（§5.2: バックエンドで打ち切らない）
    assert row["ticker"] == "7203"
    assert row["duration_days"] > screening_provider.CAP_RESOLVE_MAX_BARS
    # 実測値は無いが CSV 登録値は残るので、UI は `*` 付きで表示できる
    assert row["market_cap_asof"] is None
    assert row["market_cap_date"] is None
    assert row["market_cap"] == 5_000_000_000_000


def test_fresh_ppp_hit_still_resolves_market_cap(client, screening_env, monkeypatch):
    """成立が新しい PPP 銘柄には従来どおり解決を掛ける（絞りすぎていない）。"""
    csv_path = _write_universe(screening_env, [("7203", "FreshPpp", 5_000_000_000_000)])
    # 末尾付近で成立するよう、下降→上昇の転換を後ろに寄せる（成立は末尾 7 本前）
    fresh = _df(_path([(0, 200.0), (215, 100.0), (239, 190.0)], total=240))
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: fresh)
    called: list[str] = []
    monkeypatch.setattr(screening_provider, "_fetch_shares", lambda code: called.append(code))

    row = screening_provider.run_scan(csv_path=csv_path)["ppp"]["results"][0]

    assert row["duration_days"] <= screening_provider.CAP_RESOLVE_MAX_BARS
    assert called == ["7203"]


def test_ppp_results_sorted_by_established_date_desc(client, screening_env, monkeypatch):
    """成立日の新しい順。同着は ticker 昇順（N字と同じ規約）。"""
    csv_path = _write_universe(
        screening_env,
        [
            ("7203", "Old", 5_000_000_000_000),
            ("9984", "NewA", 3_000_000_000_000),
            ("6758", "NewB", 4_000_000_000_000),
        ],
    )

    def fake_fetch(code):
        if code == "7203":
            # 成立を早め（後半の上昇を前倒し）にして古い established_date を作る
            return _df(_path([(0, 200.0), (60, 100.0), (239, 320.0)], total=240))
        return _ppp_df()  # 9984 と 6758 は同じ系列 → 成立日が同着

    monkeypatch.setattr(screening_provider, "_fetch_daily_df", fake_fetch)

    results = screening_provider.run_scan(csv_path=csv_path)["ppp"]["results"]

    assert len(results) == 3
    dates = [r["established_date"] for r in results]
    assert dates == sorted(dates, reverse=True)
    # 同着の 2 件は ticker 昇順
    tied = [r["ticker"] for r in results if r["established_date"] == dates[0]]
    assert tied == sorted(tied)


def test_ppp_result_keeps_one_row_per_ticker(client, screening_env, monkeypatch):
    """複数回成立しても銘柄あたり 1 行（表の key={ticker} が前提）。"""
    csv_path = _write_universe(screening_env, [("7203", "A", 5_000_000_000_000)])
    # 崩壊→成立を 2 回繰り返す系列
    twice = _df(
        _path(
            [(0, 200.0), (60, 100.0), (120, 240.0), (180, 120.0), (239, 300.0)],
            total=240,
        )
    )
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: twice)

    results = screening_provider.run_scan(csv_path=csv_path)["ppp"]["results"]

    assert len(results) == 1
    # 採るのは最新の成立イベント
    from src.analysis.ppp import ppp_events

    assert results[0]["established_date"] == ppp_events(twice)[-1]["date"]


def test_ppp_detector_exception_does_not_lose_n_pattern_results(
    client, screening_env, monkeypatch
):
    """PPP 検出器が落ちても N字の結果は失われない（例外は 1 銘柄・1 検出器に閉じる）。"""
    csv_path = _write_universe(screening_env, [("7203", "A", 5_000_000_000_000)])
    monkeypatch.setattr(screening_provider, "_fetch_daily_df", lambda code: _n_df())

    def boom(df):
        raise RuntimeError("ppp exploded")

    monkeypatch.setattr(screening_provider, "detect_ppp", boom)

    payloads = screening_provider.run_scan(csv_path=csv_path)

    assert screening_provider.get_scan_status()["status"] == "done"
    assert len(payloads["n-pattern"]["results"]) == 1
    assert payloads["ppp"]["results"] == []
