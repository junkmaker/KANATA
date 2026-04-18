from fastapi import APIRouter, HTTPException, Query
from ..services.cache import cache
from ..services.yfinance_provider import fetch_ohlcv, get_ttl

router = APIRouter()

@router.get("/quotes/{symbol}")
def get_quotes(
    symbol: str,
    timeframe: str = Query(default="1D", description="Timeframe: 5m 15m 60m 1D 1W 1M"),
):
    cache_key = f"quotes:{symbol}:{timeframe}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        bars = fetch_ohlcv(symbol, timeframe)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Data fetch failed: {e}")

    if not bars:
        raise HTTPException(status_code=404, detail=f"No data for {symbol}")

    cache.set(cache_key, bars, get_ttl(timeframe))
    return bars
