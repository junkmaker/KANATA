"""Unit tests for scripts/candle_factor_backtest.py: 分解が検出器からドリフトしないこと。

§4 の分解は `hammer` を「形状 × 文脈」に割るものなので、**割った側の積が
`detect_hammer` と一致しなくなった瞬間に意味を失う**。閾値やロジックを変えたときに
分解だけが古い定義で走ることを防ぐのがここのテストの役割。
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from src.analysis import candle_patterns as cp

REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def fb():
    spec = importlib.util.spec_from_file_location(
        "candle_factor_backtest", REPO_ROOT / "scripts" / "candle_factor_backtest.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def frame():
    """ハンマー型・上昇・下降・横ばいが混ざるようにした合成系列。"""
    rng = np.random.default_rng(7)
    n = 400
    close = 100 * np.exp(np.cumsum(rng.normal(0, 0.02, n)))
    open_ = close * (1 + rng.normal(0, 0.005, n))
    high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.004, n)))
    low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.02, n)))  # 長い下ヒゲ
    return pd.DataFrame(
        {"Open": open_, "High": high, "Low": low, "Close": close,
         "Volume": np.full(n, 1000.0)},
        index=pd.bdate_range("2022-01-03", periods=n),
    )


def test_hammer_mask_matches_the_detector(fb, frame):
    """形状 × 下降文脈 の積が `detect("hammer")` と一致する。"""
    masks = fb._masks()
    assert np.array_equal(masks["hammer"](frame), cp.detect("hammer", frame))


def test_hanging_man_mask_matches_the_detector(fb, frame):
    masks = fb._masks()
    assert np.array_equal(masks["hanging_man"](frame), cp.detect("hanging_man", frame))


def test_context_series_partition_the_shape_series(fb, frame):
    """「文脈のみ」= 「形状あり」+「形状なし」に過不足なく割れている。

    増分検定は被験群と対照群が同じ文脈の下で排他かつ網羅であることに依存する。
    どちらかが漏れると「同じ文脈で形状なし」が対照群として成立しない。
    """
    m = fb._masks()
    for context, subject, control in (
        ("down_only", "hammer", "down_no_shape"),
        ("up_only", "hanging_man", "up_no_shape"),
    ):
        ctx, sub, ctl = m[context](frame), m[subject](frame), m[control](frame)
        assert not (sub & ctl).any(), f"{subject} と {control} が重なっている"
        assert np.array_equal(ctx, sub | ctl), f"{context} が {subject}/{control} に割れていない"


def test_hammer_and_hanging_man_are_exclusive(fb, frame):
    """同じ形状でも下降後と上昇後は同時に立たない（横ばいはどちらも出さない）。"""
    m = fb._masks()
    assert not (m["hammer"](frame) & m["hanging_man"](frame)).any()
    assert (m["shape_only"](frame).sum()
            >= m["hammer"](frame).sum() + m["hanging_man"](frame).sum())


def test_by_date_drops_nan_and_groups_by_signal_date(fb):
    """対照群を `compare` が受け取れる形へ変換する際、打ち切りを 0 で埋めない。"""
    sig = pd.DataFrame(
        {
            "signal_date": ["2024-01-01", "2024-01-01", "2024-01-02"],
            "fwd5": [0.01, np.nan, -0.02],
        }
    )
    out = fb.by_date(sig, 5)
    assert out == {"2024-01-01": [0.01], "2024-01-02": [-0.02]}


def test_series_labels_cover_every_mask(fb):
    """系列を足したらラベルも足す（表の列が無言で欠けるのを防ぐ）。"""
    assert set(fb._masks()) == set(fb.SERIES_LABELS)
    assert set(fb.RANDOM_ROWS) <= set(fb.SERIES_LABELS)
    for subject, control in fb.INCREMENT_PAIRS:
        assert subject in fb.SERIES_LABELS and control in fb.SERIES_LABELS
