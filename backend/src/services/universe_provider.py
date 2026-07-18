"""スクリーニング用ユニバース(銘柄リスト CSV)の登録・一覧・削除・解決。

真実源は ``<KANATA_DATA_DIR>/universes/universes.json``(索引)と
``universes/<id>.csv``(正規化済み CSV 本体)。内蔵デフォルト
(``backend/data/prime_universe.csv``)は索引に載せず、一覧時に合成する。

FastAPI には依存しない。エラーはモジュール内のカスタム例外で表現し、
routes 層で HTTPException に変換する。依存方向は
``screening_provider → universe_provider → storage`` の一方向のみ(逆 import 禁止)。
"""
from __future__ import annotations

import json
import threading
from io import StringIO
from pathlib import Path
from uuid import uuid4

import numpy as np
import pandas as pd

from .storage import atomic_write_json, backend_data_dir, data_dir, now_iso

DEFAULT_UNIVERSE_ID = "default"
DEFAULT_UNIVERSE_NAME = "プライム(内蔵)"
MAX_CSV_BYTES = 2 * 1024 * 1024
MAX_ROWS = 10_000
UNIVERSES_DIRNAME = "universes"
INDEX_FILENAME = "universes.json"

DEFAULT_UNIVERSE_CSV = str(backend_data_dir() / "prime_universe.csv")

_index_lock = threading.Lock()
# 内蔵デフォルトの行数キャッシュ: (mtime, count)。ファイルは実質静的なので
# mtime が変わらない限り再カウントしない。
_default_count_cache: tuple[float, int] | None = None


class UniverseValidationError(Exception):
    """CSV / 入力の検証エラー(HTTP 400 相当)。"""


class DuplicateUniverseName(Exception):
    """表示名の重複(HTTP 409 相当)。"""


class UniverseNotFound(Exception):
    """未知の universe_id(HTTP 404 相当)。"""


class BuiltinUniverseError(Exception):
    """内蔵デフォルトへの禁止操作(HTTP 400 相当)。"""


def _universes_dir() -> Path:
    d = data_dir() / UNIVERSES_DIRNAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def _index_path() -> Path:
    return _universes_dir() / INDEX_FILENAME


def _load_index() -> list[dict]:
    """索引を読む。ファイルなし/破損時は空索引扱い(load_results と同じ防御)。"""
    path = _index_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    universes = data.get("universes") if isinstance(data, dict) else None
    return universes if isinstance(universes, list) else []


def _default_symbol_count() -> int:
    """内蔵デフォルトの銘柄数(mtime キャッシュ付き行カウント)。失敗しても例外にしない。"""
    global _default_count_cache
    path = Path(DEFAULT_UNIVERSE_CSV)
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return 0
    if _default_count_cache is not None and _default_count_cache[0] == mtime:
        return _default_count_cache[1]
    try:
        with path.open(encoding="utf-8") as f:
            count = max(sum(1 for _ in f) - 1, 0)  # ヘッダ行を除く
    except OSError:
        return 0
    _default_count_cache = (mtime, count)
    return count


def _builtin_entry() -> dict:
    return {
        "id": DEFAULT_UNIVERSE_ID,
        "name": DEFAULT_UNIVERSE_NAME,
        "symbol_count": _default_symbol_count(),
        "has_market_cap": True,
        "created_at": None,
        "builtin": True,
    }


def list_universes() -> list[dict]:
    """内蔵デフォルトを先頭に、登録済みユニバースを登録順で返す。"""
    with _index_lock:
        entries = _load_index()
    return [_builtin_entry()] + [{**e, "builtin": False} for e in entries]


def _parse_csv(csv_text: str) -> pd.DataFrame:
    """csv_text を検証して code 空白行を除いた DataFrame を返す。"""
    text = csv_text.lstrip("﻿")  # Excel エクスポートの BOM 対策
    if len(text.encode("utf-8")) > MAX_CSV_BYTES:
        raise UniverseValidationError(f"CSV が大きすぎます(最大 {MAX_CSV_BYTES} バイト)")
    try:
        df = pd.read_csv(StringIO(text), dtype={"code": str})
    except Exception as exc:
        raise UniverseValidationError(f"CSV を解析できません: {exc}") from exc
    if "code" not in df.columns:
        raise UniverseValidationError("CSV に必須列 code がありません")
    codes = df["code"].fillna("").astype(str).str.strip()
    df = df.assign(code=codes)
    df = df[df["code"] != ""]
    if df.empty:
        raise UniverseValidationError("CSV に有効なデータ行がありません(code が空)")
    if len(df) > MAX_ROWS:
        raise UniverseValidationError(f"CSV の行数が多すぎます(最大 {MAX_ROWS} 行)")
    if not all(c.isascii() for c in df["code"]):
        raise UniverseValidationError(
            "code 列に非 ASCII 文字が含まれています。CSV を UTF-8 で保存してください"
        )
    return df


