"""Unit tests for ORM models and the seed routine."""
from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from src.db.init_db import _ensure_default_watchlist
from src.db.models import Watchlist, WatchlistItem


@pytest.mark.unit
def test_default_watchlist_seed_creates_one_row(db_session):
    _ensure_default_watchlist(db_session)
    rows = db_session.query(Watchlist).all()
    assert len(rows) == 1
    assert rows[0].name == "Default"
    assert rows[0].is_default == 1
    assert rows[0].user_id == "local"


@pytest.mark.unit
def test_seed_is_idempotent(db_session):
    _ensure_default_watchlist(db_session)
    _ensure_default_watchlist(db_session)
    assert db_session.query(Watchlist).count() == 1


@pytest.mark.unit
def test_unique_user_name_constraint(db_session):
    db_session.add(Watchlist(user_id="local", name="A", position=0))
    db_session.commit()
    db_session.add(Watchlist(user_id="local", name="A", position=1))
    with pytest.raises(IntegrityError):
        db_session.commit()


@pytest.mark.unit
def test_cascade_deletes_items(db_session):
    wl = Watchlist(user_id="local", name="Tech", position=0)
    wl.items = [
        WatchlistItem(symbol="AAPL", market="US", position=0),
        WatchlistItem(symbol="MSFT", market="US", position=1),
    ]
    db_session.add(wl)
    db_session.commit()

    db_session.delete(wl)
    db_session.commit()

    assert db_session.query(WatchlistItem).count() == 0


@pytest.mark.unit
def test_unique_symbol_within_list(db_session):
    wl = Watchlist(user_id="local", name="X", position=0)
    db_session.add(wl)
    db_session.commit()

    db_session.add(WatchlistItem(watchlist_id=wl.id, symbol="AAPL", market="US", position=0))
    db_session.commit()

    db_session.add(WatchlistItem(watchlist_id=wl.id, symbol="AAPL", market="US", position=1))
    with pytest.raises(IntegrityError):
        db_session.commit()
