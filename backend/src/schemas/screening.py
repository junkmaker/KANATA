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
