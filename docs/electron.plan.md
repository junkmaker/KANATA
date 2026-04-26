# KANATA Electron 移行計画

Docker + WSL2 構成から Windows 向け Electron アプリへの移行計画。
Python (FastAPI) バックエンドをサイドカーとして起動し、React + Vite のレンダラーと IPC を介して接続する。

- 対象プラットフォーム: Windows 10/11 (x64)
- ランタイム: Electron 40 (Chromium 146 / Node 24)
- ビルド: electron-vite + electron-builder (NSIS)

---

## 関連ファイル一覧（現状スナップショット）

| 種別                    | パス                                                    |
| ----------------------- | ------------------------------------------------------- |
| Electron メイン         | `apps/main/src/index.ts`                                |
| サイドカー制御          | `apps/main/src/sidecar/pythonSidecar.ts`                |
| IPC ブリッジ            | `apps/main/src/ipc/bridge.ts`                           |
| プリロード              | `apps/main/src/preload.ts`                              |
| ローカル DB（退避候補） | `apps/main/src/db/database.ts`                          |
| 共有型                  | `packages/shared-types/src/index.ts`                    |
| バックエンド URL 解決   | `apps/renderer/src/lib/backendUrl.ts`                   |
| API クライアント        | `apps/renderer/src/lib/{api,watchlistApi,searchApi}.ts` |
| Vite 型参照             | `apps/renderer/src/vite-env.d.ts`                       |
| Vite 設定 (単体)        | `apps/renderer/vite.config.ts`                          |
| Electron-Vite 設定      | `electron.vite.config.ts`                               |
| FastAPI エントリ        | `backend/src/main.py`                                   |
| DB 接続                 | `backend/src/db/database.py`                            |
| yfinance 実装           | `backend/src/services/yfinance_provider.py`             |
| Python 依存             | `backend/requirements.txt`                              |
| ルート package.json     | `package.json`                                          |

---

## Phase 1 — 完了済み ✓

**ゴール**: Phase 2 に着手する前に Phase 1 資産が壊れていないことを確認する。

- [x] `npm run dev` で Electron ウィンドウが起動し、Vite Dev サーバー (`http://localhost:5173`) に接続する
- [x] 起動ログに Python サイドカーのポート取得が表示される
- [x] `[main] Python backend ready at http://127.0.0.1:<PORT>` が表示される
- [x] DevTools の Console で `await window.kanata.getBackendUrl()` が `http://127.0.0.1:<PORT>` を返す（CJS プリロード修正後に確認済み）
- [x] `GET /api/health` が 200 を返す（curl で直接確認済み）
- [x] 終了時にサイドカーが SIGTERM で停止する（`before-quit` フック動作確認済み）

**解決した問題:**

- `ELECTRON_RUN_AS_NODE=1` が VSCode の Electron シェルから継承され `app`/`BrowserWindow` が取得不能 → `scripts/dev.cjs` で削除してから起動（2026-04-24）
- プリロードが ESM (`index.mjs`) でビルドされ Electron sandbox で `SyntaxError` → `electron.vite.config.ts` に `output: { format: 'cjs', entryFileNames: '[name].js' }` を追加し `apps/main/src/index.ts` のパスを `index.js` に修正（2026-04-24, PR #1）
- CORS が `localhost:3000` のみ → `localhost:5173`（Vite dev）と `allow_origin_regex: r"file://.*"`（prod）を追加（2026-04-24）

---

## Phase 2 — 完了済み ✓

**ゴール**: 開発・本番の両環境で Python サイドカーが安定して起動し、レンダラーが IPC 経由でバックエンド URL を解決し、すべての API 呼び出しが `/api/*` に到達する。SQLite は Electron の `userData` に永続化される。

### 2.1 サイドカー起動の堅牢化 (`apps/main/src/sidecar/pythonSidecar.ts`)

現状: ログの正規表現でポートを検出している。uvicorn のバージョンやログレベルによりフォーマットが変わるリスクがある。

**採用方針: 事前ポート確保（Node 側で `net.createServer().listen(0)` → ポート取得 → close → `--port <n>` で明示渡し）**