def _normalize(df: pd.DataFrame) -> pd.DataFrame:
    """code,name,market_cap の 3 列に正規化(name 欠落→code、market_cap 欠落→空欄)。"""
    norm = pd.DataFrame()
    norm["code"] = df["code"]
    if "name" in df.columns:
        names = df["name"].fillna("").astype(str).str.strip()
        norm["name"] = names.where(names != "", df["code"])
    else:
        norm["name"] = df["code"]
    if "market_cap" in df.columns:
        # 数値化できない値・inf は空欄(フィルタ非適用)、小数は丸めて整数化。
        # そのまま astype("Int64") すると非整数 float で TypeError になる。
        caps = pd.to_numeric(df["market_cap"], errors="coerce")
        caps = caps.where(np.isfinite(caps))
        norm["market_cap"] = caps.round().astype("Int64")
    else:
        norm["market_cap"] = pd.array([pd.NA] * len(df), dtype="Int64")
    return norm


def register_universe(name: str, csv_text: str) -> dict:
    """CSV を検証・正規化して保存し、索引エントリを返す。

    raises: UniverseValidationError(400 相当), DuplicateUniverseName(409 相当)
    """
    clean_name = name.strip()
    if not clean_name:
        raise UniverseValidationError("ユニバース名が空です")
    df = _parse_csv(csv_text)
    has_market_cap = "market_cap" in df.columns
    norm = _normalize(df)

    universe_id = f"u_{uuid4().hex[:12]}"
    entry = {
        "id": universe_id,
        "name": clean_name,
        "filename": f"{universe_id}.csv",
        "symbol_count": int(len(norm)),
        "has_market_cap": has_market_cap,
        "created_at": now_iso(),
    }
    with _index_lock:
        entries = _load_index()
        taken = {e.get("name") for e in entries} | {DEFAULT_UNIVERSE_NAME}
        if clean_name in taken:
            raise DuplicateUniverseName(f"同名のユニバースが既に存在します: {clean_name}")
        norm.to_csv(_universes_dir() / entry["filename"], index=False)
        atomic_write_json(_index_path(), {"universes": entries + [entry]})
    return {**entry, "builtin": False}


def delete_universe(universe_id: str) -> None:
    """登録済みユニバースを索引・CSV とも削除する。

    raises: BuiltinUniverseError(400 相当), UniverseNotFound(404 相当)
    """
    if universe_id == DEFAULT_UNIVERSE_ID:
        raise BuiltinUniverseError("内蔵デフォルトのユニバースは削除できません")
    with _index_lock:
        entries = _load_index()
        target = next((e for e in entries if e.get("id") == universe_id), None)
        if target is None:
            raise UniverseNotFound(f"未知のユニバースです: {universe_id}")
        atomic_write_json(
            _index_path(),
            {"universes": [e for e in entries if e.get("id") != universe_id]},
        )
        try:
            (_universes_dir() / target.get("filename", f"{universe_id}.csv")).unlink(
                missing_ok=True
            )
        except OSError:
            pass  # 索引からは除去済み。ファイル残骸は無害


def resolve_universe(universe_id: str | None) -> dict:
    """universe_id を {id, name, csv_path} に解決する。None/"default" は内蔵。

    索引読取は 1 回で済ませる(スキャン開始のホットパス用)。
    raises: UniverseNotFound(404 相当)
    """
    if universe_id is None or universe_id == DEFAULT_UNIVERSE_ID:
        return {
            "id": DEFAULT_UNIVERSE_ID,
            "name": DEFAULT_UNIVERSE_NAME,
            "csv_path": DEFAULT_UNIVERSE_CSV,
        }
    with _index_lock:
        entries = _load_index()
    for e in entries:
        if e.get("id") == universe_id:
            return {
                "id": universe_id,
                "name": e.get("name", universe_id),
                "csv_path": str(_universes_dir() / e.get("filename", f"{universe_id}.csv")),
            }
    raise UniverseNotFound(f"未知のユニバースです: {universe_id}")


def resolve_csv_path(universe_id: str | None) -> str:
    """universe_id をスキャン用 CSV パスへ解決する(resolve_universe の薄いラッパ)。"""
    return resolve_universe(universe_id)["csv_path"]
