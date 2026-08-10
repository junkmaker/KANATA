"""Unit tests for macro_config: 設定ファイルと組み込みデフォルトの合成。

``MACRO_CONFIG_PATH`` でユーザーが設定ファイルを差し替えられるため、新しい指標を
足したあとも「旧版のファイルを指したままの環境」が壊れないことを担保する。
"""
from __future__ import annotations

import json

import pytest

from src.config.macro_config import _DEFAULT_CONFIG, load_macro_config


def _write_config(tmp_path, monkeypatch, cfg: dict) -> None:
    path = tmp_path / "macro.json"
    path.write_text(json.dumps(cfg), encoding="utf-8")
    monkeypatch.setenv("MACRO_CONFIG_PATH", str(path))


def test_missing_file_falls_back_to_default(tmp_path, monkeypatch):
    monkeypatch.setenv("MACRO_CONFIG_PATH", str(tmp_path / "does-not-exist.json"))
    assert load_macro_config() == _DEFAULT_CONFIG


def test_stale_config_without_new_indicator_is_backfilled(tmp_path, monkeypatch):
    """新指標のキーを持たない旧版ファイルでも series/thresholds が欠落しない。

    欠落したまま返すと build_t10y2y の cfg["series"]["t10y2y"] が KeyError を投げ、
    ルート層の広域 except がダッシュボード全体を 502 にする（部分稼働の方針違反）。
    """
    stale = json.loads(json.dumps(_DEFAULT_CONFIG))
    del stale["series"]["t10y2y"]
    del stale["thresholds"]["t10y2y"]
    _write_config(tmp_path, monkeypatch, stale)

    cfg = load_macro_config()
    assert cfg["series"]["t10y2y"] == "T10Y2Y"
    assert cfg["thresholds"]["t10y2y"] == {"green_min_bp": 50.0, "red_max_bp": 0.0}


def test_user_values_win_over_defaults(tmp_path, monkeypatch):
    """合成はデフォルトを土台にするだけで、ユーザーの指定値を上書きしない。"""
    custom = json.loads(json.dumps(_DEFAULT_CONFIG))
    custom["thresholds"]["t10y2y"] = {"green_min_bp": 25.0, "red_max_bp": 0.0}
    custom["series"]["hy_oas"] = "CUSTOM_SERIES"
    custom["default_lookback_days"] = 365
    _write_config(tmp_path, monkeypatch, custom)

    cfg = load_macro_config()
    assert cfg["thresholds"]["t10y2y"]["green_min_bp"] == 25.0
    assert cfg["series"]["hy_oas"] == "CUSTOM_SERIES"
    assert cfg["default_lookback_days"] == 365


def test_unknown_user_keys_are_preserved(tmp_path, monkeypatch):
    """デフォルトに無いキーを合成で落とさない。"""
    custom = json.loads(json.dumps(_DEFAULT_CONFIG))
    custom["series"]["future_indicator"] = "SOMEID"
    custom["experimental"] = {"flag": True}
    _write_config(tmp_path, monkeypatch, custom)

    cfg = load_macro_config()
    assert cfg["series"]["future_indicator"] == "SOMEID"
    assert cfg["experimental"] == {"flag": True}


def test_merge_does_not_mutate_default(tmp_path, monkeypatch):
    """合成結果を書き換えてもモジュール共有の _DEFAULT_CONFIG が汚染されない。"""
    _write_config(tmp_path, monkeypatch, {"series": {"hy_oas": "OTHER"}})

    cfg = load_macro_config()
    cfg["series"]["hy_oas"] = "MUTATED"
    assert _DEFAULT_CONFIG["series"]["hy_oas"] == "BAMLH0A0HYM2"


@pytest.mark.integration
def test_dashboard_survives_stale_config(tmp_path, monkeypatch):
    """旧版の設定ファイルを指したままでもダッシュボードが 7 指標を返す（502 にならない）。"""
    from unittest.mock import patch

    from src.services.macro_provider import build_dashboard

    stale = json.loads(json.dumps(_DEFAULT_CONFIG))
    del stale["series"]["t10y2y"]
    del stale["thresholds"]["t10y2y"]
    _write_config(tmp_path, monkeypatch, stale)

    with patch("src.services.macro_provider.fetch_fred_series", side_effect=lambda *a: []), patch(
        "src.services.macro_provider.fetch_daily_closes", side_effect=lambda s: {}
    ):
        result = build_dashboard("2020-01-01", "2030-01-01")

    assert len(result["indicators"]) == 7
