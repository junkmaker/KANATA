"""Integration tests for the watchlist REST API."""
from __future__ import annotations

import pytest

from src.services import jp_names


@pytest.mark.integration
def test_default_list_present(client):
    res = client.get("/api/watchlists")
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert len(body["data"]) == 1
    assert body["data"][0]["name"] == "Default"
    assert body["data"][0]["is_default"] == 1


@pytest.mark.integration
def test_create_and_delete_watchlist(client):
    res = client.post("/api/watchlists", json={"name": "Tech"})
    assert res.status_code == 201
    list_id = res.json()["data"]["id"]

    res = client.get("/api/watchlists")
    names = [w["name"] for w in res.json()["data"]]
    assert "Tech" in names

    res = client.delete(f"/api/watchlists/{list_id}")
    assert res.status_code == 200
    res = client.get("/api/watchlists")
    assert all(w["name"] != "Tech" for w in res.json()["data"])


@pytest.mark.integration
def test_cannot_delete_last_watchlist(client):
    res = client.get("/api/watchlists")
    only_id = res.json()["data"][0]["id"]
    res = client.delete(f"/api/watchlists/{only_id}")
    assert res.status_code == 400


@pytest.mark.integration
def test_duplicate_name_rejected(client):
    client.post("/api/watchlists", json={"name": "Dup"})
    res = client.post("/api/watchlists", json={"name": "Dup"})
    assert res.status_code == 409


@pytest.mark.integration
def test_rename_and_default_toggle(client):
    new_id = client.post("/api/watchlists", json={"name": "Tmp"}).json()["data"]["id"]
    res = client.patch(f"/api/watchlists/{new_id}", json={"name": "Renamed", "is_default": True})
    assert res.status_code == 200
    body = res.json()["data"]
    assert body["name"] == "Renamed"
    assert body["is_default"] == 1
    # Old default should no longer be default
    listing = client.get("/api/watchlists").json()["data"]
    defaults = [w for w in listing if w["is_default"] == 1]
    assert len(defaults) == 1
    assert defaults[0]["id"] == new_id


@pytest.mark.integration
def test_add_remove_items(client):
    list_id = client.get("/api/watchlists").json()["data"][0]["id"]

    res = client.post(
        f"/api/watchlists/{list_id}/items",
        json={"symbol": "AAPL", "market": "US", "display_name": "Apple"},
    )
    assert res.status_code == 201
    items = res.json()["data"]["items"]
    assert items[0]["symbol"] == "AAPL"

    # Duplicate symbol rejected
    res = client.post(
        f"/api/watchlists/{list_id}/items",
        json={"symbol": "AAPL", "market": "US"},
    )
    assert res.status_code == 409

    # Remove
    res = client.delete(f"/api/watchlists/{list_id}/items/AAPL")
    assert res.status_code == 200
    assert res.json()["data"]["items"] == []


@pytest.mark.integration
def test_reorder_items(client):
    list_id = client.get("/api/watchlists").json()["data"][0]["id"]
    for sym in ["AAPL", "MSFT", "NVDA"]:
        client.post(f"/api/watchlists/{list_id}/items", json={"symbol": sym, "market": "US"})

    res = client.put(
        f"/api/watchlists/{list_id}/items/reorder",
        json={"symbols": ["NVDA", "AAPL", "MSFT"]},
    )
    assert res.status_code == 200
    syms = [i["symbol"] for i in res.json()["data"]["items"]]
    assert syms == ["NVDA", "AAPL", "MSFT"]


@pytest.mark.integration
def test_reorder_items_rejects_mismatch(client):
    list_id = client.get("/api/watchlists").json()["data"][0]["id"]
    client.post(f"/api/watchlists/{list_id}/items", json={"symbol": "AAPL", "market": "US"})
    res = client.put(
        f"/api/watchlists/{list_id}/items/reorder",
        json={"symbols": ["AAPL", "GHOST"]},
    )
    assert res.status_code == 400


@pytest.mark.integration
def test_reorder_lists(client):
    a = client.post("/api/watchlists", json={"name": "A"}).json()["data"]["id"]
    b = client.post("/api/watchlists", json={"name": "B"}).json()["data"]["id"]
    default_id = next(
        w["id"] for w in client.get("/api/watchlists").json()["data"] if w["name"] == "Default"
    )

    res = client.put("/api/watchlists/reorder", json={"ids": [b, a, default_id]})
    assert res.status_code == 200
    order = [w["id"] for w in res.json()["data"]]
    assert order == [b, a, default_id]


@pytest.mark.integration
def test_404_on_missing_list(client):
    res = client.get("/api/watchlists")
    assert res.status_code == 200
    res = client.delete("/api/watchlists/9999")
    assert res.status_code == 404


@pytest.mark.integration
def test_add_item_normalizes_jp_numeric_market(client):
    list_id = client.get("/api/watchlists").json()["data"][0]["id"]
    res = client.post(
        f"/api/watchlists/{list_id}/items",
        json={"symbol": "7203", "market": "US"},
    )
    assert res.status_code == 201
    item = res.json()["data"]["items"][0]
    assert item["symbol"] == "7203"
    assert item["market"] == "JP"


