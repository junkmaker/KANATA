# KANATA /TERMINAL

**Karte for Analytical Navigation And Technical Analysis**

TradingView ライクな株式チャートビューアの Windows ネイティブ Electron アプリ。
Python (FastAPI + yfinance) バックエンドをサイドカープロセスとして内包し、React + Vite のフロントエンドと IPC 経由で接続する。Python / Docker / WSL2 のインストール不要で動作する。

---

## 機能

- ローソク足チャート（Canvas 描画、高 DPI 対応）
- タイムフレーム切替: 5m / 15m / 60m / 1D / 1W / 1M
- テクニカルインジケーター: SMA / EMA / BOLL / STOCH / PSAR / Ichimoku
- サブペイン表示: Volume / RSI / MACD / Stochastic
- ウォッチリスト管理（複数リスト、並べ替え、CRUD）
- 銘柄検索（日本株 4 桁コード対応、`.T` サフィックス自動付与）
- カラーテーマ 4 種 / 密度 2 種
- オフライン時は合成データで動作（サイドカー停止中も UI が壊れない）
- DB 起動時バックアップ（直近 7 世代保持）

---

## アーキテクチャ

```
yfinance
  └─ FastAPI (uvicorn, --port 0) ← Python サイドカー
       └─ /api/quotes, /api/watchlists, /api/search
            └─ Electron Main (IPC: kanata:backend-url)
                 └─ React Renderer (useChartData, useWatchlists)
                      └─ Canvas Chart
```

### プロセス構成

| プロセス | 役割 |
|---------|------|
| Electron Main | ウィンドウ管理・IPC ハンドラ・サイドカー起動/監視 |
| Python Sidecar | FastAPI REST API・yfinance データ取得・SQLite 永続化 |
| React Renderer | チャート描画・状態管理・API クライアント |

### データフロー

1. `reservePort()` で Node 側がポートを事前確保し `--port <n>` でサイドカーに渡す（ログ正規表現依存なし）
2. サイドカー起動後、`GET /api/health` が 200 を返すまでヘルスチェック待機（最大 20s）
3. クラッシュ時は指数バックオフで最大 2 回自動再起動、失敗時は `kanata:backend-status` で UI に通知
4. レンダラーは合成データと実データの二層構造。サイドカー不在でも動く

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
│   │   └── lib/              # port.ts (reservePort) / logger.ts
│   └── renderer/src/         # React フロントエンド (TypeScript + Vite)
│       ├── App.tsx            # 全状態の単一ソース
│       ├── components/Chart/  # Canvas 描画 (Chart.tsx + subpanes/)
│       ├── hooks/             # useChartData / useWatchlists / useDebouncedSearch
│       └── lib/               # backendUrl / watchlistApi / indicators / data
├── packages/
│   └── shared-types/src/     # PreloadApi 型 + Window 宣言 (main/renderer 共通)
├── backend/src/              # FastAPI サイドカー (Python)
│   ├── main.py               # エントリ・CORS・lifespan
│   ├── routes/               # quotes / search / watchlists
│   ├── services/             # yfinance_provider / cache (TTLCache)
│   ├── db/                   # SQLAlchemy 2.x + SQLite
│   └── schemas/              # Pydantic v2 スキーマ・ApiResponse エンベロープ
├── tests/e2e/                # Playwright E2E テスト
├── docs/                     # electron.plan.md / RELEASE_CHECKLIST.md
├── electron.vite.config.ts
├── playwright.config.ts
└── package.json              # npm workspaces ルート
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

---

## 開発コマンド

```bash
# 型チェック (renderer + main)
npm run typecheck

# プロダクションビルド
npm run build

# NSIS インストーラ生成
npm run dist

# バックエンド単独起動（デバッグ用）
cd backend && uvicorn src.main:app --reload --port 8000
```

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
  └── backendUrl.test.ts      # getBackendUrl リトライ・キャッシュ
```

### バックエンドテスト（pytest）

```bash
npm run test:backend
# = cd backend && python -m pytest -v
```

テストファイルの配置:

```
backend/tests/
  ├── conftest.py             # tempfile SQLite + dependency_overrides
  ├── test_models.py          # ORM ユニットテスト (5 件)
  └── test_watchlists_api.py  # API 統合テスト (10 件)
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

アプリ内メニュー → ヘルプ → ログフォルダを開く でエクスプローラから直接確認できる。

---

## 実装状況

| フェーズ | 内容 | 状態 |
|---------|------|------|
| Phase 1 | Electron 基本起動・サイドカー接続 | 完了 |
| Phase 2 | サイドカー堅牢化・IPC 拡張・SQLite 永続化 | 完了 |
| Phase 3 | NSIS インストーラ・Python バンドル | 完了 |
| Phase 4 | チャート機能（インジケーター・描画ツール・TF 切替） | 完了 |
| Phase 5 | Vitest ユニットテスト・Playwright E2E 骨格・リリースチェックリスト | 完了 |

詳細は [docs/electron.plan.md](docs/electron.plan.md) を参照。

---

## コントリビューター向け注意事項

- **`ELECTRON_RUN_AS_NODE=1` を継承させない**: VSCode の Electron 拡張がこの変数をセットするため、`npm run dev` は必ず `scripts/dev.cjs` 経由で実行する
- **プリロードは CJS ビルド必須**: Electron サンドボックス化プリロードは ESM `import` 構文を未サポート。`electron.vite.config.ts` で `format: 'cjs'` を設定済み
- **ポートはハードコードしない**: サイドカーは動的ポート方式（`reservePort()` で事前確保）。URL 取得は必ず `getBackendUrl()` 経由
- **タイムフレーム文字列の変換**: フロント側は `5m/15m/60m/1D/1W/1M`、yfinance 側は `5m/15m/60m/1d/1wk/1mo`。変換は `INTERVAL_MAP` に集約済み
- **JP 銘柄コード**: 4 桁数字（例: `7203`）を yfinance に渡す前に `.T` を付ける処理が `to_yf_symbol()` に集約されている
- **Canvas の高 DPI**: `devicePixelRatio` を考慮。論理ピクセルと物理ピクセルを区別する
