"""Pydantic schemas for watchlist endpoints."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class WatchlistItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    symbol: str
    market: str
    display_name: str | None = None
    position: int


class WatchlistRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    position: int
    is_default: int
    created_at: datetime
    updated_at: datetime
    items: list[WatchlistItemRead] = []


class WatchlistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)


class WatchlistUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    is_default: bool | None = None


class WatchlistItemCreate(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    market: str = Field(default="US", min_length=1, max_length=16)
    display_name: str | None = Field(default=None, max_length=128)


class ReorderRequest(BaseModel):
    ids: list[int] = Field(default_factory=list)


class ItemReorderRequest(BaseModel):
    symbols: list[str] = Field(default_factory=list)