@pytest.mark.integration
def test_add_item_normalizes_symbol_case(client):
    list_id = client.get("/api/watchlists").json()["data"][0]["id"]
    res = client.post(
        f"/api/watchlists/{list_id}/items",
        json={"symbol": "aapl", "market": "US"},
    )
    assert res.status_code == 201
    item = res.json()["data"]["items"][0]
    assert item["symbol"] == "AAPL"

    # Duplicate via uppercase should be 409
    res = client.post(
        f"/api/watchlists/{list_id}/items",
        json={"symbol": "AAPL", "market": "US"},
    )
    assert res.status_code == 409


@pytest.mark.integration
def test_add_item_trims_whitespace(client):
    list_id = client.get("/api/watchlists").json()["data"][0]["id"]
    res = client.post(
        f"/api/watchlists/{list_id}/items",
        json={"symbol": " MSFT ", "market": "US"},
    )
    assert res.status_code == 201
    item = res.json()["data"]["items"][0]
    assert item["symbol"] == "MSFT"


@pytest.mark.integration
def test_add_item_empty_symbol_rejected(client):
    list_id = client.get("/api/watchlists").json()["data"][0]["id"]
    res = client.post(
        f"/api/watchlists/{list_id}/items",
        json={"symbol": "", "market": "US"},
    )
    assert res.status_code == 422


@pytest.mark.integration
def test_remove_item_unknown_symbol_returns_404(client):
    list_id = client.get("/api/watchlists").json()["data"][0]["id"]
    res = client.delete(f"/api/watchlists/{list_id}/items/GHOST")
    assert res.status_code == 404


@pytest.mark.integration
def test_jp_item_display_name_overridden_by_master(client):
    # Arrange: 英語名で保存された既存行を再現する
    list_id = client.get("/api/watchlists").json()["data"][0]["id"]
    client.post(
        f"/api/watchlists/{list_id}/items",
        json={"symbol": "7203", "market": "JP", "display_name": "Toyota Motor"},
    )

    # Act
    body = client.get("/api/watchlists").json()["data"][0]

    # Assert
    item = next(i for i in body["items"] if i["symbol"] == "7203")
    assert item["display_name"] == "トヨタ自動車"


@pytest.mark.integration
def test_add_item_response_localized(client):
    # Arrange
    list_id = client.get("/api/watchlists").json()["data"][0]["id"]

    # Act: POST の戻り値も _serialize を通るので、その場で日本語になる
    res = client.post(
        f"/api/watchlists/{list_id}/items",
        json={"symbol": "5713", "market": "JP", "display_name": "SUMITOMO METAL MINING CO"},
    )

    # Assert
    item = next(i for i in res.json()["data"]["items"] if i["symbol"] == "5713")
    assert item["display_name"] == "住友金属鉱山"


@pytest.mark.integration
def test_us_item_display_name_preserved(client):
    # Arrange
    list_id = client.get("/api/watchlists").json()["data"][0]["id"]
    client.post(
        f"/api/watchlists/{list_id}/items",
        json={"symbol": "AAPL", "market": "US", "display_name": "Apple Inc."},
    )

    # Act
    body = client.get("/api/watchlists").json()["data"][0]

    # Assert
    item = next(i for i in body["items"] if i["symbol"] == "AAPL")
    assert item["display_name"] == "Apple Inc."


@pytest.mark.integration
def test_unknown_jp_code_falls_back_to_saved_name(client):
    # Arrange: マスタに載らないコード
    list_id = client.get("/api/watchlists").json()["data"][0]["id"]
    client.post(
        f"/api/watchlists/{list_id}/items",
        json={"symbol": "9999", "market": "JP", "display_name": "Saved Name"},
    )

    # Act
    body = client.get("/api/watchlists").json()["data"][0]

    # Assert
    item = next(i for i in body["items"] if i["symbol"] == "9999")
    assert item["display_name"] == "Saved Name"


@pytest.mark.integration
def test_missing_master_degrades_to_saved_name(client, monkeypatch, tmp_path):
    # Arrange: 同梱マスタが無い環境（500 にせず保存値へ縮退する）
    list_id = client.get("/api/watchlists").json()["data"][0]["id"]
    client.post(
        f"/api/watchlists/{list_id}/items",
        json={"symbol": "7203", "market": "JP", "display_name": "Toyota Motor"},
    )
    monkeypatch.setattr(jp_names, "master_path", lambda: tmp_path / "absent.csv")
    monkeypatch.setattr(jp_names, "_cache", None)

    # Act
    res = client.get("/api/watchlists")

    # Assert
    assert res.status_code == 200
    item = next(i for i in res.json()["data"][0]["items"] if i["symbol"] == "7203")
    assert item["display_name"] == "Toyota Motor"
