"""Integration tests for the /api/quotes endpoint."""
from __future__ import annotations

from unittest.mock import patch

import pytest


@pytest.mark.integration
def test_non_ascii_symbol_returns_404(client):
    res = client.get("/api/quotes/%E3%83%AC%E3%83%BC%E3%82%B6%E3%83%BC%E3%83%86%E3%83%83%E3%82%AF?timeframe=1D")
    assert res.status_code == 404


@pytest.mark.integration
def test_empty_data_returns_404(client):
    with patch("src.routes.quotes.fetch_ohlcv", return_value=[]):
        res = client.get("/api/quotes/DUMMY?timeframe=1D")
    assert res.status_code == 404


@pytest.mark.integration
def test_valid_symbol_returns_list(client):
    mock_bars = [{"t": 1700000000000, "o": 100.0, "h": 110.0, "l": 90.0, "c": 105.0, "v": 1000}]
    with patch("src.routes.quotes.fetch_ohlcv", return_value=mock_bars):
        res = client.get("/api/quotes/7203?timeframe=1D")
    assert res.status_code == 200
    assert isinstance(res.json(), list)
    assert len(res.json()) == 1
