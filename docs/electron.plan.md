# KANATA Electron 移行計画

Docker + WSL2 構成から Windows 向け Electron アプリへの移行計画。
Python (FastAPI) バックエンドをサイドカーとして起動し、React + Vite のレンダラーと IPC を介して接続する。

- 対象プラットフォーム: Windows 10/11 (x64)
- ランタイム: Electron 40 (Chromium 146 / Node 24)
- ビルド: electron-vite + electron-builder (NSIS)

---

## 関連ファイル一覧（現状スナップショット）

| 種別 | パス |
|---|---|
| Electron メイン | `apps/main/src/index.ts` |
| サイドカー制御 | `apps/main/src/sidecar/pythonSidecar.ts` |
| IPC ブリッジ | `apps/main/src/ipc/bridge.ts` |
| プリロード | `apps/main/src/preload.ts` |
| ローカル DB（退避候補） | `apps/main/src/db/database.ts` |
| 共有型 | `packages/shared-types/src/index.ts` |
| バックエンド URL 解決 | `apps/renderer/src/lib/backendUrl.ts` |
| API クライアント | `apps/renderer/src/lib/{api,watchlistApi,searchApi}.ts` |
| Vite 型参照 | `apps/renderer/src/vite-env.d.ts` |
| Vite 設定 (単体) | `apps/renderer/vite.config.ts` |
| Electron-Vite 設定 | `electron.vite.config.ts` |
| FastAPI エントリ | `backend/src/main.py` |
| DB 接続 | `backend/src/db/database.py` |
| yfinance 実装 | `backend/src/services/yfinance_provider.py` |
| Python 依存 | `backend/requirements.txt` |
| ルート package.json | `package.json` |

---

## Phase 1 — 完了済み状態の確認（トリアージのみ）

**ゴール**: Phase 2 に着手する前に Phase 1 資産が壊れていないことを確認する。

- [x] `npm run dev` で Electron ウィンドウが起動し、Vite Dev サーバー (`http://localhost:5173`) に接続する
- [x] 起動ログに Python サイドカーのポート取得が表示される
- [x] `[main] Python backend ready at http://127.0.0.1:<PORT>` が表示される
- [ ] DevTools の Console で `await window.kanata.getBackendUrl()` が `http://127.0.0.1:<PORT>` を返す（手動確認要）
- [x] `GET /api/health` が 200 を返す（curl で直接確認済み）
- [x] 終了時にサイドカーが SIGTERM で停止する（`before-quit` フック動作確認済み）

**判定基準**: 上記すべて PASS。失敗時は Phase 2 に進む前に原因をログ付きで記録する。

**解決した問題（2026-04-24）**:
- `ELECTRON_RUN_AS_NODE=1` が VSCode の Electron シェルから継承され `app`/`BrowserWindow` が取得不能 → `scripts/dev.cjs` で削除してから起動
- プリロードパスが `index.js` のまま ESM ビルドの `index.mjs` と不一致 → `apps/main/src/index.ts` を修正
- CORS が `localhost:3000` のみ → `localhost:5173`（Vite dev）と `file://`（prod）を追加

---

## Phase 2 — バックエンド統合（優先度: 高）

**ゴール**: 開発・本番の両環境で Python サイドカーが安定して起動し、レンダラーが IPC 経由でバックエンド URL を解決し、すべての API 呼び出しが `/api/*` に到達する。SQLite は Electron の `userData` に永続化される。

### 2.1 サイドカー起動の堅牢化 (`apps/main/src/sidecar/pythonSidecar.ts`)

現状: ログの正規表現でポートを検出している。uvicorn のバージョンやログレベルによりフォーマットが変わるリスクがある。

**採用方針: 事前ポート確保（Node 側で `net.createServer().listen(0)` → ポート取得 → close → `--port <n>` で明示渡し）**

- [ ] `reservePort()` ユーティリティを `apps/main/src/lib/port.ts` に実装
- [ ] `pythonSidecar.ts` の起動引数に `--port <n>` を追加し、ログパースによるポート検出を廃止
- [ ] `child.once('exit', ...)` で異常終了時に最大 2 回まで指数バックオフで再起動。限界超過時は IPC でレンダラーにエラー通知
- [ ] Windows では `child.kill()` が届かない場合があるため、`taskkill /pid <pid> /T /F` をフォールバックとして追加（`process.platform === 'win32'` 分岐）
- [ ] ヘルスチェック待機: `startPythonSidecar` の解決条件を「ポート取得」＋「`GET /api/health` が 200」まで待つ（タイムアウト 20s）
- [ ] 軽量ロガーを `apps/main/src/lib/logger.ts` に導入: dev は stdout、prod は `userData/logs/main.log` / `userData/logs/sidecar.log`

