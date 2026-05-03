# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 言語

ユーザーへの応答、コメント、コミットメッセージなどユーザーが読むものは日本語を使用すること。

## プロジェクト概要

KANATA (Karte for Analytical Navigation And Technical Analysis) は TradingView ライクな株式チャート **Windows ネイティブ Electron アプリ**。Docker/WSL2 構成から移行済み。Python FastAPI バックエンドをサイドカープロセスとして内包し、React + Vite レンダラーと IPC 経由で接続する。実装計画は [docs/electron.plan.md](docs/electron.plan.md) を参照（Phase 1 完了・Phase 2 進行中）。

## ディレクトリ構成

```
KANATA/
├── apps/
│   ├── main/src/          # Electron メインプロセス
│   │   ├── index.ts       # エントリ・BrowserWindow 生成
│   │   ├── preload.ts     # contextBridge で window.kanata を公開
│   │   ├── ipc/
│   │   │   ├── bridge.ts  # ipcMain ハンドラ登録
│   │   │   └── channels.ts # IPC チャンネル定数
│   │   ├── sidecar/
│   │   │   └── pythonSidecar.ts  # Python サブプロセス管理
│   │   ├── lib/
│   │   │   └── logger.ts         # mainLogger / sidecarLogger
│   │   └── _unused/
│   │       └── database.ts       # 未使用（better-sqlite3 削除済み）
│   └── renderer/src/      # React フロントエンド
│       ├── App.tsx
│       ├── components/
│       │   └── Chart/
│       │       ├── Chart.tsx            # Canvas 描画 (1368 行)
│       │       └── subpanes/
│       │           ├── drawVolume.ts
│       │           ├── drawStoch.ts
│       │           ├── drawMacd.ts
│       │           ├── drawRsi.ts
│       │           ├── drawUtils.ts
│       │           └── types.ts
│       ├── hooks/
│       ├── lib/
│       └── styles/
├── packages/
│   └── shared-types/src/index.ts  # PreloadApi 型 + Window 宣言
├── backend/src/           # FastAPI サイドカー
├── electron.vite.config.ts
├── scripts/dev.cjs        # ELECTRON_RUN_AS_NODE を除去して起動
└── package.json           # ルートワークスペース (type: module)
```

## 開発コマンド

```bash
# 開発起動 (Electron + Vite dev server + Python sidecar)
npm run dev

# プロダクションビルド
npm run build              # electron-vite build

# NSIS インストーラ生成
npm run dist               # electron-vite build && electron-builder --win nsis

# 型チェック (renderer + main 両ワークスペース)
npm run typecheck

# バックエンドを単独で動かす場合
cd backend
pip install -r requirements.txt
uvicorn src.main:app --reload --port 8000

# pytest (バックエンド)
cd backend && pytest
```

`npm run dev` は `scripts/dev.cjs` 経由で `electron-vite dev` を呼ぶ。VSCode から起動すると `ELECTRON_RUN_AS_NODE=1` が継承されて Electron が正しく動かないため、このスクリプトがその環境変数を削除してから起動する。

## アーキテクチャ

### データフロー

```
yfinance → Python sidecar (FastAPI + TTLCache) → /api/quotes/{symbol}?timeframe=X
                                                       ↓ fetch (動的ポート)
                                               renderer useChartData フック
                                                       ↓
                                               App.tsx: realData をそのまま Chart へ渡す
                                                       ↓ props
                                               Chart.tsx (Canvas 描画)
```

- `useChartData` がウォッチリストの全銘柄をバックエンドから取得
- `lib/data.ts` の `genSeries` はウォッチリストに存在するが yfinance 未登録の銘柄のプレースホルダー OHLC 生成にのみ使用
- 合成データの事前生成・マージは廃止済み

### Electron メインプロセス (`apps/main/src/`)

- `index.ts` — `bootstrap()` で IPC ハンドラ登録 → サイドカー起動 → `BrowserWindow` 生成。開発時は `ELECTRON_RENDERER_URL`（Vite dev server）、本番は `out/renderer/index.html`
- `preload.ts` — **CJS ビルド**（`out/preload/index.js`）。`contextBridge.exposeInMainWorld('kanata', api)` で `window.kanata` を公開。`getBackendUrl / platform / appVersion` を提供
- `ipc/channels.ts` — `kanata:backend-url` チャンネル定数
- `ipc/bridge.ts` — `ipcMain.handle('kanata:backend-url', () => getBackendUrl())`
- `lib/logger.ts` — `mainLogger` / `sidecarLogger` を提供。ファイル出力（`userData/logs/`）+ コンソール出力の二重ログ

