"""Macro indicator computation: unit conversion, weekly resampling, net
liquidity, RSP/SPY inner join, and signal evaluation.

All builders return plain dicts shaped like the §6 API response contract so the
route layer can return them directly. FRED-derived indicators (HY OAS, net
liquidity) degrade to an ``available: false`` response when ``FRED_API_KEY`` is
missing; RSP/SPY (yfinance) keeps working (partial availability).
"""
from __future__ import annotations

import logging
import statistics
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
    "t10y2y": {"green_max": None, "yellow_band": "0〜+50bp", "red": "0未満（逆イールド）"},
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


def _despike(closes: dict[str, float], cfg: dict, symbol: str) -> dict[str, float]:
    """日次終値からベンダー由来の外れ値（スケール異常）を除去する。

    ローリング中央値を使う理由: yfinance は分割イベントを伴わずに数日分の終値だけ
    1/10 になる異常値を返すことがある（例: 1306.T の 2026-03-30/31）。1 点でも比率
    系列に混ざると UI の min/max オートスケールが潰れ、その期間のチャートが読めなく
    なる。窓中央値なら「一時的なスパイク」だけを落とし、恒久的な水準変化（分割の
    未調整など）では中央値も一緒に移動するため誤検出しない。

    除去した日は系列から欠落させるだけで、補間による値の捏造はしない。

    既知の限界（価格系列のみから統計的に判定するアルゴリズム全般に共通する制約）:
    - 窓半径 (`spike_window_half_points`) を超える日数にわたって異常が連続すると、
      窓内の中央値ごと異常値側に引きずられて検出漏れになる。ウィンドウ幅を広げると
      恒久的な水準変化（分割未調整など）を誤検出するリスクとのトレードオフになる
      ため、この既知の限界は自動では解消しない（該当時はログの dropped 件数・
      日付から手動で確認する）。
    - ゼロ近傍だが正の値（例: WTI が実際に数セントまで急落する事態）は、ベンダーの
      スケール異常と統計的に同じ特徴（局所中央値からの極端な比率乖離）を持つため
      価格データのみからは原理的に区別できない。意図的に許容している既知の
      トレードオフであり、将来的に解消する場合は別データソースでの裏取りが必要。
    """
    s = cfg.get("sanitize", {})
    if not s.get("enabled", True):
        return closes

    half = int(s.get("spike_window_half_points", 5))
    factor = float(s.get("spike_ratio_factor", 3.0))
    dates = sorted(closes)
    # 窓を満たせない短い系列（テスト用モックや取得直後）はそのまま通す。
    if half < 1 or factor <= 1.0 or len(dates) < 2 * half + 1:
        return closes

    values = [closes[d] for d in dates]
    kept: dict[str, float] = {}
    dropped: list[str] = []
    for i, d in enumerate(dates):
        window = values[max(0, i - half) : i + half + 1]
        median = statistics.median(window)
        value = values[i]
        # 非正値（原油の逆転など）は比率判定できないため常に残す。
        if median <= 0 or value <= 0:
            kept[d] = value
            continue
        ratio = value / median
        if ratio > factor or ratio < 1.0 / factor:
            dropped.append(d)
            continue
        kept[d] = value

    if dropped:
        logger.warning(
            "%s: dropped %d outlier close(s) (factor=%s): %s",
            symbol,
            len(dropped),
            factor,
            ",".join(dropped[:10]),
        )
    return kept


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
    if not values:
        return "green"

    thresholds = cfg.get("thresholds", {})
    latest = values[-1]

    if indicator_key == "t10y2y":
        # 水準そのもので判定する（直近 N 点の高値/安値は参照しない）。0 は統計的に
        # 決めた閾値ではなく「短期金利 > 長期金利」という定義上の境界（逆イールド）。
        # green_min_bp は仮置きの値で、根拠となる検証は無い（docs/macro_t10y2y_spec.md §2）。
        #
        # 他指標が使う「2 点未満は green」の早期 return より前に置く。あちらは前後比較が
        # 前提で 1 点では何も計算できないが、水準判定は 1 点あれば正しく答えられるため、
        # 早期 return の後ろに置くと -80bp の単点が green になってしまう。
        t = thresholds.get("t10y2y", {})
        if latest < float(t.get("red_max_bp", 0.0)):
            return "red"
        if latest > float(t.get("green_min_bp", 50.0)):
            return "green"
        return "yellow"

    if len(values) < 2:
        return "green"

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


def build_t10y2y(start: str, end: str, cfg: dict | None = None) -> dict:
    """米10年債利回り − 米2年債利回り（イールドカーブ）。表示専用指標。

    build_hy_oas と同型（FRED 単系列 → ×100 → 水準判定）。マイナスは逆イールドで、
    一度入ると 1〜2 年継続するため red に張り付くが、これは指標の故障ではなく事実の
    正しい反映（docs/macro_t10y2y_spec.md §2）。表示専用のため総合シグナルは汚さない。
    """
    cfg = cfg or load_macro_config()
    series_id = cfg["series"]["t10y2y"]
    try:
        observations = fetch_fred_series(series_id, start, end)
    except MissingFredKey:
        return _unavailable(
            key="t10y2y", indicator="t10y2y", unit="bp", lens="rates", source="FRED"
        )

    # FRED returns percent; display unit is basis points (×100).
    series = [
        {"date": o["date"], "value": round(o["value"] * 100.0, 2)}
        for o in sorted(observations, key=lambda x: x["date"])
    ]
    stale = not series
    signal = evaluate_signal("t10y2y", series, cfg) if series else "gray"
    return _indicator(
        key="t10y2y",
        indicator="t10y2y",
        unit="bp",
        lens="rates",
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

    外れ値方針: 取得後に _despike でベンダー由来のスケール異常を落としてから結合する。
    """
    try:
        a_raw = fetch_daily_closes(num_symbol)
        b_raw = fetch_daily_closes(den_symbol)
    except Exception as exc:  # noqa: BLE001 - yfinance は多様な例外を投げ得る
        logger.warning("%s fetch failed: %s", key, exc)
        return _unavailable(key=key, indicator=key, unit=unit, lens=lens, source="yfinance")

    # ベンダー由来のスケール異常を inner join 前に除去する（両系列に適用）。
    a = _despike(a_raw, cfg, num_symbol)
    b = _despike(b_raw, cfg, den_symbol)

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

    # _despike が直近日を外れ値として落とすと、系列の最新日が実際に両銘柄で取得
    # できていた最新の共通取引日より古くなる。その場合は latest が「本当の最新値」
    # ではないことを stale=True でクライアントに伝える。
    raw_common_dates = [d for d in (set(a_raw) & set(b_raw)) if start_d <= d <= end_d]
    latest_raw_date = max(raw_common_dates) if raw_common_dates else None
    latest_series_date = series[-1]["date"] if series else None
    stale = latest_raw_date is not None and latest_raw_date != latest_series_date

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
        stale=stale,
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
    # 総合シグナルは米国流動性の既存3指標のみで算出する。日本株/原油/イールドカーブの
    # 追加4指標は表示専用で overall_signal には寄与させない（意味論を汚さないため）。
    core = [
        build_hy_oas(start, end, cfg),
        build_net_liquidity(start, end, cfg),
        build_rsp_spy(start, end, cfg),
    ]
    extras = [
        build_nikkei_sp(start, end, cfg),
        build_nikkei_topix(start, end, cfg),
        build_brent_wti(start, end, cfg),
        build_t10y2y(start, end, cfg),
    ]
    return {
        "overall_signal": _overall_signal(core, cfg),  # 既存3指標のみ
        "indicators": core + extras,
    }