- [x] `reservePort()` ユーティリティを `apps/main/src/lib/port.ts` に実装
- [x] `pythonSidecar.ts` の起動引数に `--port <n>` を追加し、ログパースによるポート検出を廃止
- [x] `child.once('exit', ...)` で異常終了時に最大 2 回まで指数バックオフで再起動。限界超過時は IPC でレンダラーにエラー通知
- [x] Windows では `child.kill()` が届かない場合があるため、`taskkill /pid <pid> /T /F` をフォールバックとして追加（`process.platform === 'win32'` 分岐）
- [x] ヘルスチェック待機: `startPythonSidecar` の解決条件を「ポート取得」＋「`GET /api/health` が 200」まで待つ（タイムアウト 20s）
- [x] 軽量ロガーを `apps/main/src/lib/logger.ts` に導入: dev は stdout、prod は `userData/logs/main.log` / `userData/logs/sidecar.log`

### 2.2 CORS の動的ポート対応 (`backend/src/main.py`)

現状（2026-04-26）: `KANATA_ALLOWED_ORIGINS` 環境変数化完了、`localhost:3000` 削除済み。

- [x] `allow_origin_regex` で `file://` を許可（prod の file:// オリジン対応）
- [x] `localhost:5173` / `127.0.0.1:5173` を追加（Vite dev server 対応）
- [x] 環境変数 `KANATA_ALLOWED_ORIGINS` からオリジンを取得する形に変更
- [x] サイドカー起動時の `env` に `KANATA_ALLOWED_ORIGINS` を渡す（`pythonSidecar.ts`）
- [x] 旧 `localhost:3000` 参照をコード・ドキュメントから削除

### 2.3 SQLite を Electron userData に配置

現状（2026-04-26）: DB は `%APPDATA%/KANATA/kanata/kanata.db` に配置済み。`mkdirSync` で初回自動生成。バックアップは Phase 3 以降に持ち越し。

- [x] `dbPath` を `app.getPath('userData')` + スラッシュ統一 → `sqlite:///` プレフィックス付与（`pythonSidecar.ts` に実装済み）
- [x] `backend/src/db/database.py` のデフォルトパスは Python 単独起動時のみ使用（`DATABASE_URL` 環境変数を優先）
- [x] DB ディレクトリを `userData/kanata/kanata.db` に統一
- [x] サイドカー起動前に `mkdirSync(dbDir, { recursive: true })` を Node 側で実行
- [x] 起動時に `kanata.db` → `userData/backups/kanata.db.<date>` へコピー（直近 7 世代保持）（Phase 3 で実装: `backupDatabase()` in `pythonSidecar.ts`）

### 2.4 バックエンド URL 解決の改善 (`apps/renderer/src/lib/backendUrl.ts`)

- [x] `getBackendUrl()` にリトライ機構を追加（200ms インターバル × 最大 10 回）
- [x] `onBackendStatus` コールバック経由でサイドカー再起動時にキャッシュを破棄（`kanata:backend-status` push）
- [x] Electron 判定は `window.kanata` の存在で行う（現状通り）

### 2.5 IPC ブリッジの拡張 (`apps/main/src/ipc/bridge.ts`, `apps/main/src/preload.ts`)

追加するチャンネル:

- [x] `PreloadApi` 型を `packages/shared-types/src/index.ts` に集約し main/renderer で型共有（`getBackendUrl / platform / appVersion` の型定義済み）
- [x] `kanata:backend-status` → `{ status: 'starting' | 'ready' | 'crashed' | 'offline', url: string | null, error?: string }`
- [x] `kanata:open-logs` → `shell.openPath(userData/logs/)` でエクスプローラを開く
- [x] `kanata:app-version` → `app.getVersion()` を返す（prod では `npm_package_version` が取れないため IPC 経由に切替）（Phase 3 で実装: `PreloadApi.appVersion` → `getAppVersion(): Promise<string>`）
- [x] `webContents.send` でサイドカー状態変化を push → レンダラーの `useEffect` で購読

### 2.6 フロントエンド API クライアントの完全移行

- [x] 旧 `frontend/` ディレクトリは削除済み。`apps/renderer/` に完全移行完了
- [x] `useWatchlists` に `status: 'loading' | 'ready' | 'offline'` フォールバック実装済み
- [x] `useChartData` / `useDebouncedSearch` がハードコード URL を使っていないか全文 grep で確認済み
- [x] タイムアウト統一: `AbortSignal.timeout(10_000)` を `watchlistApi.ts` / `api.ts` 全 fetch に適用
- [ ] サイドカーオフライン時のフォールバック UX を全 API 共通化（`useChartData` は未対応）

