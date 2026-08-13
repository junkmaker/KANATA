# KANATA /TERMINAL

[![CI](https://github.com/junkmaker/KANATA/actions/workflows/ci.yml/badge.svg)](https://github.com/junkmaker/KANATA/actions/workflows/ci.yml)

**Karte for Analytical Navigation And Technical Analysis**

TradingView ライクな株式チャートビューアの Windows ネイティブ Electron アプリ。
Python (FastAPI + yfinance) バックエンドをサイドカープロセスとして内包し、React + Vite のフロントエンドと IPC 経由で接続する。Python / Docker / WSL2 のインストール不要で動作する。

---

## 機能

### チャート

- ローソク足チャート（Canvas 描画、高 DPI 対応）
- タイムフレーム切替: 5m / 15m / 60m / 1D / 1W / 1M
- テクニカルインジケーター: SMA / EMA / BOLL / STOCH / PSAR / Ichimoku
- サブペイン表示: Volume / RSI / MACD / Stochastic
- 描画ツール: トレンドライン / 矩形 / 楕円 / 水平線 / 垂直線 / テキスト（5 色パレットから色変更可）
- **未来時間軸へのパン**: 最大 120 バー先の空白領域まで右スクロールし、予測用トレンドラインや矩形を描画できる
- SQ・ウィッチング日マーカー（日足のみ）
- ローソク足パターン検出ビュー（タイプ別フィルタ付き）

### マクロ・スクリーニング

- **マクロダッシュボード**: HY OAS・Fed 純流動性・RSP/SPY 比率を FRED / yfinance から取得し、総合シグナル（緑/黄/赤）付きで表示。期間 3M/6M/1Y/2Y 切替
- **N 字スクリーニング**: 銘柄ユニバース（CSV 登録・複数管理）に対するバックグラウンドスキャン、進捗ポーリング、スコアフィルタ
- **ファンダメンタルズ**: 四半期の売上・利益・ROE/ROIC 等を表示（年次フォールバック対応）
- FRED API キーはアプリ内設定画面から入力・保存可能（OS 暗号化 = Windows DPAPI 経由、平文保存なし）。未設定でも RSP/SPY 系は yfinance のみで部分稼働

### 共通

- ウォッチリスト管理（複数リスト、並べ替え、CRUD）
- 銘柄検索（日本株 4 桁コード対応、`.T` サフィックス自動付与）
- カラーテーマ 4 種 / 密度 2 種
- オフライン時は合成データで動作（サイドカー停止中も UI が壊れない）
- DB 起動時バックアップ（直近 7 世代保持）

---

## アーキテクチャ

```
yfinance / FRED
  └─ FastAPI (uvicorn, --port 0) ← Python サイドカー
       └─ /api/quotes, /api/watchlists, /api/search,
          /api/fundamentals, /api/macro/*, /api/screening/*
            └─ Electron Main (IPC: kanata:backend-url, kanata:fred-key-*)
                 └─ React Renderer (useChartData, useWatchlists, useMacroDashboard,
                                     useScreening, useUniverses)
                      └─ Canvas Chart / Macro Dashboard / Screening Table / Pattern View
```

### プロセス構成

| プロセス | 役割 |
|---------|------|
| Electron Main | ウィンドウ管理・IPC ハンドラ・サイドカー起動/監視・FRED キーの暗号化保存 |
| Python Sidecar | FastAPI REST API・yfinance/FRED データ取得・SQLite 永続化・スクリーニングバックグラウンド実行 |
| React Renderer | チャート/マクロ/スクリーニング/パターン描画・状態管理・API クライアント |

### データフロー

1. `reservePort()` で Node 側がポートを事前確保し `--port <n>` でサイドカーに渡す（ログ正規表現依存なし）
2. サイドカー起動後、`GET /api/health` が 200 を返すまでヘルスチェック待機（最大 20s）
3. クラッシュ時は指数バックオフで最大 2 回自動再起動、失敗時は `kanata:backend-status` で UI に通知
4. レンダラーは合成データと実データの二層構造。サイドカー不在でも動く
5. `view` 状態（チャート / パターン / マクロ / スクリーニング）で main-grid の表示を切替。既存フックは Rules of Hooks 順守で無条件に呼び続ける

---

## ディレクトリ構成

```
KANATA/
├── apps/
│   ├── main/src/             # Electron メインプロセス (TypeScript)
│   │   ├── index.ts          # エントリ・BrowserWindow 生成
│   │   ├── preload.ts        # contextBridge → window.kanata
│   │   ├── ipc/              # IPC チャンネル定数 + ハンドラ登録
│   │   ├── sidecar/          # pythonSidecar.ts — 起動・監視・再起動
│   │   └── lib/               # port.ts (reservePort) / logger.ts / secrets.ts (FRED キー暗号化)
│   └── renderer/src/         # React フロントエンド (TypeScript + Vite)
│       ├── App.tsx            # 全状態の単一ソース（view 切替含む）
│       ├── components/
│       │   ├── Chart/         # Canvas 描画 (Chart.tsx + subpanes/ + overlays/)
│       │   ├── Macro/         # マクロダッシュボード (カード・折れ線・シグナルバッジ)
│       │   ├── Screening/     # N 字スクリーニング (テーブル・ユニバース選択)
│       │   ├── Patterns/      # ローソク足パターン検出ビュー
│       │   ├── Settings/      # FRED API キー入力 (ApiKeyField)
│       │   ├── LeftPanel/ RightPanel/  # ウォッチリスト・詳細パネル
│       │   └── TopBar.tsx / StatusBar.tsx / TweaksPanel.tsx / WindowControls.tsx
│       ├── hooks/             # useChartData / useWatchlists / useMacroDashboard / useScreening / useUniverses
│       └── lib/               # backendUrl / watchlistApi / macroApi / screeningApi / indicators / candlePatterns / data
├── packages/
│   └── shared-types/src/     # PreloadApi 型 + Window 宣言 (main/renderer 共通)
├── backend/src/               # FastAPI サイドカー (Python)
│   ├── main.py                # エントリ・CORS・lifespan
│   ├── routes/                # quotes / search / watchlists / fundamentals / macro / screening
│   ├── services/              # yfinance_provider / fred_provider / macro_provider / screening_provider /
│   │                          #   universe_provider / storage / cache (TTLCache)
│   ├── config/                # macro_thresholds.json + macro_config.py（閾値はハードコード禁止・JSON 編集のみ）
│   ├── db/                    # SQLAlchemy 2.x + SQLite
│   └── schemas/                # Pydantic v2 スキーマ・ApiResponse エンベロープ
├── tests/e2e/                 # Playwright E2E テスト
├── docs/                      # ユーザーガイド・アーキテクチャ図・API 仕様・リリースチェックリスト
├── electron.vite.config.ts
├── playwright.config.ts
└── package.json               # npm workspaces ルート
```

---

## 前提条件

| ツール | バージョン |
|--------|-----------|
| Node.js | 20 以上 |
| Python | 3.11 以上 |
| npm | 10 以上 |

> リリース版インストーラ（`.exe`）を使う場合は Python 不要。

---

## セットアップ

```bash
# 1. 依存インストール
npm install

# 2. Python 依存インストール
cd backend && pip install -r requirements.txt && cd ..

# 3. 開発起動 (Electron + Vite dev server + Python sidecar)
npm run dev
```

`npm run dev` は `scripts/dev.cjs` 経由で実行される。VSCode から起動した際に継承される `ELECTRON_RUN_AS_NODE=1` を自動除去してから `electron-vite dev` を呼ぶ。

### 環境変数（オプション）

| 変数 | 説明 | デフォルト |
|------|------|-----------|
| `KANATA_BACKEND_DIR` | バックエンドディレクトリのパス上書き | `app.getAppPath()/backend` |
| `KANATA_PYTHON` | Python 実行ファイルパスの上書き | システム `python` / `python3` |
| `KANATA_ALLOWED_ORIGINS` | 追加 CORS オリジン（カンマ区切り） | 空 |
| `FRED_API_KEY` | マクロ指標（HY OAS・純流動性）用 FRED API キー | 未設定（アプリ内設定画面からも登録可、OS 暗号化で保存） |

> FRED API キーはアプリ起動後の設定画面から入力するのが推奨。環境変数で渡す場合はシェル/OS に設定すれば sidecar 起動時に自動継承される。未設定でも RSP/SPY 指標は yfinance のみで動作する（部分稼働）。

---

## 開発コマンド

```bash
# 型チェック (renderer + main)
npm run typecheck

# Lint / フォーマット (Biome)
npm run check        # lint + format チェック
npm run check:fix    # 自動修正

# プロダクションビルド
npm run build

# NSIS インストーラ生成
npm run dist

# バックエンド単独起動（デバッグ用）
cd backend && uvicorn src.main:app --reload --port 8000
```

---

## CI

`.github/workflows/ci.yml` が PR と `main` への push で以下を並列実行する。

| ジョブ | 内容 |
|---|---|
| `lint` | `biome ci . --error-on-warnings`（**警告・info も CI を落とす**） |
| `typecheck` | `npm run typecheck`（renderer + main） |
| `test-js` | `test:main` / `test:renderer` / `test:scripts` |
| `test-backend` | `pytest`（Python 3.12 = 同梱ディストリと同じ系列） |
| `build` | `npm run build`（electron-vite build。preload の CJS 出力崩れを検出する） |

- ランナーは全ジョブ **windows-latest**。`@biomejs/cli-win32-x64` を直接 devDependency に持つため、Linux ランナーでは `npm ci` が EBADPLATFORM で失敗する
- **E2E（Playwright）と `npm run dist` は CI 対象外**。ビルド済みバイナリ・GUI セッション・埋め込み Python の構築が要るため、リリース時の `release.yml` が担当する
- 手元の `npm run check` にも `--error-on-warnings` を付けてあるので、CI と判定がずれない（フラグが無いと warn 級ルールはローカルだけ exit 0 になり、CI で初めて赤くなる）

---

## テスト

### 全テスト実行

```bash
npm test
# = test:main + test:renderer + test:backend
```

### ユニットテスト（Vitest）

```bash
# Electron メインプロセス
npm run test:main

# React レンダラー
npm run test:renderer
```

テストファイルの配置:

```
apps/main/src/__tests__/
  ├── pythonSidecar.test.ts   # resolveBackendDir / resolvePythonExecutable
  └── port.test.ts            # reservePort
apps/renderer/src/__tests__/
  ├── backendUrl.test.ts      # getBackendUrl リトライ・キャッシュ
  └── extraTicker.test.ts     # スクリーニング選択銘柄の合成 Ticker 化
```

### バックエンドテスト（pytest）

```bash
npm run test:backend
# = cd backend && python -m pytest -v
```

テストファイルの配置:

```
backend/tests/
  ├── conftest.py               # tempfile SQLite + dependency_overrides
  ├── test_models.py            # ORM ユニットテスト
  ├── test_watchlists_api.py    # ウォッチリスト API 統合テスト
  ├── test_quotes_api.py        # quotes API テスト
  ├── test_search_api.py        # 銘柄検索 API テスト
  ├── test_macro_api.py         # マクロ API 統合テスト
  ├── test_macro_provider.py    # マクロ集計・シグナル判定ロジック
  ├── test_screening_api.py     # スクリーニング API テスト
  ├── test_universe_api.py      # ユニバース管理 API テスト
  └── test_n_pattern.py         # N 字パターン検出ロジック
```

### E2E テスト（Playwright）

```bash
npm run test:e2e
```

E2E はアプリ起動後に UI 操作をブラウザ自動化で検証する。設定は [playwright.config.ts](playwright.config.ts) 参照。

---

## ビルドとリリース

### インストーラ生成手順

```bash
# 1. Python 環境をバンドル用に準備（PowerShell スクリプト）
npm run prepare:dist

# 2. NSIS インストーラをビルド
npm run dist
# → release/KANATA-Terminal-Setup-x.x.x.exe
```

`resources/python/` と `resources/backend/` は `.gitignore` に含まれており、CI/CD での別途準備が必要。

リリース前の手動確認事項は [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) を参照。

---

## ログとデータ

| 種別 | パス |
|------|------|
| メインログ | `%APPDATA%\KANATA Terminal\logs\main.log` |
| サイドカーログ | `%APPDATA%\KANATA Terminal\logs\sidecar.log` |
| DB | `%APPDATA%\KANATA Terminal\kanata\kanata.db` |
| DB バックアップ | `%APPDATA%\KANATA Terminal\backups\kanata.db.<date>` (7 世代保持) |
| FRED API キー | `%APPDATA%\KANATA Terminal\fred-api-key.bin`（OS 暗号化、平文保存なし） |

アプリ内メニュー → ヘルプ → ログフォルダを開く でエクスプローラから直接確認できる。

---

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [docs/user-guide.md](docs/user-guide.md) | エンドユーザー向け操作ガイド |
| [docs/completed/n_pattern_screening_spec.md](docs/completed/n_pattern_screening_spec.md) | N 字スクリーニングの仕様 |
| [docs/completed/backtest_gotchas.md](docs/completed/backtest_gotchas.md) | バックテストとデータ品質の落とし穴 |
| [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) | リリース前の手動確認事項 |

## コントリビューター向け注意事項

- **`ELECTRON_RUN_AS_NODE=1` を継承させない**: VSCode の Electron 拡張がこの変数をセットするため、`npm run dev` は必ず `scripts/dev.cjs` 経由で実行する
- **プリロードは CJS ビルド必須**: Electron サンドボックス化プリロードは ESM `import` 構文を未サポート。`electron.vite.config.ts` で `format: 'cjs'` を設定済み
- **ポートはハードコードしない**: サイドカーは動的ポート方式（`reservePort()` で事前確保）。URL 取得は必ず `getBackendUrl()` 経由
- **タイムフレーム文字列の変換**: フロント側は `5m/15m/60m/1D/1W/1M`、yfinance 側は `5m/15m/60m/1d/1wk/1mo`。変換は `INTERVAL_MAP` に集約済み
- **JP 銘柄コード**: 4 桁数字（例: `7203`）を yfinance に渡す前に `.T` を付ける処理が `to_yf_symbol()` に集約されている
- **Canvas の高 DPI**: `devicePixelRatio` を考慮。論理ピクセルと物理ピクセルを区別する
- **マクロ閾値のハードコード禁止**: `config/macro_thresholds.json` の編集のみで変更する
