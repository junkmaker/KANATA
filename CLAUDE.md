# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 言語

ユーザーへの応答、コメント、コミットメッセージなどユーザーが読むものは日本語を使用すること。

## プロジェクト概要

KANATA (Karte for Analytical Navigation And Technical Analysis) は TradingView ライクな株式チャート **Windows ネイティブ Electron アプリ**。Docker/WSL2 構成から移行済み。Python FastAPI バックエンドをサイドカープロセスとして内包し、React + Vite レンダラーと IPC 経由で接続する。実装計画は [docs/electron.plan.md](docs/electron.plan.md) を参照（Phase 1〜5 完了）。

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
│   │   │   └── pythonSidecar.ts  # Python サブプロセス管理（起動・ヘルスチェック・再起動・DB バックアップ）
│   │   ├── lib/
│   │   │   ├── port.ts           # reservePort()：動的ポート事前確保
│   │   │   └── logger.ts         # mainLogger / sidecarLogger
│   │   └── _unused/
│   │       └── database.ts       # 未使用（better-sqlite3 削除済み）
│   └── renderer/src/      # React フロントエンド
│       ├── App.tsx
│       ├── components/
│       │   ├── Chart/
│       │   │   ├── Chart.tsx            # Canvas 描画 (1697 行)
│       │   │   ├── subpanes/
│       │   │   │   ├── drawVolume.ts
│       │   │   │   ├── drawStoch.ts
│       │   │   │   ├── drawMacd.ts
│       │   │   │   ├── drawRsi.ts
│       │   │   │   ├── drawUtils.ts
│       │   │   │   └── types.ts
│       │   │   └── overlays/
│       │   │       ├── drawSqMarkers.ts      # SQ/ウィッチング日マーカー描画
│       │   │       └── drawPatternMarkers.ts # パターンの矢印・ハイライト枠
│       │   └── Patterns/
│       │       ├── PatternView.tsx      # 検出の単一ソース（Chart は描画のみ）
│       │       ├── PatternFilterBar.tsx # 方向グルーピングの 14 チップ
│       │       ├── PatternList.tsx
│       │       └── PatternSignalBadge.tsx
│       ├── hooks/
│       ├── lib/
│       └── styles/
├── packages/
│   └── shared-types/src/index.ts  # PreloadApi 型 + Window 宣言
├── backend/src/           # FastAPI サイドカー
├── electron.vite.config.ts
├── scripts/
│   ├── dev.cjs            # ELECTRON_RUN_AS_NODE を除去して起動
│   ├── backtest.py        # N字バックテスト CLI（fetch / detect / outcomes）
│   ├── backtest_report.py # N字バックテストの集計レポート生成
│   └── candle_backtest.py # ローソク足パターンのバックテスト CLI
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

