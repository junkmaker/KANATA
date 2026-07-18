"""N字スクリーニングのエンドポイント(結果・スキャン・ユニバース管理)。

macro.py と同じく生オブジェクトを返す(エンベロープ無し)。真実源は JSON ファイルで、
GET は常にキャッシュ済み結果を返す。スキャンは POST でバックグラウンド起動し、
進捗は status でポーリングする。ユニバースは universe_provider が管理し、
カスタム例外をここで HTTPException に変換する。
"""
from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException, Query

from ..schemas.screening import (
    ScanStartRequest,
    ScanStartResponse,
    ScanStatusResponse,
    ScreeningResultsResponse,
    UniverseCreateRequest,
    UniverseDeleteResponse,
    UniverseInfo,
    UniverseListResponse,
)
from ..services import screening_provider, universe_provider

router = APIRouter()


@router.get("/screening/n-pattern", response_model=ScreeningResultsResponse)
def get_n_pattern(min_score: int = Query(default=50)):
    data = screening_provider.load_results()
    results = [r for r in data.get("results", []) if r.get("score", 0) >= min_score]
    return {**data, "results": results}


@router.post("/screening/n-pattern/scan", status_code=202, response_model=ScanStartResponse)
def start_n_pattern_scan(req: ScanStartRequest | None = Body(default=None)):
    # 既存クライアントはボディ無しで POST するため Body(default=None) 必須。
    universe_id = req.universe_id if req else None
    try:
        universe = universe_provider.resolve_universe(universe_id)
    except universe_provider.UniverseNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    started = screening_provider.start_scan_thread(
        csv_path=universe["csv_path"],
        universe_id=universe["id"],
        universe_name=universe["name"],
    )
    if not started:
        raise HTTPException(status_code=409, detail="scan already running")
    return {"status": "started"}


@router.get("/screening/n-pattern/status", response_model=ScanStatusResponse)
def get_n_pattern_status():
    return screening_provider.get_scan_status()


@router.get("/screening/universes", response_model=UniverseListResponse)
def list_universes():
    return {"universes": universe_provider.list_universes()}


@router.post("/screening/universes", status_code=201, response_model=UniverseInfo)
def create_universe(req: UniverseCreateRequest):
    try:
        return universe_provider.register_universe(req.name, req.csv_text)
    except universe_provider.DuplicateUniverseName as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except universe_provider.UniverseValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/screening/universes/{universe_id}", response_model=UniverseDeleteResponse)
def delete_universe(universe_id: str):
    try:
        universe_provider.delete_universe(universe_id)
    except universe_provider.BuiltinUniverseError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except universe_provider.UniverseNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"status": "deleted"}
