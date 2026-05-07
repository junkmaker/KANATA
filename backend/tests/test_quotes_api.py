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


@pytest.mark.integration
def test_alphanumeric_jp_symbol_returns_data(client):
    """285A 形式（3桁数字+アルファベット）の銘柄コードでデータが取得できること"""
    mock_bars = [{"t": 1700000000000, "o": 100.0, "h": 110.0, "l": 90.0, "c": 105.0, "v": 1000}]
    with patch("src.routes.quotes.fetch_ohlcv", return_value=mock_bars):
        res = client.get("/api/quotes/285A?timeframe=1D")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_to_yf_symbol_alphanumeric():
    """to_yf_symbol が英数字混在の JP コードに .T を付与すること"""
    from src.services.yfinance_provider import to_yf_symbol
    assert to_yf_symbol("7203") == "7203.T"
    assert to_yf_symbol("285A") == "285A.T"
    assert to_yf_symbol("215A") == "215A.T"
    assert to_yf_symbol("AAPL") == "AAPL"
    assert to_yf_symbol("NVDA") == "NVDA"
    assert to_yf_symbol("12345") == "12345"
