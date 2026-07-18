"""ファイル永続化まわりの共有ヘルパ(リーフモジュール)。

screening_provider / universe_provider の双方から使う。他の services を
import しない(循環 import 回避のための最下層)。
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path


def now_iso() -> str:
    """ローカルタイムゾーン付き ISO 文字列(例: 2026-07-08T15:42:10+09:00)。"""
    return datetime.now().astimezone().isoformat(timespec="seconds")


def backend_data_dir() -> Path:
    """バンドル済みリソース(CSV)の置き場: backend/data。"""
    return Path(__file__).resolve().parent.parent.parent / "data"


def data_dir() -> Path:
    """書き込み可能なデータ置き場。未設定時は backend/data にフォールバック。"""
    override = os.environ.get("KANATA_DATA_DIR")
    base = Path(override) if override else backend_data_dir()
    base.mkdir(parents=True, exist_ok=True)
    return base


def atomic_write_json(path: Path, payload: dict) -> None:
    """tmp に書いてから replace する atomic JSON 書込。"""
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)
