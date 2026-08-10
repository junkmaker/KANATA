"""Unit tests for the JP name master lookup."""
from __future__ import annotations

import logging
from unittest.mock import patch

import pytest

from src.services import jp_names


@pytest.fixture(autouse=True)
def _clear_cache():
    """テスト間でモジュールキャッシュ・警告フラグを持ち越さない。"""
    jp_names._cache = None
    jp_names._warned_missing = False
    yield
    jp_names._cache = None
    jp_names._warned_missing = False


@pytest.mark.unit
def test_load_parses_code_name_pairs(tmp_path):
    # Arrange
    csv_path = tmp_path / "jp_names.csv"
    csv_path.write_text(
        "code,name\n7203,トヨタ自動車\n285A,キオクシアホールディングス\n",
        encoding="utf-8",
    )

    # Act
    names = jp_names._load(csv_path)

    # Assert
    assert names == {"7203": "トヨタ自動車", "285A": "キオクシアホールディングス"}


@pytest.mark.unit
def test_load_missing_file_returns_empty(tmp_path):
    # Arrange
    missing = tmp_path / "does-not-exist.csv"

    # Act
    names = jp_names._load(missing)

    # Assert
    assert names == {}


@pytest.mark.unit
def test_load_skips_blank_rows(tmp_path):
    # Arrange
    csv_path = tmp_path / "jp_names.csv"
    csv_path.write_text(
        "code,name\n7203,トヨタ自動車\n,名前だけ\n9999,\n",
        encoding="utf-8",
    )

    # Act
    names = jp_names._load(csv_path)

    # Assert
    assert names == {"7203": "トヨタ自動車"}


@pytest.mark.unit
def test_load_strips_bom(tmp_path):
    # Arrange: Excel エクスポート由来の BOM 付き CSV
    csv_path = tmp_path / "jp_names.csv"
    csv_path.write_text("﻿code,name\n7203,トヨタ自動車\n", encoding="utf-8")

    # Act
    names = jp_names._load(csv_path)

    # Assert
    assert names == {"7203": "トヨタ自動車"}


@pytest.mark.unit
def test_load_wrong_columns_warns_and_degrades(tmp_path, caplog):
    # Arrange: 列名が code,name でない CSV(存在はするので欠落検知に引っかからない)
    csv_path = tmp_path / "jp_names.csv"
    csv_path.write_text("ticker,label\n7203,トヨタ自動車\n", encoding="utf-8")

    # Act
    with caplog.at_level(logging.WARNING):
        names = jp_names._load(csv_path)

    # Assert
    assert names == {}
    assert "missing column" in caplog.text


@pytest.mark.unit
def test_load_empty_master_warns(tmp_path, caplog):
    # Arrange: ヘッダだけでデータ行が無い
    csv_path = tmp_path / "jp_names.csv"
    csv_path.write_text("code,name\n", encoding="utf-8")

    # Act
    with caplog.at_level(logging.WARNING):
        names = jp_names._load(csv_path)

    # Assert
    assert names == {}
    assert "no usable rows" in caplog.text


@pytest.mark.unit
def test_missing_master_warns_once(tmp_path, caplog, monkeypatch):
    # Arrange
    monkeypatch.setattr(jp_names, "master_path", lambda: tmp_path / "absent.csv")

    # Act
    with caplog.at_level(logging.WARNING):
        jp_names.jp_name("7203")
        jp_names.jp_name("6758")

    # Assert: 毎リクエスト通る経路なので警告は 1 回だけ
    assert caplog.text.count("jp name master not found") == 1


@pytest.mark.unit
def test_jp_name_hits_bundled_master():
    # Arrange / Act
    name = jp_names.jp_name("7203")

    # Assert
    assert name == "トヨタ自動車"


@pytest.mark.unit
def test_jp_name_returns_none_for_us_ticker():
    # Arrange / Act
    name = jp_names.jp_name("AAPL")

    # Assert
    assert name is None


@pytest.mark.unit
def test_jp_name_handles_alphanumeric_code():
    # Arrange / Act
    name = jp_names.jp_name("285A")

    # Assert
    assert name == "キオクシアホールディングス"


@pytest.mark.unit
def test_jp_name_is_cached():
    # Arrange
    with patch.object(jp_names, "_load", wraps=jp_names._load) as spy:
        # Act
        first = jp_names.jp_name("7203")
        second = jp_names.jp_name("6758")

        # Assert
        assert first == "トヨタ自動車"
        assert second is not None
        assert spy.call_count == 1
