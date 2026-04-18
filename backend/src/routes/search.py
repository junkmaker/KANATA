from fastapi import APIRouter, Query
import yfinance as yf

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

@router.get("/search")
def search(q: str = Query(default="", description="Search query")):
    ql = q.lower().strip()
    if not ql:
        return PRESETS

    results = [
        p for p in PRESETS
        if ql in p["code"].lower() or ql in p["name"].lower()
    ]

    # If no preset match, try yfinance search
    if not results and len(ql) >= 2:
        try:
            hits = yf.Search(ql, max_results=8).quotes
            for h in hits:
                sym = h.get("symbol", "")
                name = h.get("shortname") or h.get("longname") or sym
                ex = h.get("exchange", "")
                market = "JP" if ex in ("TSE", "JPX", "OSA") else "US"
                results.append({"code": sym, "name": name, "market": market})
        except Exception:
            pass

    return results