- `lib/port.ts` の `reservePort()` で Node 側がポートを事前確保し、`--port <n>` でサイドカーに渡す（ログ正規表現依存なし）
- 起動後 `GET /api/health` が 200 を返すまで最大 20 秒ヘルスチェック待機（500ms 間隔）
- クラッシュ時は指数バックオフで最大 2 回自動再起動し、失敗時は `kanata:backend-status` で UI に通知
- 起動時に SQLite DB を `backups/` へコピーし直近 7 世代を保持
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
- `routes/macro.py` — `/api/macro/{hy-oas,net-liquidity,rsp-spy,dashboard}` 4 エンドポイント。共通クエリ `start`/`end`（ISO、既定は 730 日前〜当日）。**watchlist と違い `{success,data,error}` エンベロープではなく §6 の生オブジェクトを返す**（quotes 寄り）。各レスポンスを TTL 1h でキャッシュ。FRED キー未設定でも 500 にせず該当指標を `meta.available=false` で返す（部分稼働）
- `services/fred_provider.py` — FRED observations を同期 `httpx.Client` で取得。共有 TTLCache（6h）+ 取得失敗時の stale フォールバック（14d）。`FRED_API_KEY` 未設定時は `MissingFredKey` を送出。FRED 日付は米国基準のまま扱う
- `services/macro_provider.py` — 単位換算・週次リサンプル・純流動性・RSP/SPY inner join・シグナル判定のコア。**`WALCL` は百万$ → 十億$（÷1000）、純流動性は兆$ 表示（÷1000）**。RSP/SPY は yfinance のミリ秒 `t` で inner join。`evaluate_signal` / `build_dashboard`（総合シグナル）は config ルール準拠。`_despike()` が `_build_pair` の inner join 前にローリング中央値ベースでベンダー由来のスケール異常（例: 1306.T の分割未記録スパイク）を除去する（`macro_thresholds.json` の `sanitize` ブロックで設定）
- `config/macro_thresholds.json` + `config/macro_config.py` — series ID・閾値・参照期間・総合シグナルルールを JSON で外出し。`MACRO_CONFIG_PATH` 環境変数で差し替え可、未検出時は内蔵デフォルト。**ハードコード禁止、閾値変更は JSON 編集のみ**
- `schemas/macro.py` — §6 レスポンス契約の Pydantic v2 モデル（`response_model` 用）。日付は ISO 文字列、値は数値型
- `routes/screening.py` — N字スクリーニング。`GET /api/screening/n-pattern`（キャッシュ済み結果をそのまま返す。**`min_score` フィルタは廃止**）/ `POST .../scan`（202 でバックグラウンド起動、ボディ省略可・`{"universe_id"}` でユニバース指定、未知 id は 404、実行中は 409）/ `GET .../status`（進捗ポーリング）+ ユニバース管理 3 本（`GET/POST /api/screening/universes`、`DELETE /api/screening/universes/{id}`）。macro 同様エンベロープ無し、エラーは `HTTPException` + `detail`
- `services/storage.py` — ファイル永続化の共有ヘルパ（`now_iso` / `backend_data_dir` / `data_dir`（`KANATA_DATA_DIR` 解決）/ `atomic_write_json`）。他 services を import しないリーフモジュール
- `services/screening_provider.py` — ユニバース CSV 読込（必須列は `code` のみ。`name` 欠落→code 代用、`market_cap` 欠落/空欄→None でフィルタ非適用）・スキャン実行（スレッド）・結果 JSON 永続化（`<KANATA_DATA_DIR>/n_pattern_results.json`、atomic write）
- `services/universe_provider.py` — スクリーニング用ユニバースの登録・一覧・削除・解決。索引は `<KANATA_DATA_DIR>/universes/universes.json`、CSV 本体は `universes/<id>.csv` に `code,name,market_cap` へ正規化保存。登録は JSON ボディ `{name, csv_text}`（multipart 不使用）、2MB / 10,000 行上限、内蔵デフォルト（`prime_universe.csv`、id=`default`）は削除不可。FastAPI 非依存でカスタム例外を routes 層が HTTPException に変換。**依存方向は screening_provider → universe_provider の一方向のみ**（`DEFAULT_UNIVERSE_CSV` は universe_provider 側で定義）
- `services/ohlcv_store.py` — バックテスト用 OHLCV の Parquet ストア。`<KANATA_DATA_DIR>/ohlcv/<symbol>.parquet` が真実源。純関数（`normalize_ohlcv` / `merge_ohlcv` / `needs_full_refetch` / `sanity_check`）と I/O（`read_ohlcv` / `write_ohlcv` は atomic、`fetch_ohlcv` は yfinance）を分離。`update_symbol` は `"created" | "updated" | "unchanged" | "failed"` を返し、`sync_symbols` が失敗銘柄を集約する。ベンチマークは `BENCHMARK_SYMBOL = "1306"`（TOPIX ETF）
- `analysis/backtest.py` — ウォークフォワード検出（`walk_forward_signals` / `mark_overlaps`）・アウトカム計算（`resolve_entries` / `compute_outcomes` / `benchmark_outcome`）・統計（`block_bootstrap_means` / `percentile_of` / `confidence_interval`）の純関数群。**I/O は一切しない**（`os` / `pathlib` / `yfinance` / `json` を import しない）
- `analysis/n_pattern.py` — `precompute_series(df)` で ATR/MACD/出来高を全期間分まとめて計算し、`detect_n_pattern(df, precomputed=...)` に渡すとウォークフォワードが高速化する。**precompute 経路は非 precompute 経路と完全一致することがテストで担保されている**（`test_precomputed_path_matches_plain_path`）
- `analysis/candle_patterns.py` — ローソク足パターン 14 種の検出（bool 配列を返す純関数）。**レンダラーの `lib/candlePatterns.ts` と同値**で、片方だけ変更してはいけない。TS 13 種との差は `shooting_star`（UI 未移植）の 1 つのみ

#### N字バックテスト（`scripts/backtest.py`）