### 2.7 better-sqlite3 実装の去就判断 (`apps/main/src/db/database.ts`)

現状: Python (SQLAlchemy) と Node (better-sqlite3) が同じ watchlists テーブルを二重管理している。

**採用方針: Python を正として better-sqlite3 を削除**

- [x] `apps/main/src/db/database.ts` を `_unused/` へ退避
- [x] `better-sqlite3` / `@types/better-sqlite3` を `apps/main/package.json` から除去
- [x] `postinstall: electron-builder install-app-deps` を削除（ネイティブモジュールなし）

### Phase 2 完了条件（2026-04-26 達成）

- `npm run dev` 起動時、`GET /api/health` / `GET /api/watchlists` / `GET /api/search?q=ap` / `GET /api/quotes/AAPL?timeframe=1D` が成功
- サイドカーを強制終了 → 自動再起動またはレンダラーにエラー通知
- DB ファイルが `%APPDATA%/KANATA/kanata/kanata.db` に生成され、再起動後もウォッチリストが残る
- CORS プリフライトが通り、Console にエラー無し

**解決した問題:**

- ポート検出がログ正規表現頼り → `reservePort()` で事前確保し `--port <N>` で明示渡し（2026-04-26, commit `ef836f6`）
- サイドカークラッシュ時に無言で停止 → 最大 2 回の指数バックオフ再起動 + `kanata:backend-status` push 通知（2026-04-26）
- `better-sqlite3` と Python SQLAlchemy が watchlists テーブルを二重管理 → `database.ts` を `_unused/` に退避し Python 一本化（2026-04-26）
- 全 fetch にタイムアウトなし → `AbortSignal.timeout(10_000)` を `watchlistApi.ts` / `api.ts` 全箇所に適用（2026-04-26）

---

## Phase 3 — 完了済み ✓

**ゴール**: `npm run dist` で NSIS インストーラが生成され、Python / Docker / WSL2 なしの Windows 端末で動作する。

### 3.1 electron-builder 設定

- [x] ルート `package.json` に `build` セクションを追加:
  - `appId: com.kanata.terminal` / `productName: KANATA Terminal`
  - `directories.output: release` / `asar: true`
  - `extraResources`: `resources/backend` → `backend`、`resources/python` → `python`
  - `win.target: nsis x64` / `win.icon: build/icon.ico`
  - `win.signAndEditExecutable: false`（EV 証明書取得まで winCodeSign をスキップ）
  - `nsis.oneClick: false` / `nsis.allowToChangeInstallationDirectory: true`
  - `nsis.include: build/installer.nsh`（アンインストール確認ダイアログ）
- [x] `build/icon.ico` を用意（16/32/48/256px multi-resolution placeholder）
- [x] `resources/python/` / `resources/backend/` を `.gitignore` に追加

### 3.2 Python ランタイムのバンドル戦略

**採用方針: Windows embeddable Python 3.12.9 + pip install**

- [x] `scripts/prepare-python-dist.ps1` を新規作成（`npm run prepare:dist` で実行）:
  1. `python-3.12.9-embed-amd64.zip` をダウンロードして `resources/python/` に展開
  2. `python312._pth` の `#import site` を有効化
  3. `get-pip.py` で pip を導入
  4. `pip install -r backend/requirements.txt -t resources/python/Lib/site-packages`
  5. `backend/src/` を `resources/backend/src/` にコピー
  6. `__pycache__` / `*.pyc` / `tests/` を削除
- [x] `scripts/check-resources.cjs` を `beforeBuild` フックとして登録（resources 未準備時に明確なエラー）
- [x] packaged 時に `PYTHONHOME` を embeddable Python パスに設定（`pythonSidecar.ts`）

### 3.3 SQLite の初期化・移行戦略

- [x] 初期化は既存の `backend/src/db/init_db.py`（`create_all` + seed）でカバー（変更なし）
- [ ] Alembic の導入は Phase 6 以降に切り出し
- [ ] Docker 版からの引き継ぎ手順を README に記載: `docker cp kanata-db:/app/data/kanata.db ./`

### 3.4 単一インスタンス制約

- [x] `app.requestSingleInstanceLock()` をメインプロセス冒頭に追加（Phase 2 で先行実装）

### 3.5 ログと診断

