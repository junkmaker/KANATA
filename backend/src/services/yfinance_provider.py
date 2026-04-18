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
