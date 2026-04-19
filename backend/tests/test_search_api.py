"""Integration tests for the /api/search endpoint."""
from __future__ import annotations

from unittest.mock import patch

import pytest


@pytest.mark.integration
def test_search_empty_returns_all_presets(client):
    res = client.get("/api/search")
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert isinstance(body["data"], list)
    assert len(body["data"]) == 15


@pytest.mark.integration
def test_search_preset_by_code(client):
    res = client.get("/api/search?q=7203")
    assert res.status_code == 200
    data = res.json()["data"]
    assert len(data) == 1
    assert data[0]["code"] == "7203"
    assert data[0]["market"] == "JP"


@pytest.mark.integration
def test_search_preset_by_name(client):
    res = client.get("/api/search?q=apple")
    assert res.status_code == 200
    data = res.json()["data"]
    codes = [d["code"] for d in data]
    assert "AAPL" in codes


@pytest.mark.integration
def test_search_response_envelope(client):
    res = client.get("/api/search?q=")
    body = res.json()
    assert "success" in body
    assert "data" in body
    assert "error" in body
    assert body["error"] is None


@pytest.mark.integration
def test_search_falls_back_to_yfinance(client):
    mock_quotes = [
        {"symbol": "7267.T", "shortname": "Honda Motor", "exchange": "TSE"},
        {"symbol": "AMD", "shortname": "Advanced Micro Devices", "exchange": "NMS"},
    ]

    class MockSearch:
        def __init__(self, *args, **kwargs):
            self.quotes = mock_quotes

    with patch("src.routes.search.yf.Search", MockSearch):
        res = client.get("/api/search?q=honda")
    assert res.status_code == 200
    data = res.json()["data"]
    codes = [d["code"] for d in data]
    # .T suffix should be stripped, market should be JP
    assert "7267" in codes
    honda = next(d for d in data if d["code"] == "7267")
    assert honda["market"] == "JP"
    # US ticker stays as-is
    assert "AMD" in codes
    amd = next(d for d in data if d["code"] == "AMD")
    assert amd["market"] == "US"


@pytest.mark.integration
def test_search_yfinance_failure_returns_empty(client):
    import yfinance as yf

    class BrokenSearch:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("network error")

    with patch("src.routes.search.yf.Search", BrokenSearch):
        res = client.get("/api/search?q=unknownticker123")
    assert res.status_code == 200
    assert res.json()["data"] == []


@pytest.mark.integration
def test_search_results_capped_at_ten(client):
    mock_quotes = [
        {"symbol": f"SYM{i}", "shortname": f"Company {i}", "exchange": "NMS"}
        for i in range(20)
    ]

    class MockSearch:
        def __init__(self, *args, **kwargs):
            self.quotes = mock_quotes

    with patch("src.routes.search.yf.Search", MockSearch):
        res = client.get("/api/search?q=sym")
    assert res.status_code == 200
    assert len(res.json()["data"]) <= 10
