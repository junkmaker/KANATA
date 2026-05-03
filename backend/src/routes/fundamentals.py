from fastapi import APIRouter, HTTPException
from ..services.cache import cache
from ..services.yfinance_provider import fetch_fundamentals, fetch_quarterly_fin

router = APIRouter()


@router.get("/fundamentals/{symbol}/quarterly")
def get_quarterly_fundamentals(symbol: str):
    cache_key = f"fundamentals:quarterly:{symbol}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    result = fetch_quarterly_fin(symbol)
    data: list = result if result is not None else []
    cache.set(cache_key, data, 3600)
    return data


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
