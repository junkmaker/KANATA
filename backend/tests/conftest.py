"""Shared pytest fixtures.

Uses a per-test temporary file SQLite so the engine, the test session,
and FastAPI's request-scoped sessions all see identical tables and rows.
"""
from __future__ import annotations

import os
import tempfile
from typing import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from src.db.database import Base, get_db
from src.db.init_db import _ensure_default_watchlist
from src.main import app


@pytest.fixture
def engine():
    fd, path = tempfile.mkstemp(suffix=".db", prefix="kanata-test-")
    os.close(fd)
    url = f"sqlite:///{path}"
    eng = create_engine(url, connect_args={"check_same_thread": False}, future=True)
    Base.metadata.create_all(bind=eng)
    try:
        yield eng
    finally:
        eng.dispose()
        try:
            os.unlink(path)
        except OSError:
            pass


@pytest.fixture
def TestingSessionLocal(engine):
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


@pytest.fixture
def db_session(TestingSessionLocal) -> Generator[Session, None, None]:
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(TestingSessionLocal, db_session) -> Generator[TestClient, None, None]:
    _ensure_default_watchlist(db_session)

    def _override_get_db():
        s = TestingSessionLocal()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _override_get_db
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_db, None)
