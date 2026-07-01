"""Macro indicator computation: unit conversion, weekly resampling, net
liquidity, RSP/SPY inner join, and signal evaluation.

All builders return plain dicts shaped like the §6 API response contract so the
route layer can return them directly. FRED-derived indicators (HY OAS, net
liquidity) degrade to an ``available: false`` response when ``FRED_API_KEY`` is
missing; RSP/SPY (yfinance) keeps working (partial availability).
"""
from __future__ import annotations

import logging
from typing import Any, Literal

from ..config.macro_config import load_macro_config
from .fred_provider import MissingFredKey, fetch_fred_series
from .yfinance_provider import fetch_daily_closes

logger = logging.getLogger(__name__)

Signal = Literal["green", "yellow", "red", "gray"]

# Descriptive threshold text surfaced to the UI (§6 thresholds field).
_THRESHOLD_TEXT: dict[str, dict[str, Any]] = {
    "hy_oas": {"green_max": None, "yellow_band": "20営業日で +50bp 拡大", "red": "直近高値更新/急拡大"},
    "net_liquidity": {"green_max": None, "yellow_band": "下降トレンド入り", "red": "直近安値割れ"},
    "rsp_spy": {"green_max": None, "yellow_band": "直近安値接近", "red": "直近安値割れ"},
    "nikkei_sp": {"green_max": None, "yellow_band": "中期下降トレンド", "red": "直近安値割れ"},
    "nikkei_topix": {"green_max": None, "yellow_band": "中期下降トレンド", "red": "直近安値割れ"},
    "brent_wti": {"green_max": None, "yellow_band": "正常帯($1.5〜7)外", "red": "逆転/極端拡大"},
}


# --------------------------------------------------------------------------- #
# Small numeric helpers
# --------------------------------------------------------------------------- #
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

    if indicator_key in ("nikkei_sp", "nikkei_topix"):
        # 上昇=良好トレンド。直近安値割れ→red、中期参照点より低い→yellow、else green。
        t = thresholds.get(indicator_key, {})
        low_n = int(t.get("low_lookback_points", 26))
        down_n = int(t.get("downtrend_lookback_points", 8))
        if latest <= min(values[-low_n:]):
            return "red"
        ref = values[-(down_n + 1)] if len(values) > down_n else values[0]
        if latest < ref:
            return "yellow"
        return "green"

    if indicator_key == "brent_wti":
        # 正常帯（$1.5〜7）内が green、帯外は yellow、逆転($0以下)/極端拡大($10以上)は red。
        t = thresholds.get("brent_wti", {})
        if latest <= float(t.get("red_inversion_max", 0.0)) or latest >= float(
            t.get("red_extreme_min", 10.0)
        ):
            return "red"
        if latest < float(t.get("green_band_min", 1.5)) or latest > float(
            t.get("green_band_max", 7.0)
        ):
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
    return _build_pair(
        key="rsp_spy",
        num_symbol="RSP",
        den_symbol="SPY",
        unit="ratio",
        lens="momentum",
        op="ratio",
        cfg=cfg,
        start=start,
        end=end,
    )


def _build_pair(
    *,
    key: str,
    num_symbol: str,
    den_symbol: str,
    unit: str,
    lens: str,
    op: str,
    cfg: dict,
    start: str,
    end: str,
) -> dict:
    """2 銘柄の日次終値を取引所ローカル暦日で inner join し、比率(ratio)/差(diff)で系列化する。

    エポック完全一致ではなくローカル暦日で結合する理由: 日経225(東京)と S&P500(NY) の
    ように取引所タイムゾーンが異なるペアは、同じ取引日でも日足バーのエポックが不一致に
    なり、タイムスタンプ結合では系列が空（＝取得不可）になる。各バー自身のローカル暦日
    （fetch_daily_closes のキー）で結合すれば同/異タイムゾーンを問わず正しく対応できる。

    degrade 方針: yfinance 障害（ネットワーク/レート制限/パースエラー）は例外を握って
    この指標だけ unavailable に落とし、build_dashboard 全体が 502 になるのを防ぐ。
    """
    try:
        a = fetch_daily_closes(num_symbol)
        b = fetch_daily_closes(den_symbol)
    except Exception as exc:  # noqa: BLE001 - yfinance は多様な例外を投げ得る
        logger.warning("%s fetch failed: %s", key, exc)
        return _unavailable(key=key, indicator=key, unit=unit, lens=lens, source="yfinance")

    start_d = start[:10]
    end_d = end[:10]

    series: list[dict] = []
    for d in sorted(set(a) & set(b)):  # inner join on local trading-day date
        if d < start_d or d > end_d:  # ISO date strings compare lexicographically
            continue
        bv = b[d]
        if op == "ratio":
            if bv == 0:
                continue
            value = round(a[d] / bv, 6)
        else:  # "diff"
            value = round(a[d] - bv, 4)
        series.append({"date": d, "value": value})

    available = bool(series)
    signal = evaluate_signal(key, series, cfg) if series else "gray"
    return _indicator(
        key=key,
        indicator=key,
        unit=unit,
        lens=lens,
        series=series,
        signal=signal,
        source="yfinance",
        stale=False,
        available=available,
        provisional=False,
    )


def build_nikkei_sp(start: str, end: str, cfg: dict | None = None) -> dict:
    cfg = cfg or load_macro_config()
    s = cfg["series"]
    return _build_pair(
        key="nikkei_sp",
        num_symbol=s["nikkei"],
        den_symbol=s["sp500"],
        unit="ratio",
        lens="momentum",
        op="ratio",
        cfg=cfg,
        start=start,
        end=end,
    )


def build_nikkei_topix(start: str, end: str, cfg: dict | None = None) -> dict:
    cfg = cfg or load_macro_config()
    s = cfg["series"]
    return _build_pair(
        key="nikkei_topix",
        num_symbol=s["nikkei"],
        den_symbol=s["topix_etf"],
        unit="ratio",
        lens="momentum",
        op="ratio",
        cfg=cfg,
        start=start,
        end=end,
    )


def build_brent_wti(start: str, end: str, cfg: dict | None = None) -> dict:
    cfg = cfg or load_macro_config()
    s = cfg["series"]
    return _build_pair(
        key="brent_wti",
        num_symbol=s["brent"],
        den_symbol=s["wti"],
        unit="usd_bbl",
        lens="momentum",
        op="diff",
        cfg=cfg,
        start=start,
        end=end,
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
    # 総合シグナルは米国流動性の既存3指標のみで算出する。日本株/原油の追加3指標は
    # 表示専用で overall_signal には寄与させない（意味論を汚さないため）。
    core = [
        build_hy_oas(start, end, cfg),
        build_net_liquidity(start, end, cfg),
        build_rsp_spy(start, end, cfg),
    ]
    extras = [
        build_nikkei_sp(start, end, cfg),
        build_nikkei_topix(start, end, cfg),
        build_brent_wti(start, end, cfg),
    ]
    return {
        "overall_signal": _overall_signal(core, cfg),  # 既存3指標のみ
        "indicators": core + extras,
    }
