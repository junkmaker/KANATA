"""Pydantic schemas for the macro dashboard endpoints (§6 contract).

Builders in ``services.macro_provider`` produce plain dicts; these models are
used as ``response_model`` for OpenAPI quality and validation. Dates are ISO
strings and values stay numeric (never stringified).
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel

Signal = Literal["green", "yellow", "red", "gray"]


class SeriesPoint(BaseModel):
    date: str
    value: float


class LatestPoint(BaseModel):
    date: str
    value: float
    change: float | None = None
    provisional: bool = False


class IndicatorMeta(BaseModel):
    source: str
    stale: bool = False
    available: bool = True


class IndicatorResponse(BaseModel):
    indicator: str
    unit: str
    lens: str
    signal: Signal
    latest: LatestPoint | None = None
    thresholds: dict[str, Any] = {}
    series: list[SeriesPoint] = []
    meta: IndicatorMeta


class DashboardResponse(BaseModel):
    overall_signal: Signal
    indicators: list[IndicatorResponse]