### 2.2 CORS の動的ポート対応 (`backend/src/main.py`)

現状: `allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"]` で固定。

- [ ] 環境変数 `KANATA_ALLOWED_ORIGINS` からオリジンを取得する形に変更
- [ ] `allow_origin_regex` で `^file://` を許可（prod の file:// オリジン対応）
- [ ] サイドカー起動時の `env` に `KANATA_ALLOWED_ORIGINS` を渡す（`pythonSidecar.ts`）
- [ ] 旧 `localhost:3000` 参照をコード・ドキュメントから削除

### 2.3 SQLite を Electron userData に配置

現状: `DATABASE_URL=sqlite:///${dbPath}` をサイドカーに渡しているが、Windows では `sqlite:///C:/...` 形式が必要。

- [ ] `dbPath` を `path.resolve` → スラッシュ統一 → `sqlite:///` プレフィックス付与の処理を `pythonSidecar.ts` に実装
- [ ] DB ディレクトリを `userData/kanata/kanata.db` に統一
- [ ] サイドカー起動前に `mkdirSync(dbDir, { recursive: true })` を Node 側で実行
- [ ] `backend/src/db/database.py` のデフォルトパスは Python 単独起動時のみ使用
- [ ] 起動時に `kanata.db` → `userData/backups/kanata.db.<date>` へコピー（直近 7 世代保持）

### 2.4 バックエンド URL 解決の改善 (`apps/renderer/src/lib/backendUrl.ts`)

- [ ] `getBackendUrl()` にリトライ機構を追加（200ms インターバル × 最大 10 回）
- [ ] IPC チャンネル `kanata:backend-url-changed` でサイドカー再起動時にキャッシュを破棄
- [ ] Electron 判定は `window.kanata` の存在で行う（現状通り）

### 2.5 IPC ブリッジの拡張 (`apps/main/src/ipc/bridge.ts`, `apps/main/src/preload.ts`)

追加するチャンネル:

- [ ] `kanata:backend-status` → `{ status: 'starting' | 'ready' | 'crashed' | 'offline', url: string | null, error?: string }`
- [ ] `kanata:open-logs` → `shell.openPath(userData/logs/)` でエクスプローラを開く
- [ ] `kanata:app-version` → `app.getVersion()` を返す（prod では npm_package_version が取れないため IPC 経由に切替）
- [ ] `PreloadApi` 型を `packages/shared-types/src/index.ts` に集約し main/renderer で型共有
- [ ] `webContents.send` でサイドカー状態変化を push → レンダラーの `useEffect` で購読

### 2.6 フロントエンド API クライアントの完全移行

- [ ] `useChartData` / `useWatchlists` / `useDebouncedSearch` がハードコード URL を使っていないか全文 grep で確認
- [ ] タイムアウト統一: `AbortSignal.timeout(10_000)` を `unwrap()` ラッパに組み込む
- [ ] サイドカーオフライン時のフォールバック UX（`status: 'offline'`）を全 API 共通化
- [ ] 旧 `frontend/` ディレクトリが残っていれば `apps/renderer/` への移行完了を確認して削除

### 2.7 better-sqlite3 実装の去就判断 (`apps/main/src/db/database.ts`)

現状: Python (SQLAlchemy) と Node (better-sqlite3) が同じ watchlists テーブルを二重管理している。

**採用方針: Python を正として better-sqlite3 を削除**

- [ ] `apps/main/src/db/database.ts` を `_unused/` へ退避（または削除）
- [ ] `better-sqlite3` / `@types/better-sqlite3` を `apps/main/package.json` から除去
- [ ] `postinstall: electron-builder install-app-deps` の必要性を再評価

### Phase 2 完了条件

- `npm run dev` 起動時、`GET /api/health` / `GET /api/watchlists` / `GET /api/search?q=ap` / `GET /api/quotes/AAPL?timeframe=1D` が成功
- サイドカーを強制終了 → 自動再起動またはレンダラーにエラー通知
- DB ファイルが `%APPDATA%/KANATA/kanata/kanata.db` に生成され、再起動後もウォッチリストが残る
- CORS プリフライトが通り、Console にエラー無し

---

## Phase 3 — パッケージング（優先度: 高）

**ゴール**: `npm run dist` で NSIS インストーラが生成され、Python / Docker / WSL2 なしの Windows 端末で動作する。

### 3.1 electron-builder 設定