### Python サイドカー (`apps/main/src/sidecar/pythonSidecar.ts`)

- `--port 0` で起動 → uvicorn ログから `Uvicorn running on http://127.0.0.1:(\d+)` を正規表現で検出してポートを取得
- `resolveBackendDir()` — パッケージ時は `process.resourcesPath/backend`、開発時は `app.getAppPath()/backend`（`KANATA_BACKEND_DIR` 環境変数で上書き可）
- `resolvePythonExecutable()` — パッケージ時は `resources/python/python.exe`、開発時はシステム `python` / `python3`（`KANATA_PYTHON` 環境変数で上書き可）
- `DATABASE_URL=sqlite:///<userData>/kanata.db` を環境変数として子プロセスに渡す
- `before-quit` フックで `stopPythonSidecar()` → `child.kill()` を呼ぶ

### バックエンド (`backend/src/`)

- `main.py` — FastAPI エントリ。`lifespan` で `init_db()` 実行。CORS 許可オリジン: `localhost:3000` / `localhost:5173`（Vite dev）/ `file://.*`（Electron prod）
- `routes/quotes.py` — `GET /api/quotes/{symbol}?timeframe=...` TTL キャッシュ経由
- `routes/search.py` — `GET /api/search?q=...` プリセット 15 銘柄 → 不一致時に yfinance.Search へフォールバック
- `routes/fundamentals.py` — `GET /api/fundamentals/{symbol}/quarterly` で四半期財務データ（売上・利益・ROE/ROIC 等）を返す。`fetch_quarterly_fin` 経由。年次 BS が空の場合は年次にフォールバック
- `routes/watchlists.py` — `/api/watchlists*` 8 エンドポイント（CRUD + 並び替え + アイテム追加削除）。全レスポンスは `{success, data, error}` エンベロープ。ユーザは `USER_ID = "local"` 固定。最後の 1 件は削除不可（400）、`is_default` トグルで他のデフォルトを解除
- `services/yfinance_provider.py` — **タイムフレーム変換の要所**。`INTERVAL_MAP` で renderer の `5m/15m/60m/1D/1W/1M` を yfinance の `interval/period/cache TTL` に対応付ける。数字のみの JP 銘柄には `.T` サフィックスを自動付与（`to_yf_symbol`）
- `services/cache.py` — プロセス内メモリの TTLCache（Redis 等は未使用）
- `db/database.py` — SQLAlchemy 2.x の `Base` / `engine` / `SessionLocal` / `get_db` 依存性。`DATABASE_URL` 環境変数（デフォルト `sqlite:///./data/kanata.db`）
- `db/models.py` — `Watchlist` / `WatchlistItem` ORM。`(user_id, name)` と `(watchlist_id, symbol)` にユニーク制約、`WatchlistItem.watchlist_id` は CASCADE 削除
- `db/init_db.py` — `Base.metadata.create_all` + デフォルトウォッチリスト seed（Alembic は未導入）
- `schemas/common.py` — `ApiResponse` エンベロープと `ok` / `fail` ヘルパ
- `schemas/watchlist.py` — Pydantic v2 スキーマ（`ConfigDict(from_attributes=True)`）

### フロントエンド (`apps/renderer/src/`)

