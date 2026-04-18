"""Common API envelope used by watchlist routes."""
from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    success: bool = True
    data: T | None = None
    error: str | None = None


def ok(data: T) -> dict:
    return {"success": True, "data": data, "error": None}


def fail(message: str) -> dict:
    return {"success": False, "data": None, "error": message}
