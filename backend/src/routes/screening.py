"""N字スクリーニングのエンドポイント(3本)。

macro.py と同じく生オブジェクトを返す(エンベロープ無し)。真実源は JSON ファイルで、
GET は常にキャッシュ済み結果を返す。スキャンは POST でバックグラウンド起動し、
進捗は status でポーリングする。
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..schemas.screening import (
    ScanStartResponse,
    ScanStatusResponse,
    ScreeningResultsResponse,
)
from ..services import screening_provider

router = APIRouter()


@router.get("/screening/n-pattern", response_model=ScreeningResultsResponse)
def get_n_pattern(min_score: int = Query(default=50)):
    data = screening_provider.load_results()
    results = [r for r in data.get("results", []) if r.get("score", 0) >= min_score]
    return {**data, "results": results}


@router.post("/screening/n-pattern/scan", status_code=202, response_model=ScanStartResponse)
def start_n_pattern_scan():
    started = screening_provider.start_scan_thread()
    if not started:
        raise HTTPException(status_code=409, detail="scan already running")
    return {"status": "started"}


@router.get("/screening/n-pattern/status", response_model=ScanStatusResponse)
def get_n_pattern_status():
    return screening_provider.get_scan_status()
