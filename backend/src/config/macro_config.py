"""Load macro thresholds / series IDs / signal rules from a JSON config file.

The config is intentionally non-code so thresholds, reference windows, series
IDs and the overall-signal rule can be tuned without editing Python. Resolution
order:

1. ``MACRO_CONFIG_PATH`` environment variable (absolute or relative path)
2. ``macro_thresholds.json`` next to this module
3. Built-in ``_DEFAULT_CONFIG`` fallback (keeps the API working if the file is
   missing or unreadable)
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_CONFIG: dict[str, Any] = {
    "series": {
        "hy_oas": "BAMLH0A0HYM2",
        "walcl": "WALCL",
        "rrp": "RRPONTSYD",
        "tga": "WTREGEN",
    },
    "default_lookback_days": 730,
    "thresholds": {
        "hy_oas": {
            "yellow_lookback_points": 20,
            "yellow_widening_bp": 50.0,
            "red_lookback_points": 60,
        },
        "net_liquidity": {
            "yellow_lookback_points": 8,
            "red_lookback_points": 26,
        },
        "rsp_spy": {
            "near_low_pct": 2.0,
            "low_lookback_points": 60,
        },
    },
    "overall": {
        "red_if_any_red": True,
        "yellow_if_yellow_count_gte": 2,
    },
}


def _config_path() -> Path:
    override = os.environ.get("MACRO_CONFIG_PATH")
    if override:
        return Path(override)
    return Path(__file__).parent / "macro_thresholds.json"


def load_macro_config() -> dict[str, Any]:
    """Return the macro config dict, falling back to the built-in default."""
    path = _config_path()
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        logger.warning("macro config not found at %s; using built-in default", path)
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("failed to read macro config %s (%s); using built-in default", path, e)
    return _DEFAULT_CONFIG
