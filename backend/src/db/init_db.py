"""Database bootstrap: create tables and seed a Default watchlist."""
from __future__ import annotations

from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine
from .models import Watchlist


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as session:
        _ensure_default_watchlist(session)


def _ensure_default_watchlist(session: Session) -> None:
    has_any = session.query(Watchlist).filter_by(user_id="local").first()
    if has_any is not None:
        return
    default = Watchlist(user_id="local", name="Default", position=0, is_default=1)
    session.add(default)
    session.commit()
