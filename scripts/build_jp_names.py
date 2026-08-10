"""JPX「東証上場銘柄一覧」から日本語銘柄名マスタを生成する CLI。

出力は ``backend/data/jp_names.csv``(``code,name``)。バックエンドは実行時に
ネットワークを使わないので、**生成物をコミットして同梱する**。JPX 側は月次で
更新されるため、追随したくなったら再実行して差分をコミットする。

使い方(リポジトリルートから):
    python scripts/build_jp_names.py --download
    python scripts/build_jp_names.py --input path/to/data_j.xls

.xls(旧 BIFF 形式)の読み取りには xlrd が要る:
    pip install xlrd
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
import tempfile
import urllib.request
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent

JPX_URL = (
    "https://www.jpx.co.jp/markets/statistics-equities/misc/"
    "tvdivq0000001vg2-att/data_j.xls"
)
# JPX は User-Agent 無しのリクエストを弾くことがある
DOWNLOAD_UA = "Mozilla/5.0"
DOWNLOAD_TIMEOUT = 60

DEFAULT_OUTPUT = REPO_ROOT / "backend" / "data" / "jp_names.csv"
CODE_COLUMN = "コード"
NAME_COLUMN = "銘柄名"
# 東証の銘柄コードは 4 文字(数字4桁、または数字3桁+英字1桁)
CODE_WIDTH = 4


def _log(msg: str) -> None:
    """進捗・警告は stderr へ(stdout は出力先パスのために空けておく)。"""
    print(msg, file=sys.stderr, flush=True)


def _download(dest: Path) -> None:
    """JPX の銘柄一覧を dest へ保存する。"""
    _log(f"[build_jp_names] downloading {JPX_URL}")
    req = urllib.request.Request(JPX_URL, headers={"User-Agent": DOWNLOAD_UA})
    with urllib.request.urlopen(req, timeout=DOWNLOAD_TIMEOUT) as res:  # noqa: S310
        dest.write_bytes(res.read())
    _log(f"[build_jp_names] downloaded {dest.stat().st_size} bytes")


def _read_table(path: Path) -> pd.DataFrame:
    """xls / csv を DataFrame に読む。xlrd 未導入は導入方法を出して終了する。"""
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path)
    try:
        return pd.read_excel(path)
    except ImportError as exc:
        _log(f"[build_jp_names] .xls の読み取りに xlrd が必要です: pip install xlrd ({exc})")
        raise SystemExit(1) from exc


def _norm_code(value: object) -> str:
    """JPX のコード列を 4 文字の文字列へ揃える。

    数字のみのコード(7203)は数値セル、英数混在コード(285A)は文字列セルとして
    格納されているため、読み込み後の型が行ごとに違う。float 経由で "7203.0" に
    なる経路を潰してから 4 文字へゼロ埋めする。
    """
    if isinstance(value, float) and value.is_integer():
        return str(int(value)).zfill(CODE_WIDTH)
    text = str(value).strip()
    if text.endswith(".0"):
        text = text[:-2]
    return text.zfill(CODE_WIDTH)


def _extract(df: pd.DataFrame) -> list[tuple[str, str]]:
    """DataFrame から (code, name) をコード昇順で取り出す(重複コードは先勝ち)。

    ETF / REIT の行も落とさない。コード→名前の辞書としては広いほうが役に立つ。
    銘柄名は JPX の公式表記をそのまま採る(全角英数を半角に潰さない)。
    """
    missing = [c for c in (CODE_COLUMN, NAME_COLUMN) if c not in df.columns]
    if missing:
        _log(
            f"[build_jp_names] 必須列がありません: {missing} "
            f"(検出した列: {list(df.columns)})"
        )
        raise SystemExit(1)

    names: dict[str, str] = {}
    for raw_code, raw_name in zip(df[CODE_COLUMN], df[NAME_COLUMN], strict=False):
        if pd.isna(raw_code) or pd.isna(raw_name):
            continue
        code = _norm_code(raw_code)
        name = str(raw_name).strip()
        if not code or not name:
            continue
        names.setdefault(code, name)
    return sorted(names.items())


def _write_csv(path: Path, rows: list[tuple[str, str]]) -> None:
    """code,name の CSV を UTF-8(BOM なし)で書き出す。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["code", "name"])
        writer.writerows(rows)


def build(source: Path, output: Path) -> int:
    """source を読んで output へ書き出し、件数を返す。"""
    rows = _extract(_read_table(source))
    if not rows:
        _log("[build_jp_names] 有効な行がありません")
        raise SystemExit(1)
    _write_csv(output, rows)
    return len(rows)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--download", action="store_true", help=f"JPX から取得する ({JPX_URL})")
    src.add_argument("--input", type=Path, help="ローカルの data_j.xls(または csv)")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="出力先 CSV")
    args = parser.parse_args(argv)

    tmp_path: Path | None = None
    try:
        if args.download:
            fd, tmp = tempfile.mkstemp(suffix=".xls", prefix="jpx-data-")
            os.close(fd)
            tmp_path = Path(tmp)
            _download(tmp_path)
            source = tmp_path
        else:
            source = args.input
            if not source.exists():
                _log(f"[build_jp_names] 入力ファイルがありません: {source}")
                raise SystemExit(1)
        count = build(source, args.output)
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)

    _log(f"[build_jp_names] wrote {count} rows")
    print(args.output)


if __name__ == "__main__":
    main()
