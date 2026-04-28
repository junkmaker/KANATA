from fastapi import APIRouter, HTTPException
from ..services.cache import cache
from ..services.yfinance_provider import fetch_fundamentals

router = APIRouter()


@router.get("/fundamentals/{symbol}")
def get_fundamentals(symbol: str):
    cache_key = f"fundamentals:{symbol}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    result = fetch_fundamentals(symbol)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No fundamentals for {symbol}")

    cache.set(cache_key, result, 3600)
    return result
