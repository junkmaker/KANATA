import math
import yfinance as yf

# Map frontend timeframe → (yfinance interval, yfinance period, cache TTL seconds)
INTERVAL_MAP: dict[str, tuple[str, str, int]] = {
    "5m":  ("5m",  "5d",   60),
    "15m": ("15m", "60d",  120),
    "60m": ("60m", "60d",  300),
    "1D":  ("1d",  "5y",   3600),
    "1W":  ("1wk", "10y",  3600),
    "1M":  ("1mo", "max",  86400),
}

def to_yf_symbol(symbol: str) -> str:
    """Append .T suffix for numeric JP tickers."""
    return f"{symbol}.T" if symbol.isdigit() else symbol


def fetch_ohlcv(symbol: str, timeframe: str) -> list[dict]:
    if not symbol.isascii():
        return []

    yf_symbol = to_yf_symbol(symbol)
    yf_interval, yf_period, _ = INTERVAL_MAP.get(timeframe, ("1d", "5y", 3600))

    ticker = yf.Ticker(yf_symbol)
    df = ticker.history(period=yf_period, interval=yf_interval, auto_adjust=True)

    if df.empty:
        return []

    bars = []
    for ts, row in df.iterrows():
        o, h, l, c, v = row["Open"], row["High"], row["Low"], row["Close"], row["Volume"]
        # Skip rows with NaN prices
        if any(math.isnan(x) for x in [o, h, l, c]):
            continue
        bars.append({
            "t": int(ts.timestamp() * 1000),
            "o": round(float(o), 4),
            "h": round(float(h), 4),
            "l": round(float(l), 4),
            "c": round(float(c), 4),
            "v": int(v) if not math.isnan(v) else 0,
        })

    return bars


def get_ttl(timeframe: str) -> int:
    return INTERVAL_MAP.get(timeframe, ("", "", 3600))[2]


def fetch_fundamentals(symbol: str) -> dict | None:
    if not symbol.isascii():
        return None

    yf_symbol = to_yf_symbol(symbol)

    try:
        ticker = yf.Ticker(yf_symbol)
        info = ticker.info
    except Exception:
        return None

    if not info or not isinstance(info, dict):
        return None

    def safe_pct(key: str) -> float:
        v = info.get(key)
        if v is None or not isinstance(v, (int, float)):
            return 0.0
        try:
            f = float(v)
            return 0.0 if math.isnan(f) else round(f * 100, 1)
        except (ValueError, OverflowError):
            return 0.0

    def safe_float(key: str) -> float:
        v = info.get(key)
        if v is None or not isinstance(v, (int, float)):
            return 0.0
        try:
            f = float(v)
            return 0.0 if math.isnan(f) else round(f, 2)
        except (ValueError, OverflowError):
            return 0.0

    def fmt_mcap(cap: object) -> str:
        if cap is None or not isinstance(cap, (int, float)):
            return "—"
        try:
            f = float(cap)
        except (ValueError, OverflowError):
            return "—"
        if math.isnan(f):
            return "—"
        if f >= 1e12:
            return f"{f / 1e12:.1f}T"
        if f >= 1e9:
            return f"{f / 1e9:.1f}B"
        if f >= 1e6:
            return f"{f / 1e6:.1f}M"
        return "—"

    return {
        "roe": safe_pct("returnOnEquity"),
        "roic": safe_pct("returnOnAssets"),
        "per": safe_float("trailingPE"),
        "pbr": safe_float("priceToBook"),
        "div": safe_pct("dividendYield"),
        "mcap": fmt_mcap(info.get("marketCap")),
    }
