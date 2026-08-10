"""Pydantic v2 schemas for the N-pattern screening endpoints.

Builders in ``services.screening_provider`` produce plain dicts; these models are
used as ``response_model`` for OpenAPI quality. Dates are ISO strings, values stay
numeric. Macro 系と同じく生オブジェクトを返す({success,data,error} エンベロープ無し)。
"""
from __future__ import annotations

from pydantic import BaseModel


class ScreeningPivot(BaseModel):
    index: int
    date: str
    price: float
    type: str


class ScoreDetail(BaseModel):
    trend: int
    breakout: int
    volume: int
    macd: int
    pullback_penalty: int
    duration_penalty: int


class ClosePoint(BaseModel):
    date: str
    value: float


class ScreeningResult(BaseModel):
    ticker: str
    name: str
    market_cap: int | None = None
    # スキャン実施日時点の時価総額(発行済株式数 × 最終日足終値)と、その基準日。
    # market_cap はユニバース CSV の登録値で、足切りフィルタとフォールバック表示に使う。
    # 既定 None は後方互換のため必須 — 旧バージョンが書いた結果 JSON にこの
    # フィールドが無く、response_model の検証時に null が埋まることに依存している。
    market_cap_asof: int | None = None
    market_cap_date: str | None = None
    score: int
    score_detail: ScoreDetail
    pivots: list[ScreeningPivot]
    break_date: str
    closes: list[ClosePoint] = []


class ScreeningResultsResponse(BaseModel):
    generated_at: str | None = None
    universe_count: int = 0
    scanned_count: int = 0
    universe_id: str | None = None
    universe_name: str | None = None
    results: list[ScreeningResult] = []


class PppResult(BaseModel):
    ticker: str
    name: str
    market_cap: int | None = None
    market_cap_asof: int | None = None
    market_cap_date: str | None = None
    # 成立イベント日(out -> in の遷移バー)。銘柄ごとに**最新の 1 件**だけを持つ。
    established_date: str
    # 成立日から最終バーまでの経過**本数**(暦日ではない)。JSON には持つが列には
    # しない — 成立日と 1 対 1 の情報で、鮮度フィルタが既に同じ軸を扱っているため。
    # 検証時に群分けの材料として使う。
    duration_days: int
    closes: list[ClosePoint] = []
    # 乖離値(gap_short / gap_long)は**持たない**。N字がスコアを残したのは
    # 「閾値を戻して測り直す」経路を潰さないためだが、PPP の乖離は検出条件そのもの
    # なので同じ df から常に再計算でき、保存する必要がない。出すと大小比較が始まる。


class PppResultsResponse(BaseModel):
    generated_at: str | None = None
    universe_count: int = 0
    scanned_count: int = 0
    universe_id: str | None = None
    universe_name: str | None = None
    results: list[PppResult] = []


class ScanStatusResponse(BaseModel):
    status: str
    done: int
    total: int
    started_at: str | None = None
    error: str | None = None


class ScanStartResponse(BaseModel):
    status: str


class ScanStartRequest(BaseModel):
    universe_id: str | None = None


class UniverseInfo(BaseModel):
    id: str
    name: str
    symbol_count: int
    has_market_cap: bool
    created_at: str | None = None
    builtin: bool = False


class UniverseListResponse(BaseModel):
    universes: list[UniverseInfo] = []


class UniverseCreateRequest(BaseModel):
    name: str
    csv_text: str


class UniverseDeleteResponse(BaseModel):
    status: str
