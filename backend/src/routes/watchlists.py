"""Watchlist CRUD + ordering routes.

All endpoints scope to user_id='local' for the single-user local terminal.
Responses use the shared {success, data, error} envelope.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..db.database import get_db
from ..db.models import Watchlist, WatchlistItem
from ..schemas.common import fail, ok
from ..schemas.watchlist import (
    ItemReorderRequest,
    ReorderRequest,
    WatchlistCreate,
    WatchlistItemCreate,
    WatchlistRead,
    WatchlistUpdate,
)

router = APIRouter()
USER_ID = "local"


def _serialize(wl: Watchlist) -> dict:
    return WatchlistRead.model_validate(wl).model_dump(mode="json")


def _load_all(db: Session) -> list[Watchlist]:
    stmt = (
        select(Watchlist)
        .where(Watchlist.user_id == USER_ID)
        .options(selectinload(Watchlist.items))
        .order_by(Watchlist.position, Watchlist.id)
    )
    return list(db.execute(stmt).scalars().all())


def _get_or_404(db: Session, list_id: int) -> Watchlist:
    wl = db.get(Watchlist, list_id)
    if wl is None or wl.user_id != USER_ID:
        raise HTTPException(status_code=404, detail="watchlist not found")
    return wl


def _next_list_position(db: Session) -> int:
    max_pos = db.execute(
        select(Watchlist.position)
        .where(Watchlist.user_id == USER_ID)
        .order_by(Watchlist.position.desc())
        .limit(1)
    ).scalar()
    return (max_pos or 0) + 1 if max_pos is not None else 0


def _next_item_position(db: Session, list_id: int) -> int:
    max_pos = db.execute(
        select(WatchlistItem.position)
        .where(WatchlistItem.watchlist_id == list_id)
        .order_by(WatchlistItem.position.desc())
        .limit(1)
    ).scalar()
    return (max_pos or 0) + 1 if max_pos is not None else 0


@router.get("/watchlists")
def list_watchlists(db: Session = Depends(get_db)):
    rows = _load_all(db)
    return ok([_serialize(w) for w in rows])


@router.post("/watchlists", status_code=201)
def create_watchlist(payload: WatchlistCreate, db: Session = Depends(get_db)):
    wl = Watchlist(
        user_id=USER_ID,
        name=payload.name.strip(),
        position=_next_list_position(db),
        is_default=0,
    )
    db.add(wl)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="watchlist name already exists")
    db.refresh(wl)
    return ok(_serialize(wl))


@router.patch("/watchlists/{list_id}")
def update_watchlist(list_id: int, payload: WatchlistUpdate, db: Session = Depends(get_db)):
    wl = _get_or_404(db, list_id)
    if payload.name is not None:
        wl.name = payload.name.strip()
    if payload.is_default is True:
        # Single default invariant
        for other in db.query(Watchlist).filter(Watchlist.user_id == USER_ID).all():
            other.is_default = 0
        wl.is_default = 1
    elif payload.is_default is False:
        wl.is_default = 0
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="watchlist name already exists")
    db.refresh(wl)
    return ok(_serialize(wl))


@router.delete("/watchlists/{list_id}")
def delete_watchlist(list_id: int, db: Session = Depends(get_db)):
    wl = _get_or_404(db, list_id)
    remaining = db.query(Watchlist).filter(Watchlist.user_id == USER_ID).count()
    if remaining <= 1:
        raise HTTPException(status_code=400, detail="cannot delete the last watchlist")
    db.delete(wl)
    db.commit()
    return ok({"id": list_id})


@router.put("/watchlists/reorder")
def reorder_watchlists(payload: ReorderRequest, db: Session = Depends(get_db)):
    rows = {w.id: w for w in db.query(Watchlist).filter(Watchlist.user_id == USER_ID).all()}
    if set(payload.ids) != set(rows.keys()):
        raise HTTPException(status_code=400, detail="ids must match existing watchlists exactly")
    for index, list_id in enumerate(payload.ids):
        rows[list_id].position = index
    db.commit()
    return ok([_serialize(w) for w in _load_all(db)])


def _normalize_symbol(symbol: str, market: str) -> tuple[str, str]:
    """Normalize symbol to uppercase and infer market for JP 4-digit codes."""
    sym = symbol.strip().upper()
    mkt = market.strip()
    if sym.isdigit() and len(sym) == 4:
        mkt = "JP"
    return sym, mkt


@router.post("/watchlists/{list_id}/items", status_code=201)
def add_item(list_id: int, payload: WatchlistItemCreate, db: Session = Depends(get_db)):
    wl = _get_or_404(db, list_id)
    sym, mkt = _normalize_symbol(payload.symbol, payload.market)
    item = WatchlistItem(
        watchlist_id=wl.id,
        symbol=sym,
        market=mkt,
        display_name=(payload.display_name or "").strip() or None,
        position=_next_item_position(db, wl.id),
    )
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="symbol already in watchlist")
    db.refresh(wl)
    return ok(_serialize(wl))


@router.delete("/watchlists/{list_id}/items/{symbol}")
def remove_item(list_id: int, symbol: str, db: Session = Depends(get_db)):
    wl = _get_or_404(db, list_id)
    item = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.watchlist_id == wl.id, WatchlistItem.symbol == symbol)
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="item not found")
    db.delete(item)
    db.commit()
    db.refresh(wl)
    return ok(_serialize(wl))


@router.put("/watchlists/{list_id}/items/reorder")
def reorder_items(list_id: int, payload: ItemReorderRequest, db: Session = Depends(get_db)):
    wl = _get_or_404(db, list_id)
    items_by_symbol = {item.symbol: item for item in wl.items}
    if set(payload.symbols) != set(items_by_symbol.keys()):
        raise HTTPException(status_code=400, detail="symbols must match existing items exactly")
    for index, sym in enumerate(payload.symbols):
        items_by_symbol[sym].position = index
    db.commit()
    db.refresh(wl)
    return ok(_serialize(wl))