- `App.tsx` — 全状態の単一ソース。`localStorage` キーは `kanata.state` / `kanata.aesthetic` / `kanata.density` / `kanata.activeWatchlistId` / `kanata.migrated.v1`
- `lib/backendUrl.ts` — `window.kanata.getBackendUrl()` IPC 経由でバックエンド URL を取得・キャッシュ。`VITE_API_URL` または `http://127.0.0.1:8000` にフォールバック
- `hooks/useWatchlists.ts` — バックエンド `/api/watchlists*` を叩くフック。`status: 'loading' | 'ready' | 'offline'`
- `lib/watchlistApi.ts` — 8 本の fetch ラッパ。`{success, data, error}` エンベロープを剥がす
- `lib/watchlistTickers.ts` — `Watchlist.items` を表示用 `Ticker` に変換し、未知銘柄は `genSeries` で合成 OHLC を生成
- `lib/migrateLocalState.ts` — 既存 `kanata.state.selected` を「Migrated from local」リストに一度だけ移行（フラグ: `kanata.migrated.v1`）
- `components/Chart/Chart.tsx` — **1368 行**の Canvas 描画コンポーネント。ローソク足、インジケーター、描画ツール（選択・移動・削除含む）、クロスヘア、パン・ズームを扱う。サブペイン描画は `subpanes/` に切り出し済み
- `components/Chart/subpanes/` — `drawVolume / drawStoch / drawMacd / drawRsi / drawUtils / types` に分割済み
- `lib/indicators.ts` — SMA/EMA/BOLL/STOCH/PSAR/Ichimoku をクライアント側で計算
- `lib/data.ts` — `genSeries`（未知銘柄向けプレースホルダー OHLC）+ `retime()` でタイムフレーム変換。15 銘柄の事前生成は廃止済み
- `hooks/useChartData.ts` — `symbols.join(',')` を useEffect 依存にして配列の参照等価性問題を回避している
- `styles/globals.css` — 4 種カラーテーマ (`data-aesthetic`) + 2 種密度 (`data-density`) を CSS カスタムプロパティで切替

### 共有型 (`packages/shared-types/src/index.ts`)

- `PreloadApi` — `getBackendUrl / platform / appVersion` の型定義
- `Window` グローバル拡張 — `window.kanata?: PreloadApi`
- メインプロセスとレンダラーの両ワークスペースからエイリアス `@kanata/shared-types` で参照

### 型定義 (`apps/renderer/src/types.ts`)

`OHLCBar` / `Ticker` / `AppState` / `DrawingObject` / 各インジケーター結果型が集中管理されている。`AppState` は `drawings: DrawingObject[]` と `selectedDrawingId: number | null` を持つ。新しい描画ツールやインジケーターを追加する際はここを起点に変更する。

## 実装上の注意点

- **`ELECTRON_RUN_AS_NODE=1` を絶対に継承させない**。VSCode の Electron 拡張がこの変数をセットするため、`npm run dev` は `scripts/dev.cjs` 経由で削除してから起動する
- **プリロードは CJS 形式でビルドする**。`package.json` の `"type": "module"` があると Rollup は `.mjs` を生成するが、Electron のサンドボックス化プリロードは ESM `import` 構文をサポートしない。`electron.vite.config.ts` の preload セクションに `format: 'cjs'` と `entryFileNames: '[name].js'` が設定済み
- **サイドカーポートは動的**。uvicorn を `--port 0` で起動し、ログの正規表現でポートを検出する。ハードコードした `8000` ではなく必ず `getBackendUrl()` 経由で URL を取得する
- **DB パスは `app.getPath('userData')`**。Windows では `%APPDATA%/kanata/kanata.db`。`sqlite:///` プレフィックス + スラッシュ統一済み（`pythonSidecar.ts` で `replace(/\\/g, '/')` を適用）
- **タイムフレーム文字列は前後で違う**。フロントは `5m/15m/60m/1D/1W/1M`、yfinance は `5m/15m/60m/1d/1wk/1mo`。変換は必ず `INTERVAL_MAP` 経由にする
- **JP 銘柄コードは 4 桁数字**（例 `7203`）。yfinance に渡す前に `.T` を付ける処理が `to_yf_symbol` に集約されているので、新規ルートで yfinance を呼ぶ場合も同関数を使う
- **描画ツールは OHLC インデックスと価格で保存**（`DrawingObject`）、座標ではない。タイムフレーム変更でも位置が維持される設計
- **Canvas は高 DPI 対応**（`devicePixelRatio`）。サイズ計算を触るときは論理ピクセルと物理ピクセルの区別に注意
- **Chart サブペインの Y 座標チェーン**（[Chart.tsx:70-74](apps/renderer/src/components/Chart/Chart.tsx#L70-L74)）に手を入れない。ペインの高さを変えるときは `priceH` の計算（`gapsToLastPane` ternary）だけを変更する
- **ウォッチリスト API のテスト**：`backend/tests/` に pytest 実装済み（`test_models.py` 5 件 + `test_watchlists_api.py` 10 件）。`conftest.py` は tempfile SQLite + `app.dependency_overrides[get_db]` でテスト分離

## ブランディング

「KAIROS /TERMINAL」→「KANATA /TERMINAL」にリネーム済み。localStorage キーも `kanata.*` に統一済み。これから追加するキー・表示名も `KANATA` ブランドで揃える。