- [ ] ルート `package.json` に `build` セクションを追加:
  - `appId: com.kanata.terminal`
  - `productName: KANATA Terminal`
  - `directories.output: release`
  - `asar: true` / `asarUnpack: ["resources/backend/**", "resources/python/**"]`
  - `extraResources`: backend ソース + 埋め込み Python を resources 配下へ
  - `win.target: nsis` / `win.icon: build/icon.ico`
  - `nsis.oneClick: false` / `nsis.allowToChangeInstallationDirectory: true`
- [ ] `build/icon.ico` を用意（256x256 以上、マルチ解像度）
- [ ] `release/` を `.gitignore` に追加済みか確認

### 3.2 Python ランタイムのバンドル戦略

**採用方針: Windows embeddable Python + pip install（PyInstaller より保守が容易）**

| 案 | 長所 | 短所 |
|---|---|---|
| A. embeddable Python + pip（推奨） | 保守容易、hook 不要、デバッグしやすい | 配布物に site-packages が並ぶ |
| B. PyInstaller onedir | Python 非公開 | yfinance/pandas の hook メンテが煩雑、容量 200MB 超 |

- [ ] `scripts/prepare-python-dist.ps1` を新規作成:
  1. `python-3.12.x-embed-amd64.zip` をダウンロードして `resources/python/` に展開
  2. `python312._pth` の `#import site` コメントを外して site-packages を有効化
  3. `get-pip.py` を配置して pip を導入
  4. `pip install --no-cache-dir -r backend/requirements.txt -t resources/python/Lib/site-packages`
  5. `backend/src/` を `resources/backend/src/` にコピー
  6. `__pycache__` / `*.pyc` / `tests/` を削除してサイズ削減
- [ ] `electron-builder` の `beforeBuild` フックでこのスクリプトを自動呼び出し
- [ ] `resolvePythonExecutable()` / `resolveBackendDir()` が `process.resourcesPath` を参照していることを確認

**容量目標**: インストーラ < 200 MB、展開後 < 500 MB

### 3.3 SQLite の初期化・移行戦略

- [ ] 初期化は既存の `backend/src/db/init_db.py`（`create_all` + seed）でカバー
- [ ] Alembic の導入は Phase 6 以降に切り出し
- [ ] Docker 版からの引き継ぎ手順を README に記載: `docker cp kanata-db:/app/data/kanata.db ./`

### 3.4 単一インスタンス制約

- [ ] `app.requestSingleInstanceLock()` をメインプロセス冒頭に追加（ポート競合・DB ロック回避）

### 3.5 ログと診断

- [ ] メインプロセス・サイドカーのログを `userData/logs/` にローテーション付きで書き出し
- [ ] Help メニューに「Open Logs Folder」「Show App Version」を追加

### Phase 3 完了条件

- `npm run dist` が成功し `release/KANATA-Terminal-Setup-x.y.z.exe` が生成される
- Python / Docker / WSL2 なしの端末でインストール・起動・チャート表示まで完了
- インストーラ容量が 250 MB 以下
- アンインストール時にユーザーデータの扱いを確認するダイアログが表示される

---

## Phase 4 — 機能完成度（優先度: 中）

**ゴール**: Web 版で動作していた機能がすべて Electron 上で同等に動く。

### 4.1 既存機能チェックリスト

- [ ] チャート描画: ローソク足 / 折れ線 / 面グラフ / Heikin Ashi
- [ ] インジケーター: SMA / EMA / BOLL / STOCH / PSAR / Ichimoku / MACD / RSI
- [ ] 描画ツール: トレンドライン / 水平線 / フィボナッチ / テキスト
- [ ] ウォッチリスト: CRUD / 並び替え / デフォルト切替 / 検索追加
- [ ] タイムフレーム: 5m / 15m / 60m / 1D / 1W / 1M の切替
- [ ] テーマ: 4 種カラー × 2 種密度の切替と永続化
- [ ] 状態永続化: `kanata.state` / `kanata.aesthetic` / `kanata.density` / `kanata.activeWatchlistId` が再起動後も保持

### 4.2 Electron 固有の改善

- [ ] **カスタムタイトルバー**: `frame: false` + `titleBarStyle: 'hidden'` + `components/TitleBar.tsx`。最小化・最大化・閉じるは IPC 経由
- [ ] **メニューバー**: `Menu.setApplicationMenu` でファイル / 表示 / ヘルプを整備。DevTools 切替・再読み込みを含める
- [ ] **外部 URL ガード**: `setWindowOpenHandler` で外部 URL を `shell.openExternal` にルーティング、`will-navigate` をブロック（既実装済み、再確認のみ）

### 4.3 セキュリティ硬化

