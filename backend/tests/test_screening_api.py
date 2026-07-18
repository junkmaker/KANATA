"""Integration tests for the N-pattern screening API.

yfinance は ``_fetch_daily_df`` の patch で完全に遮断し、KANATA_DATA_DIR を tmp に
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


def _n_df(volume_spike=False):
    # D は末尾付近(index 34)に置き、直近性フィルタ(RECENCY_MAX_BARS)を満たす。
    closes = _path([(0, 100.0), (10, 120.0), (18, 108.0), (34, 125.0)], total=40)
    vol = [1000.0] * 40
    if volume_spike:
        vol[34] = 1600.0
    return _df(closes, vol)


def _flat_df():
    return _df([100.0 + i * 0.5 for i in range(40)])  # 単調上昇 → 非該当


@pytest.fixture
def screening_env(tmp_path, monkeypatch):
    monkeypatch.setenv("KANATA_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(screening_provider, "SCAN_SLEEP_SECONDS", 0)
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
# run_scan (synchronous) — scoring, sort, filters
# --------------------------------------------------------------------------- #
def test_scan_sorts_desc_and_applies_filters(client, screening_env, monkeypatch):
    csv_path = _write_universe(
        screening_env,
        [
            ("7203", "High", 5_000_000_000_000),   # detected, volume spike -> high score
            ("6758", "Low", 4_000_000_000_000),    # detected, no spike -> lower score
            ("9984", "Broken", 3_000_000_000_000),  # fetch fails -> skipped
            ("1301", "Tiny", 9_000_000_000),        # < 100 億 -> filtered before fetch
        ],
    )

    def fake_fetch(code):
        if code == "7203":
            return _n_df(volume_spike=True)
        if code == "6758":
            return _n_df(volume_spike=False)
        if code == "9984":
            return None
        raise AssertionError(f"unexpected fetch for {code}")  # 1301 must be filtered out

    monkeypatch.setattr(screening_provider, "_fetch_daily_df", fake_fetch)

    payload = screening_provider.run_scan(csv_path=csv_path)
    assert payload["universe_count"] == 3  # 1301 excluded by market cap
    assert [r["ticker"] for r in payload["results"]] == ["7203", "6758"]
    assert payload["results"][0]["score"] >= payload["results"][1]["score"]

    # GET returns cached results, sorted, with min_score filter.
    all_results = client.get("/api/screening/n-pattern?min_score=0").json()
    assert [r["ticker"] for r in all_results["results"]] == ["7203", "6758"]

    filtered = client.get("/api/screening/n-pattern?min_score=80").json()
    assert [r["ticker"] for r in filtered["results"]] == ["7203"]


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