- [x] `logger.ts` に 5 MB ファイルサイズベースのローテーション追加（最大 3 世代）
- [x] Help メニューに「ログフォルダを開く」「バージョン情報」を追加（Alt キーで表示）

### Phase 3 完了条件（2026-04-26 達成）

- [x] `npm run dist` が成功し `release/KANATA-Terminal-Setup-0.2.0.exe` が生成される
- [x] インストーラ容量が 250 MB 以下
- [x] アンインストール時にユーザーデータ削除確認ダイアログが表示される（`build/installer.nsh`）
- [ ] Python / Docker / WSL2 なしのクリーン端末でインストール・起動・チャート表示まで完了（手動検証待ち）

**解決した問題:**

- `package.json` に `build` セクション未設定で `npm run dist` が失敗 → セクション追加で解消（2026-04-26, PR #5）
- winCodeSign 展開時に macOS シンボリックリンク作成で Windows 権限エラー → `win.signAndEditExecutable: false` で winCodeSign ダウンロードをスキップ（2026-04-26）
- packaged 時に `npm_package_version` が `undefined` → `kanata:app-version` IPC チャンネルで `app.getVersion()` を返すよう変更（2026-04-26）

---

## Phase 4 — 完了済み ✓

**ゴール**: Web 版で動作していた機能がすべて Electron 上で同等に動く。

### 4.0 修正済みバグ

- [x] **ファンダメンタルズペイン overflow** (2026-04-25, commit `17aeaa1`): `priceH` の計算がサブペイン間の固定ギャップ（4 + 18×4 = 76px）を考慮しておらず、FIN ペインがキャンバス外にはみ出していた。`gapsToLastPane` ternary を追加して修正。詳細: `.claude/PRPs/plans/completed/fix-fundamentals-pane-overflow.plan.md`

### 4.1 既存機能チェックリスト

- [x] チャート描画: ローソク足
- [x] インジケーター: SMA / EMA / BOLL / STOCH / PSAR / Ichimoku / MACD / RSI
- [x] 描画ツール: トレンドライン / 水平線 / 矩形 / テキスト
- [x] ウォッチリスト: CRUD / 並び替え / デフォルト切替 / 検索追加
- [x] タイムフレーム: 5m / 15m / 60m / 1D / 1W / 1M の切替
- [x] 状態永続化: `kanata.state` / `kanata.aesthetic` / `kanata.density` / `kanata.activeWatchlistId` が再起動後も保持

### 4.2 Electron 固有の改善

- [x] **外部 URL ガード**: `setWindowOpenHandler` で外部 URL を `shell.openExternal` にルーティング、`will-navigate` をブロック（`apps/main/src/index.ts` 実装済み）
- [x] **カスタムタイトルバー**: `frame: false` + `WindowControls.tsx`（最小化・最大化・閉じる IPC 経由）+ TopBar に `-webkit-app-region: drag/no-drag` 設定（2026-04-26, PR #7）
- [x] **メニューバー**: `Menu.setApplicationMenu` でファイル（終了）/ 表示（再読み込み・強制再読み込み・DevTools・全画面）/ ヘルプを整備（2026-04-26, PR #7）

### 4.3 セキュリティ硬化

- [x] `webPreferences.sandbox: true` / `nodeIntegration: false` / `contextIsolation: true` を設定済み（`apps/main/src/index.ts`）
- [x] CSP を `apps/renderer/index.html` の `<meta>` で設定: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' fonts.googleapis.com; connect-src 'self' http://127.0.0.1:* ws://localhost:*; font-src fonts.gstatic.com; img-src 'self' data:`（2026-04-26, PR #7）

