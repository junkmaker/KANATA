"""Macro indicator computation: unit conversion, weekly resampling, net
liquidity, RSP/SPY inner join, and signal evaluation.

All builders return plain dicts shaped like the §6 API response contract so the
route layer can return them directly. FRED-derived indicators (HY OAS, net
liquidity) degrade to an ``available: false`` response when ``FRED_API_KEY`` is
missing; RSP/SPY (yfinance) keeps working (partial availability).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Literal

from ..config.macro_config import load_macro_config
from .fred_provider import MissingFredKey, fetch_fred_series
from .yfinance_provider import fetch_ohlcv

logger = logging.getLogger(__name__)

Signal = Literal["green", "yellow", "red", "gray"]

# Descriptive threshold text surfaced to the UI (§6 thresholds field).
_THRESHOLD_TEXT: dict[str, dict[str, Any]] = {
    "hy_oas": {"green_max": None, "yellow_band": "20営業日で +50bp 拡大", "red": "直近高値更新/急拡大"},
    "net_liquidity": {"green_max": None, "yellow_band": "下降トレンド入り", "red": "直近安値割れ"},
    "rsp_spy": {"green_max": None, "yellow_band": "直近安値接近", "red": "直近安値割れ"},
}


# --------------------------------------------------------------------------- #
# Small numeric helpers
# --------------------------------------------------------------------------- #
def _date_to_ms(date_str: str) -> int:
    return int(datetime.strptime(date_str, "%Y-%m-%d").timestamp() * 1000)


def _ms_to_date(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def _as_of(observations_sorted: list[dict], target_date: str) -> float | None:
    """Forward-fill: value of the last observation with date <= target_date."""
    result: float | None = None
    for o in observations_sorted:
        if o["date"] <= target_date:
            result = o["value"]
        else:
            break
    return result


def _latest_block(series: list[dict], provisional: bool) -> dict | None:
    if not series:
        return None
    last = series[-1]
    change = None
    if len(series) >= 2:
        change = round(last["value"] - series[-2]["value"], 6)
    return {
        "date": last["date"],
        "value": last["value"],
        "change": change,
        "provisional": provisional,
    }


def _indicator(
    *,
    key: str,
    indicator: str,
    unit: str,
    lens: str,
    series: list[dict],
    signal: Signal,
    source: str,
    stale: bool,
    available: bool,
    provisional: bool,
) -> dict:
    return {
        "indicator": indicator,
        "unit": unit,
        "lens": lens,
        "signal": signal,
        "latest": _latest_block(series, provisional),
        "thresholds": _THRESHOLD_TEXT.get(key, {}),
        "series": series,
        "meta": {"source": source, "stale": stale, "available": available},
    }


def _unavailable(*, key: str, indicator: str, unit: str, lens: str, source: str) -> dict:
    return _indicator(
        key=key,
        indicator=indicator,
        unit=unit,
        lens=lens,
        series=[],
        signal="gray",
        source=source,
        stale=False,
        available=False,
        provisional=False,
    )


# --------------------------------------------------------------------------- #
# Signal evaluation (§7 rules, thresholds from config)
# --------------------------------------------------------------------------- #
def evaluate_signal(indicator_key: str, series: list[dict], cfg: dict) -> Signal:
    values = [p["value"] for p in series]
    if len(values) < 2:
        return "green"

    thresholds = cfg.get("thresholds", {})
    latest = values[-1]

    if indicator_key == "hy_oas":
        t = thresholds.get("hy_oas", {})
        red_n = int(t.get("red_lookback_points", 60))
        yellow_n = int(t.get("yellow_lookback_points", 20))
        widen_bp = float(t.get("yellow_widening_bp", 50.0))
        red_window = values[-red_n:]
        if latest >= max(red_window):
            return "red"
        ref = values[-(yellow_n + 1)] if len(values) > yellow_n else values[0]
        if latest - ref >= widen_bp:
            return "yellow"
        return "green"

    if indicator_key == "net_liquidity":
        t = thresholds.get("net_liquidity", {})
        red_n = int(t.get("red_lookback_points", 26))
        yellow_n = int(t.get("yellow_lookback_points", 8))
        red_window = values[-red_n:]
        if latest <= min(red_window):
            return "red"
        ref = values[-(yellow_n + 1)] if len(values) > yellow_n else values[0]
        if latest < ref:
            return "yellow"
        return "green"

    if indicator_key == "rsp_spy":
        t = thresholds.get("rsp_spy", {})
        low_n = int(t.get("low_lookback_points", 60))
        near_pct = float(t.get("near_low_pct", 2.0))
        low_window = values[-low_n:]
        recent_low = min(low_window)
        if latest <= recent_low:
            return "red"
        if recent_low > 0 and (latest - recent_low) / recent_low * 100.0 <= near_pct:
            return "yellow"
        return "green"

    return "green"


# --------------------------------------------------------------------------- #
# Builders
# --------------------------------------------------------------------------- #
def build_hy_oas(start: str, end: str, cfg: dict | None = None) -> dict:
    cfg = cfg or load_macro_config()
    series_id = cfg["series"]["hy_oas"]
    try:
        observations = fetch_fred_series(series_id, start, end)
    except MissingFredKey:
        return _unavailable(
            key="hy_oas", indicator="hy_oas", unit="bp", lens="liquidity", source="FRED"
        )

    # FRED returns percent; display unit is basis points (×100).
    series = [
        {"date": o["date"], "value": round(o["value"] * 100.0, 2)}
        for o in sorted(observations, key=lambda x: x["date"])
    ]
    stale = not series
    signal = evaluate_signal("hy_oas", series, cfg) if series else "gray"
    return _indicator(
        key="hy_oas",
        indicator="hy_oas",
        unit="bp",
        lens="liquidity",
        series=series,
        signal=signal,
        source="FRED",
        stale=stale,
        available=True,
        provisional=False,
    )


def build_net_liquidity(start: str, end: str, cfg: dict | None = None) -> dict:
    cfg = cfg or load_macro_config()
    s = cfg["series"]
    try:
        walcl = fetch_fred_series(s["walcl"], start, end)  # millions USD, weekly
        rrp = fetch_fred_series(s["rrp"], start, end)       # billions USD, daily
        tga = fetch_fred_series(s["tga"], start, end)       # billions USD, weekly
    except MissingFredKey:
        return _unavailable(
            key="net_liquidity",
            indicator="net_liquidity",
            unit="USD_trillion",
            lens="liquidity",
            source="FRED",
        )

    walcl_s = sorted(walcl, key=lambda x: x["date"])
    rrp_s = sorted(rrp, key=lambda x: x["date"])
    tga_s = sorted(tga, key=lambda x: x["date"])

    series: list[dict] = []
    # Weekly grid driven by WALCL (weekly, Wednesday); forward-fill RRP/TGA.
    for w in walcl_s:
        date = w["date"]
        walcl_billion = w["value"] / 1000.0  # millions -> billions (unit fix)
        rrp_v = _as_of(rrp_s, date)
        tga_v = _as_of(tga_s, date)
        if rrp_v is None or tga_v is None:
            continue
        net_billion = walcl_billion - rrp_v - tga_v
        net_trillion = net_billion / 1000.0  # billions -> trillions
        series.append({"date": date, "value": round(net_trillion, 4)})

    stale = not series
    signal = evaluate_signal("net_liquidity", series, cfg) if series else "gray"
    return _indicator(
        key="net_liquidity",
        indicator="net_liquidity",
        unit="USD_trillion",
        lens="liquidity",
        series=series,
        signal=signal,
        source="FRED",
        stale=stale,
        available=True,
        provisional=bool(series),
    )


def build_rsp_spy(start: str, end: str, cfg: dict | None = None) -> dict:
    cfg = cfg or load_macro_config()
    # yfinance 障害（ネットワーク/レート制限/パースエラー）が build_dashboard まで
    # 伝播して全カードを 502 で落とすのを防ぎ、この指標だけ unavailable に degrade する。
    try:
        rsp = fetch_ohlcv("RSP", "1D")
        spy = fetch_ohlcv("SPY", "1D")
    except Exception as exc:  # noqa: BLE001 - yfinance は多様な例外を投げ得る
        logger.warning("RSP/SPY fetch failed: %s", exc)
        return _unavailable(
            key="rsp_spy",
            indicator="rsp_spy",
            unit="ratio",
            lens="momentum",
            source="yfinance",
        )

    rsp_by_t = {b["t"]: b["c"] for b in rsp}
    spy_by_t = {b["t"]: b["c"] for b in spy}

    start_ms = _date_to_ms(start)
    end_ms = _date_to_ms(end) + 86_400_000  # inclusive of the end day

    series: list[dict] = []
    for t in sorted(set(rsp_by_t) & set(spy_by_t)):  # inner join on timestamp
        if t < start_ms or t > end_ms:
            continue
        spy_close = spy_by_t[t]
        if spy_close == 0:
            continue
        ratio = rsp_by_t[t] / spy_close
        series.append({"date": _ms_to_date(t), "value": round(ratio, 6)})

    available = bool(series)
    signal = evaluate_signal("rsp_spy", series, cfg) if series else "gray"
    return _indicator(
        key="rsp_spy",
        indicator="rsp_spy",
        unit="ratio",
        lens="momentum",
        series=series,
        signal=signal,
        source="yfinance",
        stale=False,
        available=available,
        provisional=False,
    )


def _overall_signal(indicators: list[dict], cfg: dict) -> Signal:
    rule = cfg.get("overall", {})
    available_signals = [i["signal"] for i in indicators if i["meta"].get("available")]
    if not available_signals:
        return "gray"
    if rule.get("red_if_any_red", True) and "red" in available_signals:
        return "red"
    yellow_gte = int(rule.get("yellow_if_yellow_count_gte", 2))
    if available_signals.count("yellow") >= yellow_gte:
        return "yellow"
    return "green"


def build_dashboard(start: str, end: str, cfg: dict | None = None) -> dict:
    cfg = cfg or load_macro_config()
    indicators = [
        build_hy_oas(start, end, cfg),
        build_net_liquidity(start, end, cfg),
        build_rsp_spy(start, end, cfg),
    ]
    return {
        "overall_signal": _overall_signal(indicators, cfg),
        "indicators": indicators,
    }
