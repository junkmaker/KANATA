"""SQLAlchemy engine and session factory.

The engine is created lazily so tests can override DATABASE_URL via
environment variables before importing dependent modules.
"""
from __future__ import annotations

import os
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


def _resolve_database_url() -> str:
    raw = os.environ.get("DATABASE_URL", "sqlite:///./data/kanata.db")
    return raw


DATABASE_URL = _resolve_database_url()


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def _make_engine(url: str):
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, connect_args=connect_args, future=True)


engine = _make_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a scoped DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def reset_engine_for_testing(url: str) -> None:
    """Rebind engine and SessionLocal to a new URL (used by tests)."""
    global engine, SessionLocal, DATABASE_URL
    DATABASE_URL = url
    engine = _make_engine(url)
    SessionLocal.configure(bind=engine)