設計は [docs/n_pattern_backtest_spec.md](docs/n_pattern_backtest_spec.md)。4段階を個別に再実行できる。

```bash
python scripts/backtest.py fetch  --period 5y          # ① OHLCV を Parquet に取得
python scripts/backtest.py detect --start 2023-07-01   # ② ウォークフォワード検出
python scripts/backtest.py outcomes                    # ③ エントリー解決とアウトカム
python scripts/backtest_report.py                      # ④ 集計レポート（stdout + backtest/report.md）
```

出力は `<KANATA_DATA_DIR>/backtest/` 配下（既定は `backend/data/backtest/`）。`--limit N` でスモーク実行できる。ユニバース既定は `backend/data/topix_universe.csv`（**git 管理外**。無ければ `--universe` で差し替える）。

#### FRED_API_KEY の設定

- マクロ指標のうち HY OAS と Fed 純流動性は [FRED API](https://fred.stlouisfed.org/docs/api/) を使う。無料の API キーを取得し、環境変数 `FRED_API_KEY` で渡す（**未設定でも RSP/SPY は yfinance で稼働する＝部分稼働**）。
- 開発時: `$env:FRED_API_KEY = "<your_key>"; npm run dev`（PowerShell）。`.env` 経由も可（`python-dotenv`、`.env` は `.gitignore` 済み）。
- sidecar は spawn 時に `...process.env` を継承するため、シェル/OS に設定すれば自動で伝播する（コード変更不要）。**Electron パッケージにキーを同梱しない**。
- 通信先ドメイン `api.stlouisfed.org` への到達が必要。

### フロントエンド (`apps/renderer/src/`)

- `App.tsx` — 全状態の単一ソース。`localStorage` キーは `kanata.state` / `kanata.aesthetic` / `kanata.activeWatchlistId` / `kanata.migrated.v1` / `kanata.view`（チャート⇔マクロ）。`view` 切替で main-grid をチャート 3 ペイン or `MacroDashboard` に出し分け（既存フックは Rules of Hooks 順守で無条件に呼び続ける）
- `components/Macro/` — `MacroDashboard`（総合シグナル + 3 カード + 期間 3M/6M/1Y/2Y 切替、`useMacroDashboard` フック使用）/ `MacroCard` / `MacroLineChart`（軽量 Canvas 折れ線、閾値・安値線オーバーレイ、devicePixelRatio 対応、CSS 変数は `getComputedStyle` で解決）/ `SignalBadge`（緑/黄/赤/グレー）/ `macro.css`
- `lib/macroApi.ts` — マクロ 4 エンドポイントの fetch ラッパ。**§6 の生レスポンスを返す（envelope を剥がさない）**。`MacroPeriod` を `start` クエリへ変換
- `hooks/useMacroDashboard.ts` — `period` 依存で dashboard を取得（`status: 'loading' | 'ready' | 'offline'`、cancelled ガード）
- `lib/backendUrl.ts` — `window.kanata.getBackendUrl()` IPC 経由でバックエンド URL を取得・キャッシュ。`VITE_API_URL` または `http://127.0.0.1:8000` にフォールバック
- `hooks/useWatchlists.ts` — バックエンド `/api/watchlists*` を叩くフック。`status: 'loading' | 'ready' | 'offline'`
- `components/Screening/` — `ScreeningView`（ツールバー + 結果テーブル、`useScreening` / `useUniverses` 使用）/ `ScreeningTable`（market_cap null は "—" 表示。行クリックで `onSelectSymbol(ticker, name)` を呼び名前も渡す）/ `UniverseSelect`（ユニバース select + CSV登録/削除ボタン。Presentational、ファイルは `File.text()` で読んで JSON 送信）/ `screening.css`
- `lib/extraTicker.ts` — スクリーニングで選んだウォッチリスト外銘柄を合成 `Ticker` 化（`buildExtraTicker` / `inferMarketForCode`）。`RightPanel` の `ExtraTickerBanner`（backend `ready` かつアクティブリストありの時のみ表示）から「＋リストに追加」で `wl.addItem` へ永続化
- `lib/backendFetch.ts` — 生オブジェクト系（macro / screening）共通の `fetchJson` GET ラッパ。エンベロープ系（watchlist）では使わない
- `lib/screeningApi.ts` — スクリーニング + ユニバース API の fetch ラッパ（エンベロープを剥がさない。エラーは `detail` を Error message に載せる）
- `hooks/useUniverses.ts` — ユニバース一覧・登録・削除・選択状態。選択 id は `localStorage` キー `kanata.screening.universeId` に永続化（削除済み id は default にフォールバック）
- `lib/watchlistApi.ts` — 8 本の fetch ラッパ。`{success, data, error}` エンベロープを剥がす
- `lib/watchlistTickers.ts` — `Watchlist.items` を表示用 `Ticker` に変換し、未知銘柄は `genSeries` で合成 OHLC を生成
- `lib/migrateLocalState.ts` — 既存 `kanata.state.selected` を「Migrated from local」リストに一度だけ移行（フラグ: `kanata.migrated.v1`）
- `components/Chart/Chart.tsx` — **1697 行**の Canvas 描画コンポーネント。ローソク足、インジケーター、描画ツール（選択・移動・削除含む）、クロスヘア、パン・ズームを扱う。サブペイン描画は `subpanes/` に切り出し済み
- `components/Chart/subpanes/` — `drawVolume / drawStoch / drawMacd / drawRsi / drawUtils / types` に分割済み
- `components/Chart/overlays/drawSqMarkers.ts` — SQ・ウィッチング日マーカーの縦線とラベルを描画。日足（1D）のみ有効
- `components/Chart/overlays/drawPatternMarkers.ts` — パターンの矢印（強気=上向き / 弱気=下向き）とラベル、複数バー構成の半透明ハイライト枠を描画
- `components/Patterns/` — `PatternView`（`detectPatterns` を呼ぶ単一ソース。フィルタ結果を `Chart` に `patternMatches` として渡す）/ `PatternFilterBar`（強気・弱気・中立の 3 行 + 「すべて」= 14 チップ。単一選択）/ `PatternList` / `PatternSignalBadge` / `patterns.css`
- `lib/candlePatterns.ts` — ローソク足パターン 13 種の検出（純関数）。`PATTERN_LABELS` / `PATTERN_SIGNALS` が表示ラベルと方向の単一の真実源
- `lib/patternView.ts` — チップの表示順（`PATTERN_DISPLAY_ORDER`）と方向グルーピング（`PATTERN_FILTER_GROUPS`）。ラベル文字列は再定義せず `PATTERN_LABELS` から引く
- `lib/indicators.ts` — SMA/EMA/BOLL/STOCH/PSAR/Ichimoku をクライアント側で計算
- `lib/data.ts` — `genSeries`（未知銘柄向けプレースホルダー OHLC）+ `retime()` でタイムフレーム変換。15 銘柄の事前生成は廃止済み
- `lib/futureBars.ts` — 未来バーの時刻計算ヘルパ。`nextBarTimestamp(prevT, tf)` でタイムフレームごとの次バー時刻を返し、`barTimestampAt(data, idx, tf)` でデータ範囲外のインデックスにも安全に対応する
- `hooks/useChartData.ts` — `symbols.join(',')` を useEffect 依存にして配列の参照等価性問題を回避している
- `styles/globals.css` — 4 種カラーテーマ (`data-aesthetic`) を CSS カスタムプロパティで切替。表示密度はコンパクト固定（`--row-h` / パネル幅を `:root` に定義）

### 共有型 (`packages/shared-types/src/index.ts`)

- `PreloadApi` — `getBackendUrl / platform / appVersion` の型定義
- `Window` グローバル拡張 — `window.kanata?: PreloadApi`
- メインプロセスとレンダラーの両ワークスペースからエイリアス `@kanata/shared-types` で参照

### 型定義 (`apps/renderer/src/types.ts`)

`OHLCBar` / `Ticker` / `AppState` / `DrawingObject` / 各インジケーター結果型が集中管理されている。`AppState` は `drawings: DrawingObject[]` と `selectedDrawingId: number | null` を持つ。新しい描画ツールやインジケーターを追加する際はここを起点に変更する。`AppState.showDrawings` は描画レイヤーの表示フラグ。false でも `drawings` は保持され、アラートも従来どおり発火する。

## 実装上の注意点

- **`ELECTRON_RUN_AS_NODE=1` を絶対に継承させない**。VSCode の Electron 拡張がこの変数をセットするため、`npm run dev` は `scripts/dev.cjs` 経由で削除してから起動する
- **プリロードは CJS 形式でビルドする**。`package.json` の `"type": "module"` があると Rollup は `.mjs` を生成するが、Electron のサンドボックス化プリロードは ESM `import` 構文をサポートしない。`electron.vite.config.ts` の preload セクションに `format: 'cjs'` と `entryFileNames: '[name].js'` が設定済み
- **サイドカーポートは動的**。uvicorn を `--port 0` で起動し、ログの正規表現でポートを検出する。ハードコードした `8000` ではなく必ず `getBackendUrl()` 経由で URL を取得する
- **DB パスは `app.getPath('userData')`**。Windows では `%APPDATA%/kanata/kanata.db`。`sqlite:///` プレフィックス + スラッシュ統一済み（`pythonSidecar.ts` で `replace(/\\/g, '/')` を適用）
- **タイムフレーム文字列は前後で違う**。フロントは `5m/15m/60m/1D/1W/1M`、yfinance は `5m/15m/60m/1d/1wk/1mo`。変換は必ず `INTERVAL_MAP` 経由にする
- **JP 銘柄コードは 4 桁数字**（例 `7203`）。yfinance に渡す前に `.T` を付ける処理が `to_yf_symbol` に集約されているので、新規ルートで yfinance を呼ぶ場合も同関数を使う
- **描画ツールは OHLC インデックスと価格で保存**（`DrawingObject`）、座標ではない。タイムフレーム変更でも位置が維持される設計
- **描画の表示/非表示は `state.showDrawings`**。左パネル「描画ツール」ヘッダの目アイコンまたは `H` キーで切替。非表示中は `Chart.tsx` のオーバーレイ描画・`hitTest`・`onPointerDown` のツール判定の 3 箇所が抑制される（描画を止めるだけだと見えない線を掴めてしまい、掴めなくするだけだと見えない線を新規作成できてしまう）。非表示化時は `toggleDrawingsVisibility` が `activeTool` をパンへ戻す。この状態は永続化せず、`loadState` が起動時に必ず `true` へ戻す
- **チャートの単独キーショートカットを無視させたい領域には `data-chart-shortcuts="off"` を付ける**（`SHORTCUT_OPT_OUT_SELECTOR`）。フォーム要素の判定は `isTypingTarget` に集約されており、`select` もブラウザの type-ahead と衝突するため入力対象として扱う
- **未来バーへの描画**: `Chart.tsx` の `MAX_FUTURE_BARS = 120` で最大 120 バー先の空白領域にパン・描画できる。未来インデックス（`idx >= data.length`）の時刻計算は `lib/futureBars.ts` の `barTimestampAt` に集約されており、新規でタイムスタンプが必要な場合も同関数を使う
- **Canvas は高 DPI 対応**（`devicePixelRatio`）。サイズ計算を触るときは論理ピクセルと物理ピクセルの区別に注意
- **Chart サブペインの Y 座標チェーン**（[Chart.tsx:70-74](apps/renderer/src/components/Chart/Chart.tsx#L70-L74)）に手を入れない。ペインの高さを変えるときは `priceH` の計算（`gapsToLastPane` ternary）だけを変更する
- **ウォッチリスト API のテスト**：`backend/tests/` に pytest 実装済み（`test_models.py` 5 件 + `test_watchlists_api.py` 10 件）。`conftest.py` は tempfile SQLite + `app.dependency_overrides[get_db]` でテスト分離
- **バックテストの依存方向は `scripts/ → services/ → analysis/` の一方向**。`analysis/backtest.py` に I/O を持ち込まない（純関数の契約。テストがネットワークもファイルも触らずに済むのはこの分離のため）
- **ウォークフォワードで未来を参照しない**。各時刻 t で `detect_n_pattern` に渡すのは `df.iloc[:t+1]` のみ。`precompute_series` の返り値は **df の先頭（位置 0）から始まるスライスに対してのみ有効**で、途中から切ったスライスに使うと ATR/MACD の位置がずれる
- **打ち切りイベントは `None` を返す（0 で埋めない）**。保有期間が尽きたシグナルを 0% として混ぜるとリターンが薄まる。Parquet では nullable dtype（`Float64` / `Int64`）で欠損のまま保持する
- **ブートストラップの再抽出単位は日付（銘柄ではない）**。同じ日に出たシグナルは互いに独立でないため、銘柄単位で引くと信頼区間が実際の 1/3 程度に狭まり、有意でないものが有意に見える
- **重複シグナルは記録を残し、除外は集計側で行う**。`mark_overlaps` は `overlaps_prev` を立てるだけでレコードを消さない（`backtest_report.py` が既定で除外し、`--include-overlaps` で戻せる）
- **重複判定のアンカーは「直前に**残った**シグナル」**（直前のシグナルではない）。単に直前のシグナルを基準にすると重複が連鎖し、何とも重なっていない独立イベントまで落ちる（実測で約 35% が消えた）
- **ランダムエントリーの母集団はユニバース全体**。シグナルが出た銘柄だけから引くと帰無分布が N字側に寄り、有意判定が甘くなる。`backtest_report.py --universe` で指定し、母集団が痩せている場合はレポート本文に警告が入る
- **有意性は「差」をブートストラップして判定する**。N字の点推定をランダム分布のパーセンタイルに当てるだけでは N字側の不確実性が入らず、数十イベント規模では過大評価になる（`paired_block_bootstrap_diffs`）
- **OHLCV の銘柄コードは `is_valid_symbol` を通す**。ユーザがアップロードした CSV の `code` 列がそのままファイルパスになるため、検証しないと `../../foo` でストア外へ書き出せる。読みは None、書きは ValueError
- **`sanity_check` は判定のみで除去しない**。1306.T は yfinance 側で分割が記録されずスケール異常のスパイクを出した実績がある（`macro_provider._despike` が存在する理由）。fetch 時に警告を stderr へ出し、補正するかは人間が判断する
- **「どのバーが壊れているか」は `anomalous_bars`、「この銘柄は怪しいか」は `sanity_check`**。`sanity_check` は日次リターン基準なので、異常が 2 本続くと**境界しか発火せず**内側が漏れ、代わりに復帰した無傷のバーが挙がる（1306 の 2026-03-30/31 で 03-30 と 04-01 が出た）。バー単位のマスクに使うと壊れたバーが残り、符号反転がそのまま通る。`anomalous_bars` はローリング中央値比（`macro_provider._despike` と同じ半幅 5 / 倍率 3.0）で**バーそのもの**を判定し、`Open` も見る（ベンチのエントリー価格は `Open` なので、Close 無傷 + Open 破損は `sanity_check` では絶対に挙がらない）。`partition_by_quality` は銘柄単位の真偽値しか要らないので `sanity_check` のままでよい
- **差分更新では履歴の「長さ」も判定する**（`needs_backfill`）。`needs_full_refetch` は重なり区間の価格しか見ないため、一度短く保存されたファイルは差分更新では永久に復旧しない — `REFRESH_PERIOD`（1y）で取り直した `recent` に古い日付が無く、merge 結果が `old` と一致して `unchanged` に固定される（実測で 5 銘柄が 243 行のまま放置されていた）。取り直した結果は必ず `old` と比較して `unchanged` に落とすこと。無条件に書き込むと新規上場銘柄が毎回 `updated` になる
- **品質フィルタは N字側とランダム側の両方に掛ける**（`backtest_report.resolve_populations` が除外集合を返し、`main` が `raw` からも落とす）。上場廃止・再上場を跨いだ系列はベンダーが負値や桁違いの Close を返し、**1 サンプル引かれただけで平均が桁ごと壊れる**（8303 でランダム平均 fwd20 が 287754% になった）。片側だけ落とすと、差を取る 2 つの平均が別の母集団の上で計算されペアードブートストラップの前提が壊れる。ユニバース CSV を読めずシグナル銘柄へフォールバックする経路（`backend/data/*` は git 管理外なのでクリーンな clone では普通に踏む）でも必ずフィルタを通す。除外は集計側だけで行い、ストアの値は生のまま残す
- **前方リターンはバー数だけでなく暦日スパンも見る**（`within_calendar_span`）。疎な index では 20 バー先が 2 年先になる（8303 で実測 825 日）。判定は両側が通る 2 箇所——シグナル日→エントリー日は `resolve_entries`、エントリー日→決済日と MFE 窓は `compute_outcomes`——に置く。片側の集計コードだけで落とすと母集団が食い違う
- **ベンチマーク（1306）にも同じ品質検査を通す**（`backtest_report.benchmark_bad_dates`）。銘柄側の不良は母集団から外せば済むが、**ベンチは全シグナルの超過リターンに入る単一障害点**。実測で 1306 の 2026-03-30/31 が 1/10 のスケール異常を出し、集計全体の平均を -0.57% と +0.72% の間で符号ごと裏返した（`partition_by_quality` はユニバース銘柄しか見ておらずベンチは素通りしていた）。**歪度が大きく負に振れていたら疑う**（実測 -19.9）
- **ベンチ汚染で落とすのは窓の両端だけ**（`contaminated_entry_dates`）。`benchmark_outcome` は `close[i+h]/open[i]` しか計算しないので、不正バーが窓の途中にあっても値に入らない。区間 `[j-horizon, j]` を丸ごと落とすと本来の 60 倍（実測 23100 セル）を欠損にする。落とすのは `i = j` と `i = j - horizon` の 2 点のみ。行ごと消さず**該当列だけ欠損**にする（生リターンを使う §3 のブートストラップまで母数が減るため）
- **エントリー日 → ベンチ位置の写像は `benchmark_entry_index` に一本化する**。`benchmark_outcome` は `bisect_left` で直後の営業日へ丸めるので、マスク側が日付の完全一致で照合すると**丸めた先で不正バーを踏んだケースがすり抜ける**（銘柄ごとに営業日が違うため、ベンチに無いエントリー日は普通に出る）。マスクのホライズンも固定値ではなく `backtest.FWD_HORIZONS` を既定にする — 列が無ければ `continue` する作りなので、ホライズンを増やしたときに新しい列だけ無警告でマスク対象から外れる
- **要素別寄与は生リターンではなく超過リターンで見る**（`_section_factors`）。要素の発火は相場局面と相関する（出来高急増も MACD の GC も強い地合いで増える）ため、生 fwd20 では「要素が効いた」のか「その要素が出やすい時期の地合いが良かった」のかを分離できない。実測で `sd_volume` が生 +0.16% → 超過 -0.03% と符号ごと変わった。**平均と中央値の差が開く要素は外れ値駆動を疑う**
- **スコア帯は固定値ではなく分位で切る**（`score_bands`）。満点は加点要素の構成に依存する — `TREND_BONUS` を 0 にした時点で満点が 100 → 75 になり、固定帯の 85-100 が n=0 の空行になった。ただし**件数の分位を素朴に取ると境界が最頻値に重複して帯が 1 本に潰れる**（スコアは離散値で最頻値に集中する）ので、出現値が少なければ 1 値 1 帯、それでも足りなければ値の分位へ落とす 3 段構え。要求本数より減ったら §2 に警告を出す（黙って出すと「単調に増えている」と読める 1 行になる）
- **スクリーニング UI にスコアを出さない**（`docs/screening_ui_repositioning_plan.md`）。スコアにも構成要素にも前方リターンの予測力が無いことが確定したため、順位付けは `break_date` 降順（同着は ticker 昇順）、絞り込みは鮮度（暦日）で行う。要素は合成せず `lib/screeningView.ts` の `toBadges` でバッジ表示し、**良し悪しを示す配色を使わない**（強調した瞬間に「有望」と読まれ、消したはずの期待値の含意が戻る）。`trend` と `duration_penalty` をバッジに含めないのは前者が常に 0・後者が 3 年で 1 件だから。`score` / `score_detail` は API レスポンスには残す（再検証の経路を潰さないため）
- **`TREND_BONUS = 0` は検証結果**（2026-07）。超過リターン基準・日付ブロックブートストラップで発火群 − 非発火群 = -0.65%（95% CI [-1.31%, -0.05%]）。25 点という最大の重みを持ちながら符号が逆だった。**符号を反転させないのは**、連続量（A 手前 20 本の騰落率）との相関が -0.02 しかなく単調な関係が無いため — 反転は閾値付近の二値でしか成立せず in-sample への当てはめになる。判定経路と `score_detail["trend"]` は残してあるので、再検証は定数を戻すだけでよい（ただし 0 の間は §4 の trend 行が n/a になり監視できない）
- **ローソク足パターンは TS と Python の同値実装で、片方だけ変更してはいけない**。チャートに描かれるものと検証対象がズレると検証結果を UI に持ち込めない。追加の手順は次の 5 つ。**定数名が両言語で違う**ので取り違えないこと。
  1. `types.ts` の `CandlePatternType` union に型名を足す（TS 側はこれが起点。`Record<CandlePatternType, _>` が以降の登録漏れを tsc に検出させる）
  2. 両言語に検出器（純関数）を書く
  3. 3 箇所に登録する — TS は `DETECTORS`・`PATTERN_LABELS`・`PATTERN_SIGNALS`、Python は `DETECTORS`・`LABELS`・`SIGNALS`
  4. `lib/patternView.ts` の `PATTERN_DISPLAY_ORDER` に足す（tsc が強制できない唯一の登録先）
  5. 共有フィクスチャ `tests/fixtures/candle_patterns_cases.json` に陽性ケースを足す（TS 側 `candlePatternsParity.test.ts` と Python 側 `test_candle_patterns.py` の両方が読む）
- **表示ラベルの真実源は `PATTERN_LABELS`（TS）/ `LABELS`（Python）/ 共有フィクスチャの `labels` の 3 者**。UI 側にラベル文字列を写し書きしない（写した時点で一致テストの管轄外になる）。チップの表示順は `lib/patternView.ts` の `PATTERN_DISPLAY_ORDER` で、tsc が配列の網羅を強制できないため `__tests__/patternView.test.ts` が漏れを落とす
- **`hammer` はトレンド文脈で三分されている**（下降後=ハンマー / 上昇後=首吊り線 / 横ばい=どちらも出さない。`HAMMER_TREND_LOOKBACK = 10` / `HAMMER_TREND_RATIO = 0.05`）。形状だけで判定していた旧定義は上昇後のハンマーに強気ラベルを出していた。**Python の `shooting_star` は文脈を見ない非対称が残っている**（UI に出さない検出器のため。解消は別フェーズ）

## CI/CD

ワークフローは `.github/workflows/` に 2 本ある。

### リリースフロー

```
package.json の version を変更して main に push
        ↓
tag-on-version-change.yml
  └─ v{version} タグを自動生成・push（GH_PAT 使用）
        ↓
release.yml（タグ push をトリガー）
  ├─ npm ci
  ├─ Python リソースキャッシュ（resources-py3.12.9-{hash}）
  ├─ npm run build（electron-vite）
  ├─ electron-builder --win nsis（NSIS インストーラ生成）
  ├─ リリースノート生成（前タグからのコミット差分）
  └─ GitHub Release 作成 + .exe アタッチ
```

### ワークフロー詳細

| ファイル | トリガー | 実行環境 | 役割 |
|---|---|---|---|
| `tag-on-version-change.yml` | `main` への `package.json` 変更 push | ubuntu-latest | `v{version}` タグを生成 |
| `release.yml` | `v*.*.*` タグ push | windows-latest | ビルド・パッケージ・GitHub Release 作成 |

### Secrets

| 名前 | 用途 |
|---|---|
| `GH_PAT` | タグ push（`GITHUB_TOKEN` で push したタグは他 WF をトリガーしないため必須） |
| `WIN_CSC_LINK` | Authenticode コード署名証明書（未設定時は署名スキップ） |
| `WIN_CSC_KEY_PASSWORD` | 上記証明書のパスワード |

### バージョン更新手順

`main` で以下を実行するだけでリリースが始まる（`scripts/release.cjs`）。

```bash
npm run release -- 1.1.0            # 通常のリリース
npm run release -- 1.1.0 --dry-run  # チェックと生成メッセージの確認のみ
```

スクリプトが行うこと:

1. 事前チェック（semver `x.y.z` / 現行版より新しい / `main` ブランチ / 作業ツリーがクリーン / `origin/main` に遅れていない / `v{version}` タグ未存在）
2. `npm run typecheck`（`--with-tests` を付けると `npm test` も実行）
3. リリースノート本文の生成（前タグ`..HEAD` の `--no-merges` コミット件名。`--notes "<本文>"` で上書き可）
4. 内容を表示して確認プロンプト（`--yes` でスキップ）
5. `npm version <x.y.z> --no-git-tag-version` で `package.json` + `package-lock.json` を更新し、`chore: v{version}` でコミットして `origin main` へ push

push 後はタグ自動生成 → リリース自動実行。**コミット本文が GitHub Release のリリースノートになる**（[release.yml](.github/workflows/release.yml) が `git log -1 --pretty=%b` を読む）ため、bump コミットは必ず `main` の tip に置く。純粋関数のテストは `npm run test:scripts`。

## ブランディング

「KAIROS /TERMINAL」→「KANATA /TERMINAL」にリネーム済み。localStorage キーも `kanata.*` に統一済み。これから追加するキー・表示名も `KANATA` ブランドで揃える。
