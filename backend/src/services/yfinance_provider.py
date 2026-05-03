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


def fetch_quarterly_fin(symbol: str) -> list[dict] | None:
    if not symbol.isascii():
        return None

    yf_symbol = to_yf_symbol(symbol)

    try:
        ticker = yf.Ticker(yf_symbol)
        fin = ticker.quarterly_financials
        bs = ticker.quarterly_balance_sheet
        info = ticker.info
    except Exception:
        return None

    if fin is None or fin.empty or bs is None or bs.empty:
        return None

    per_const = 0.0
    if isinstance(info, dict):
        trailing_pe = info.get("trailingPE")
        if trailing_pe is not None and isinstance(trailing_pe, (int, float)):
            try:
                f = float(trailing_pe)
                per_const = 0.0 if math.isnan(f) else round(f, 1)
            except (ValueError, OverflowError):
                per_const = 0.0

    equity_keys = ["Stockholders Equity", "Common Stock Equity", "Total Stockholder Equity"]
    net_income_key = "Net Income"
    assets_keys = ["Total Assets"]

    results = []
    for dt in fin.columns:
        try:
            t_ms = int(dt.timestamp() * 1000)

            net_income = None
            if net_income_key in fin.index:
                v = fin.loc[net_income_key, dt]
                if v is not None and not (isinstance(v, float) and math.isnan(v)):
                    net_income = float(v)

            roe = 0.0
            for key in equity_keys:
                if key in bs.index and dt in bs.columns:
                    equity_v = bs.loc[key, dt]
                    if equity_v is not None and not (isinstance(equity_v, float) and math.isnan(equity_v)):
                        equity_f = float(equity_v)
                        if equity_f != 0 and net_income is not None:
                            roe = round(net_income / abs(equity_f) * 100, 1)
                    break

            roic = 0.0
            for key in assets_keys:
                if key in bs.index and dt in bs.columns:
                    assets_v = bs.loc[key, dt]
                    if assets_v is not None and not (isinstance(assets_v, float) and math.isnan(assets_v)):
                        assets_f = float(assets_v)
                        if assets_f != 0 and net_income is not None:
                            roic = round(net_income / abs(assets_f) * 100, 1)
                    break

            results.append({"t": t_ms, "roe": roe, "roic": roic, "per": per_const})
        except Exception:
            continue

    if not results:
        return None

    results.sort(key=lambda x: x["t"])
    return results[-20:]


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
