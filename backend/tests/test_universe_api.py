"""Integration tests for the screening universe registration API.

KANATA_DATA_DIR を tmp に向けて universes.json / CSV を隔離する。
watchlists と違いエンベロープ無し(生オブジェクト + HTTPException detail)。
"""
from __future__ import annotations

import pandas as pd
import pytest

from src.services import universe_provider

FULL_CSV = "code,name,market_cap\n7203,Toyota,5000000000000\n6758,Sony,4000000000000\n"
CODE_ONLY_CSV = "code\n7203\n6758\n"


@pytest.fixture
def universe_env(tmp_path, monkeypatch):
    monkeypatch.setenv("KANATA_DATA_DIR", str(tmp_path))
    yield tmp_path


def _register(client, name, csv_text):
    return client.post(
        "/api/screening/universes", json={"name": name, "csv_text": csv_text}
    )


# --------------------------------------------------------------------------- #
# List
# --------------------------------------------------------------------------- #
def test_list_includes_builtin_default(client, universe_env):
    resp = client.get("/api/screening/universes")
    assert resp.status_code == 200
    universes = resp.json()["universes"]
    assert universes[0]["id"] == "default"
    assert universes[0]["builtin"] is True


def test_index_corrupt_returns_empty(client, universe_env):
    udir = universe_env / "universes"
    udir.mkdir(parents=True, exist_ok=True)
    (udir / "universes.json").write_text("{not valid json", encoding="utf-8")
    resp = client.get("/api/screening/universes")
    assert resp.status_code == 200
    universes = resp.json()["universes"]
    assert [u["id"] for u in universes] == ["default"]


# --------------------------------------------------------------------------- #
# Register
# --------------------------------------------------------------------------- #
def test_register_full_csv(client, universe_env):
    resp = _register(client, "My List", FULL_CSV)
    assert resp.status_code == 201
    body = resp.json()
    assert body["symbol_count"] == 2
    assert body["has_market_cap"] is True
    assert body["builtin"] is False

    listed = client.get("/api/screening/universes").json()["universes"]
    assert any(u["id"] == body["id"] and u["name"] == "My List" for u in listed)


def test_register_code_only_csv(client, universe_env):
    resp = _register(client, "Codes", CODE_ONLY_CSV)
    assert resp.status_code == 201
    body = resp.json()
    assert body["has_market_cap"] is False
    assert body["symbol_count"] == 2

    # 正規化保存: name は code で代用、market_cap は空欄
    saved = universe_env / "universes" / f"{body['id']}.csv"
    df = pd.read_csv(saved, dtype={"code": str, "name": str})
    assert list(df.columns) == ["code", "name", "market_cap"]
    assert list(df["name"]) == ["7203", "6758"]
    assert df["market_cap"].isna().all()


def test_register_missing_code_column(client, universe_env):
    resp = _register(client, "Bad", "name,market_cap\nToyota,100\n")
    assert resp.status_code == 400
    assert "code" in resp.json()["detail"]


def test_register_empty_rows(client, universe_env):
    assert _register(client, "HeaderOnly", "code\n").status_code == 400
    assert _register(client, "Blank", "code,name\n ,x\n").status_code == 400


def test_register_duplicate_name(client, universe_env):
    assert _register(client, "Dup", CODE_ONLY_CSV).status_code == 201
    resp = _register(client, "Dup", CODE_ONLY_CSV)
    assert resp.status_code == 409


def test_register_too_large(client, universe_env):
    big = "code\n" + "x" * (universe_provider.MAX_CSV_BYTES + 1)
    resp = _register(client, "Big", big)
    assert resp.status_code == 400


def test_register_decimal_market_cap(client, universe_env):
    # 非整数の market_cap は 500 にせず丸めて登録する(回帰: astype("Int64") の TypeError)。
    resp = _register(client, "Decimal", "code,market_cap\n7203,1234.5\n6758,abc\n")
    assert resp.status_code == 201
    body = resp.json()
    assert body["symbol_count"] == 2

    saved = universe_env / "universes" / f"{body['id']}.csv"
    df = pd.read_csv(saved, dtype={"code": str})
    caps = list(df["market_cap"])
    assert caps[0] == 1234 or caps[0] == 1235  # 丸め結果(round の方式には依存しない)
    assert pd.isna(caps[1])  # 数値化できない値は空欄


def test_register_non_ascii_code_400(client, universe_env):
    # Shift-JIS を file.text() で読むと code 列が化ける想定 → UTF-8 案内の 400
    resp = _register(client, "SJIS", "code\nトヨタ\n")
    assert resp.status_code == 400
    assert "UTF-8" in resp.json()["detail"]


# --------------------------------------------------------------------------- #
# Delete
# --------------------------------------------------------------------------- #
def test_delete_registered(client, universe_env):
    uid = _register(client, "ToDelete", CODE_ONLY_CSV).json()["id"]
    csv_file = universe_env / "universes" / f"{uid}.csv"
    assert csv_file.exists()

    resp = client.delete(f"/api/screening/universes/{uid}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "deleted"

    listed = client.get("/api/screening/universes").json()["universes"]
    assert all(u["id"] != uid for u in listed)
    assert not csv_file.exists()


def test_delete_default_forbidden(client, universe_env):
    resp = client.delete("/api/screening/universes/default")
    assert resp.status_code == 400


def test_delete_unknown_404(client, universe_env):
    resp = client.delete("/api/screening/universes/nope")
    assert resp.status_code == 404
