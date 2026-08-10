"""スクリーニングのエンドポイント(パターン別の結果・共通スキャン・ユニバース管理)。

macro.py と同じく生オブジェクトを返す(エンベロープ無し)。真実源はパターン別の
JSON ファイルで、GET は常にキャッシュ済み結果を返す。スキャンは POST で
バックグラウンド起動し、進捗は status でポーリングする。ユニバースは
universe_provider が管理し、カスタム例外をここで HTTPException に変換する。

**スキャン・ステータスからパターン名を外してある**。ジョブは 1 本で全パターンを
同時に処理するため、``/n-pattern/scan`` という名前は嘘になる(代償として
「N字だけスキャンし直す」はできない — docs/ppp_screening_spec.md 決定#7)。

結果 GET はパターンごとに**明示ルートを並べる**。``/screening/{pattern}`` の
パス引数にしない理由は 2 つ: (1) response_model がパターン別の型なので、パス引数
だとユニオンを返すことになり OpenAPI が壊れる。(2) FastAPI は宣言順でマッチする
ため、``/screening/{pattern}`` を先に置くと ``/screening/universes`` や
``/screening/status`` が pattern="universes" として吸われる。**URL と外部から
見た挙動(未知パターンは 404)は同一**。
"""
from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException

from ..schemas.screening import (
    PppResultsResponse,
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
def get_n_pattern():
    """キャッシュ済みのスキャン結果をそのまま返す(ブレイク日の新しい順)。

    ``min_score`` クエリは廃止した。スコアに前方リターンの予測力が無いことが
    バックテストで確定しており(§16.2)、スコアでの絞り込みは実測の裏付けが無い
    期待値の含意を持ち込むため。絞り込みは表示側が ``break_date`` の鮮度で行う。

    ``score`` / ``score_detail`` はレスポンスに残す — 表示しないだけで、
    再検証の経路(閾値を戻して測り直す)を潰さないため。
    """
    return screening_provider.load_results(screening_provider.N_PATTERN)


@router.get("/screening/ppp", response_model=PppResultsResponse)
def get_ppp():
    """キャッシュ済みの PPP スキャン結果をそのまま返す(成立日の新しい順)。

    銘柄ごとに**最新の成立イベント 1 件**だけが入っている。鮮度の打ち切りは
    しない — バックエンドで切ると「なぜ出ないのか」が JSON を見ても分からなく
    なるため、絞り込みは表示側が established_date の鮮度で行う
    (docs/ppp_screening_spec.md §5.2)。

    乖離値は含めない。検出条件そのもので、同じ df から常に再計算できる。
    """
    return screening_provider.load_results(screening_provider.PPP_PATTERN)


@router.post("/screening/scan", status_code=202, response_model=ScanStartResponse)
def start_scan(req: ScanStartRequest | None = Body(default=None)):
    """スキャンをバックグラウンド起動する。**1 ジョブで全パターンを実行する。**"""
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


@router.get("/screening/status", response_model=ScanStatusResponse)
def get_scan_status():
    """共通スキャンジョブの進捗。done/total は銘柄単位(パターン非依存)。"""
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
