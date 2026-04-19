from fastapi import APIRouter, Query
import yfinance as yf

from ..schemas.common import ok

router = APIRouter()

# Preset list for instant results (JP + US majors)
PRESETS = [
    {"code": "7203", "name": "Toyota Motor", "market": "JP"},
    {"code": "6758", "name": "Sony Group", "market": "JP"},
    {"code": "9984", "name": "SoftBank Group", "market": "JP"},
    {"code": "6861", "name": "Keyence", "market": "JP"},
    {"code": "8306", "name": "Mitsubishi UFJ", "market": "JP"},
    {"code": "9432", "name": "NTT", "market": "JP"},
    {"code": "7974", "name": "Nintendo", "market": "JP"},
    {"code": "AAPL", "name": "Apple Inc.", "market": "US"},
    {"code": "MSFT", "name": "Microsoft", "market": "US"},
    {"code": "NVDA", "name": "NVIDIA", "market": "US"},
    {"code": "TSLA", "name": "Tesla", "market": "US"},
    {"code": "GOOGL", "name": "Alphabet", "market": "US"},
    {"code": "AMZN", "name": "Amazon", "market": "US"},
    {"code": "META", "name": "Meta Platforms", "market": "US"},
    {"code": "JPM", "name": "JPMorgan Chase", "market": "US"},
]

_JP_EXCHANGES = {"TSE", "JPX", "OSA", "TYO"}


def _normalize_yf_result(h: dict) -> dict:
    """Convert a yfinance quote hit to {code, name, market}."""
    sym: str = h.get("symbol", "")
    name: str = h.get("shortname") or h.get("longname") or sym
    ex: str = h.get("exchange", "")
    if sym.endswith(".T") or ex in _JP_EXCHANGES:
        market = "JP"
        code = sym[:-2] if sym.endswith(".T") else sym
    else:
        market = "US"
        code = sym
    return {"code": code.upper(), "name": name, "market": market}


@router.get("/search")
def search(q: str = Query(default="", description="Search query")):
    ql = q.lower().strip()
    if not ql:
        return ok(PRESETS)

    results = [
        p for p in PRESETS
        if ql in p["code"].lower() or ql in p["name"].lower()
    ]

    # If no preset match, try yfinance search
    if not results and len(ql) >= 2:
        try:
            hits = yf.Search(ql, max_results=8).quotes
            for h in hits:
                results.append(_normalize_yf_result(h))
        except Exception:
            pass

    return ok(results[:10])