**実装済み (2026-04-26, PR #7):**

- IPC チャンネル 5 本追加 (`kanata:window-minimize/maximize/close/is-maximized/maximize-changed`)
- `PreloadApi` 型拡張 + `preload.ts` に 5 メソッド追加
- `WindowControls.tsx` 新規作成（Windows 11 標準幅 46px、閉じる hover `#c42b1c`）
- `buildAppMenu()` にファイル / 表示 サブメニュー追加
- CSP `<meta>` タグを `index.html` に追加

---

## Phase 5 — 完了済み ✓

**ゴール**: 回帰を検知できる最低限の自動テストと手動チェックリストを整備。

### 5.1 単体テスト (Vitest)

- [x] `pythonSidecar.ts` の純関数 (`resolveBackendDir` / `resolvePythonExecutable`) を Vitest で単体テスト（6 件）
- [x] `backendUrl.ts` のキャッシュ動作とリトライを検証（`window.kanata` モック）（3 件）
- [x] `reservePort` の単体テスト追加（2 件）
- [x] `backend/tests/` の pytest（27 件）が全件パスすることを確認

### 5.2 E2E テスト (Playwright for Electron)

- [x] `@playwright/test` + Electron launch を `tests/e2e/` に導入（`playwright.config.ts` + `tests/e2e/app.spec.ts`）
- [ ] シナリオ: 起動 → ウォッチリストに "AAPL" を追加 → チャート表示 → タイムフレーム変更 → アプリ終了（Phase 6 以降: ビルド済み成果物が必要）

### 5.3 リリース前手動チェックリスト

- [x] `docs/RELEASE_CHECKLIST.md` 作成（7 カテゴリ / 26 項目）
- [ ] クリーン Windows 11 環境での実機検証（Phase 6 リリース前に実施）

**実装済み (2026-04-26, feat/phase4 → PR #8):**

- Vitest v3.2 + jsdom v26 + `@playwright/test` v1.52 を devDependencies に追加
- `apps/main/vitest.config.ts` / `apps/renderer/vitest.config.ts` 新規作成（`root` 設定でパス解決修正）
- `apps/main/src/__tests__/__mocks__/electron.ts` — `app` スタブ
- `pythonSidecar.ts` の `resolveBackendDir` / `resolvePythonExecutable` に `export` 追加
- 単体テスト 11 件（main: 8 件、renderer: 3 件）+ pytest 27 件 = 合計 38 件全 Pass
- `App.tsx` に `data-testid="watchlist"` wrapper 追加（E2E セレクタ用）
- `apps/main/tsconfig.json` に `"exclude": ["src/_unused"]` 追加（既存 `better-sqlite3` 型エラー回避）

---

## 横断的リスクと対策

| リスク                                            | 影響               | 対策                                                                                    |
| ------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| Windows Defender / SmartScreen による警告         | 初回起動で警告画面 | EV コード署名証明書を Phase 3 終盤で導入。未署名時は README に「詳細 → 実行」手順を明記 |
| yfinance が Yahoo API 変更で壊れる                | データ取得全滅     | `yahoo-finance2` (Node) への段階的置換を Phase 6 計画に残す                             |
| embeddable Python が 3.13 以降で pip 非同梱になる | バンドル失敗       | Python 3.12.x に固定し requirements.txt でバージョン固定                                |
| better-sqlite3 と Electron バージョン不整合       | 起動時クラッシュ   | Phase 2.7 で削除方針                                                                    |
| サイドカーのポート競合                            | 起動失敗           | 事前ポート確保（Phase 2.1）で解消                                                       |
| レンダラーの `Origin: null`（file://）CORS エラー | API 疎通不可       | Phase 2.2 で `allow_origin_regex` を追加                                                |
| Windows の `child.kill()` が Python に届かない    | プロセス残留       | Phase 2.1 で `taskkill /T /F` フォールバック                                            |

---

## 実装前に決定すべき重要事項

1. **better-sqlite3 削除 or 保持** (Phase 2.7): Python を正として削除（推奨）か、将来 Python 撤去を見据えて保持か（未決定）
2. **Python バンドル方式** (Phase 3.2): embeddable Python + pip（推奨）か PyInstaller か（未決定）
3. **CORS localhost:3000 削除タイミング** (Phase 2.2): `localhost:5173` / `file://` は追加済み。`localhost:3000` の残存は無害だが、混乱を避けるため Phase 2 完了前に削除推奨

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
- [x] `npm run dist` で 250 MB 以下の NSIS インストーラが生成される（2026-04-26）
- [ ] クリーン Windows 環境でインストール → 起動 → ウォッチリスト操作 → チャート閲覧が完了
- [ ] ユーザーデータが `%APPDATA%/KANATA/` に集約され、アンインストール時の挙動が明確
- [x] 既存の pytest 27 件が引き続きパスする（2026-04-26）
- [x] TypeScript 型チェック (`npm run typecheck`) が警告なしで通る（2026-04-26）
- [x] Electron セキュリティ推奨事項 (contextIsolation / sandbox / CSP) を満たす（2026-04-26, PR #7）