- [ ] CSP を `index.html` の `<meta>` で設定: `default-src 'self'; connect-src 'self' http://127.0.0.1:*; img-src 'self' data:;`
- [ ] `webPreferences.sandbox: true` / `nodeIntegration: false` / `contextIsolation: true` を維持

---

## Phase 5 — テスト・品質（優先度: 低）

**ゴール**: 回帰を検知できる最低限の自動テストと手動チェックリストを整備。

### 5.1 単体テスト (Vitest)

- [ ] `pythonSidecar.ts` の純関数 (`resolveBackendDir` / `resolvePythonExecutable`) を Vitest で単体テスト
- [ ] `backendUrl.ts` のキャッシュ動作とリトライを検証（`window.kanata` モック）
- [ ] `backend/tests/` の pytest（15 件）が CORS 変更後も通ることを確認

### 5.2 E2E テスト (Playwright for Electron)

- [ ] `@playwright/test` + Electron launch を `tests/e2e/` に導入
- [ ] シナリオ: 起動 → ウォッチリストに "AAPL" を追加 → チャート表示 → タイムフレーム変更 → アプリ終了

### 5.3 リリース前手動チェックリスト

- [ ] クリーン Windows 11 環境でインストーラから導入し、ウォッチリストに 5 銘柄追加できる
- [ ] オフライン時のフォールバック表示が正しい
- [ ] 日本株 (7203) のタイムフレーム切替が動作
- [ ] ウィンドウ最大化・復元・最小化が正常
- [ ] DPI 変更（100% → 150%）で Canvas 描画が破綻しない
- [ ] アンインストール後、userData を残す / 完全削除の選択が正しく動く

---

## 横断的リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| Windows Defender / SmartScreen による警告 | 初回起動で警告画面 | EV コード署名証明書を Phase 3 終盤で導入。未署名時は README に「詳細 → 実行」手順を明記 |
| yfinance が Yahoo API 変更で壊れる | データ取得全滅 | `yahoo-finance2` (Node) への段階的置換を Phase 6 計画に残す |
| embeddable Python が 3.13 以降で pip 非同梱になる | バンドル失敗 | Python 3.12.x に固定し requirements.txt でバージョン固定 |
| better-sqlite3 と Electron バージョン不整合 | 起動時クラッシュ | Phase 2.7 で削除方針 |
| サイドカーのポート競合 | 起動失敗 | 事前ポート確保（Phase 2.1）で解消 |
| レンダラーの `Origin: null`（file://）CORS エラー | API 疎通不可 | Phase 2.2 で `allow_origin_regex` を追加 |
| Windows の `child.kill()` が Python に届かない | プロセス残留 | Phase 2.1 で `taskkill /T /F` フォールバック |

---

## 実装前に決定すべき重要事項

1. **better-sqlite3 削除 or 保持** (Phase 2.7): Python を正として削除（推奨）か、将来 Python 撤去を見据えて保持か
2. **Python バンドル方式** (Phase 3.2): embeddable Python + pip（推奨）か PyInstaller か
3. **CORS 開発時オリジン** (Phase 2.2): `localhost:3000` を `localhost:5173` に一括置換するタイミング（Phase 2 着手時推奨）

---

## フェーズ順序と並列化メモ

- Phase 2.1 〜 2.3（サイドカー堅牢化・CORS・DB パス）: 直列に実施
- Phase 2.4 〜 2.6（URL 解決・IPC 拡張・API クライアント）: Phase 2.1-2.3 完了後に並列で可
- Phase 2.7（better-sqlite3 削除判断）: Phase 2 の他タスクと独立、先行着手可能
- Phase 3: Phase 2 完了前でも `electron-builder` 設定と Python 埋め込みスクリプトは並行準備可
- Phase 4: Phase 2 で全 API が疎通してから着手
- Phase 5: Phase 4 後半と並行可

---

## 最終的な成功条件

- [ ] Docker / WSL2 無しで開発・配布できる
- [ ] `npm run dev` で 10 秒以内にフル機能が起動
- [ ] `npm run dist` で 250 MB 以下の NSIS インストーラが生成される
- [ ] クリーン Windows 環境でインストール → 起動 → ウォッチリスト操作 → チャート閲覧が完了
- [ ] ユーザーデータが `%APPDATA%/KANATA/` に集約され、アンインストール時の挙動が明確
- [ ] 既存の pytest 15 件が引き続きパスする
- [ ] TypeScript 型チェック (`npm run typecheck`) が警告なしで通る
- [ ] Electron セキュリティ推奨事項 (contextIsolation / sandbox / CSP) を満たす
