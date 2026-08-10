from fastapi import APIRouter, Query
import yfinance as yf

from ..schemas.common import ok
from ..services import jp_names

router = APIRouter()

# Preset list for instant results (JP + US majors).
# JP 銘柄の英語名は**表示用ではなく検索エイリアス**。表示名は jp_names マスタが
# 上書きするので、`q=toyota` を壊さないためにこの英語名は残すこと。
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


def _localized(entry: dict) -> dict:
    """JP 銘柄名マスタに載っていれば日本語名で置き換えた新しい dict を返す。

    PRESETS はモジュールレベルの共有リストなので、必ず新しい dict を返すこと
    (in-place 更新するとプロセス全体が汚染される)。
    """
    jp = jp_names.jp_name(entry["code"])
    return entry if jp is None else {**entry, "name": jp}


@router.get("/search")
def search(q: str = Query(default="", description="Search query")):
    ql = q.lower().strip()
    if not ql:
        return ok([_localized(p) for p in PRESETS])

    # 英語エイリアス(PRESETS の name)と日本語表示名の両方をマッチ対象にする
    results = []
    for p in PRESETS:
        loc = _localized(p)
        if ql in p["code"].lower() or ql in p["name"].lower() or ql in loc["name"].lower():
            results.append(loc)

    # If no preset match, try yfinance search
    if not results and len(ql) >= 2:
        try:
            hits = yf.Search(ql, max_results=8).quotes
            for h in hits:
                results.append(_localized(_normalize_yf_result(h)))
        except Exception:
            pass

    return ok(results[:10])
