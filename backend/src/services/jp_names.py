"""日本株の日本語銘柄名マスタ(リーフモジュール)。

真実源は ``backend/data/jp_names.csv``(JPX「東証上場銘柄一覧」から
``scripts/build_jp_names.py`` で生成して同梱)。routes/search と
routes/watchlists の双方から使う。他の services を import しない
(依存方向は ``search / watchlists → jp_names → storage`` の一方向のみ)。

マスタは JP コードしか持たないため、**引けたこと自体が「JP 銘柄である」の
判定になる**。呼び出し側で market 判定を重ねる必要はない。
"""
from __future__ import annotations

import csv
import logging
import threading
from pathlib import Path

from .storage import backend_data_dir

logger = logging.getLogger(__name__)

MASTER_FILENAME = "jp_names.csv"
REQUIRED_COLUMNS = frozenset({"code", "name"})

_lock = threading.Lock()
# マスタの読取キャッシュ: (mtime, code→name)。同梱の静的リソースなので
# mtime が変わらない限り読み直さない(universe_provider._default_count_cache と同じ形)。
_cache: tuple[float, dict[str, str]] | None = None
# マスタ欠落の警告は 1 回だけ(欠落時はキャッシュに載らず毎リクエスト通るため)
_warned_missing = False


def master_path() -> Path:
    """同梱マスタ CSV のパス。"""
    return backend_data_dir() / MASTER_FILENAME


def _load(path: Path) -> dict[str, str]:
    """CSV を code→name の dict に読む。ファイル無し/破損時は空 dict(縮退)。

    縮退させても機能が黙って無効化されないよう、原因を warning で残す
    (macro_config が既定へフォールバックするときと同じ扱い)。

    pandas を使わないのは意図的。``pd.read_csv`` は ``dtype={"code": str}`` を
    忘れると 1301 を数値化してコードを壊す。標準 csv なら全て文字列で入る。
    """
    names: dict[str, str] = {}
    try:
        # utf-8-sig: Excel 経由で BOM が付くと列名が "﻿code" になる
        with path.open(encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            fields = set(reader.fieldnames or ())
            missing = REQUIRED_COLUMNS - fields
            if missing:
                logger.warning(
                    "jp name master %s missing column(s) %s (found %s); "
                    "falling back to source names",
                    path,
                    sorted(missing),
                    sorted(fields),
                )
                return {}
            for row in reader:
                code = (row.get("code") or "").strip()
                name = (row.get("name") or "").strip()
                if code and name:
                    names[code] = name
    except (OSError, csv.Error, UnicodeDecodeError) as e:
        logger.warning(
            "failed to read jp name master %s (%s); falling back to source names", path, e
        )
        return {}
    if not names:
        logger.warning("jp name master %s has no usable rows", path)
    return names


def _names() -> dict[str, str]:
    """同梱マスタを mtime キャッシュ付きで返す。"""
    global _cache, _warned_missing
    path = master_path()
    try:
        mtime = path.stat().st_mtime
    except OSError:
        # ファイルが無いとキャッシュに載らず毎リクエスト通るので、警告は 1 回だけ
        if not _warned_missing:
            logger.warning(
                "jp name master not found at %s; falling back to source names", path
            )
            _warned_missing = True
        return {}
    with _lock:
        if _cache is not None and _cache[0] == mtime:
            return _cache[1]
        names = _load(path)
        _cache = (mtime, names)
        return names


def jp_name(code: str) -> str | None:
    """コードに対応する日本語銘柄名。マスタに無ければ None。"""
    return _names().get(code.strip().upper())
