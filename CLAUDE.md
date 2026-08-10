# CLAUDE.md

## 言語

ユーザーへの応答、コメント、コミットメッセージなどユーザーが読むものは日本語を使用すること。

## プロジェクト概要

KANATA (Karte for Analytical Navigation And Technical Analysis) は TradingView ライクな株式チャートの **Windows ネイティブ Electron アプリ**。Python FastAPI バックエンドをサイドカープロセスとして内包し、React + Vite レンダラーと IPC 経由で接続する。データ源は yfinance と FRED。

- `apps/main/` — Electron メインプロセス（サイドカー管理・IPC・ロガー）
- `apps/renderer/` — React フロントエンド（Canvas チャート、マクロダッシュボード、スクリーニング）
- `backend/` — FastAPI サイドカー（quotes / watchlists / macro / screening / fundamentals）
- `packages/shared-types/` — `PreloadApi` 型と `window.kanata` 宣言
- `scripts/` — 開発起動・リリース・バックテスト CLI

主な設計ドキュメント: [docs/n_pattern_backtest_spec.md](docs/n_pattern_backtest_spec.md) / [docs/n_pattern_screening_spec.md](docs/n_pattern_screening_spec.md) / [docs/screening_ui_repositioning_plan.md](docs/screening_ui_repositioning_plan.md)

## 開発コマンド

```bash
npm run dev         # Electron + Vite dev server + Python sidecar
npm run build       # electron-vite build
npm run dist        # NSIS インストーラ生成
npm run typecheck   # renderer + main 両ワークスペース
cd backend && pytest
```

`npm run dev` は `scripts/dev.cjs` 経由で `electron-vite dev` を呼ぶ。**`ELECTRON_RUN_AS_NODE=1` を絶対に継承させない** — VSCode の Electron 拡張がこの変数をセットし、Electron が Node として起動してしまうため、このスクリプトが削除してから起動する。

## Electron 固有の制約

- **プリロードは CJS 形式でビルドする**。`package.json` の `"type": "module"` があると Rollup は `.mjs` を生成するが、Electron のサンドボックス化プリロードは ESM `import` を解釈しない（`electron.vite.config.ts` の preload に `format: 'cjs'` 設定済み）
- **サイドカーポートは動的**。`lib/port.ts` の `reservePort()` で Node 側が事前確保し `--port <n>` で渡す。ハードコードした `8000` ではなく必ず `getBackendUrl()` 経由で URL を取得する
- **DB パスは `app.getPath('userData')`**（Windows では `%APPDATA%/kanata/kanata.db`）。`sqlite:///` プレフィックス + `replace(/\\/g, '/')` でスラッシュ統一済み
- サイドカーは spawn 時に `...process.env` を継承する。`FRED_API_KEY` はシェル/OS に設定すれば自動で伝播する（コード変更不要）。**Electron パッケージにキーを同梱しない**

## バックエンドの規約

- **レスポンス形式が 2 系統ある**。watchlists は `{success, data, error}` エンベロープ、macro / screening / quotes は生オブジェクト（エラーは `HTTPException` + `detail`）。レンダラー側も `lib/watchlistApi.ts`（剥がす）と `lib/backendFetch.ts`（剥がさない）で分かれているので、新規ルートはどちらかに揃える
- **タイムフレーム文字列は前後で違う**。フロントは `5m/15m/60m/1D/1W/1M`、yfinance は `5m/15m/60m/1d/1wk/1mo`。変換は必ず `services/yfinance_provider.py` の `INTERVAL_MAP` 経由にする
- **JP 銘柄コードは 4 桁数字**（例 `7203`）。yfinance に渡す前の `.T` 付与は `to_yf_symbol` に集約されている。新規ルートでも同関数を使う
- **マクロの閾値をハードコードしない**。series ID・閾値・参照期間・総合シグナルルールは `config/macro_thresholds.json` に外出ししてある。変更は JSON の編集のみで行う
- **単位換算は `services/macro_provider.py` に集約**。`WALCL` は百万$ → 十億$（÷1000）、純流動性は兆$ 表示（÷1000）
- **FRED キー未設定でも 500 にしない**。該当指標を `meta.available=false` で返す部分稼働にする（RSP/SPY は yfinance だけで動く）
- **`services/storage.py` は他 services を import しないリーフモジュール**。**依存方向は `screening_provider` → `universe_provider` の一方向のみ**（`DEFAULT_UNIVERSE_CSV` は universe_provider 側で定義）
- ユニバース CSV の必須列は `code` のみ。`name` 欠落は code 代用、`market_cap` 欠落は None でフィルタ非適用

## レンダラーの制約

- **`App.tsx` が全状態の単一ソース**。`localStorage` キーは `kanata.*` 名前空間（`kanata.state` / `kanata.aesthetic` / `kanata.activeWatchlistId` / `kanata.migrated.v1` / `kanata.view` / `kanata.screening.universeId`）
- **`apps/renderer/src/types.ts` が型の起点**。新しい描画ツールやインジケーターを追加するときはここから変更する
- **描画ツールは OHLC インデックスと価格で保存**（`DrawingObject`）、座標ではない。タイムフレーム変更でも位置が維持される設計
- **描画の表示/非表示（`state.showDrawings`）は 3 箇所で抑制する** — `Chart.tsx` のオーバーレイ描画・`hitTest`・`onPointerDown` のツール判定。描画を止めるだけだと見えない線を掴めてしまい、掴めなくするだけだと見えない線を新規作成できてしまう。非表示化時は `activeTool` をパンへ戻す。この状態は永続化せず、`loadState` が起動時に必ず `true` へ戻す
- **チャートの単独キーショートカットを無視させたい領域には `data-chart-shortcuts="off"` を付ける**（`SHORTCUT_OPT_OUT_SELECTOR`）。フォーム要素の判定は `isTypingTarget` に集約。`select` もブラウザの type-ahead と衝突するため入力対象として扱う
- **未来インデックス（`idx >= data.length`）の時刻計算は `lib/futureBars.ts` の `barTimestampAt` に集約**。`MAX_FUTURE_BARS = 120` で最大 120 バー先の空白領域にパン・描画できる
- **Chart サブペインの Y 座標チェーンに手を入れない**（`Chart.tsx` の `priceH` → `volY0` 以降の連鎖）。ペイン高さを変えるときは `priceH` の計算（`gapsToLastPane` ternary）だけを変更する
- **Canvas は高 DPI 対応**（`devicePixelRatio`）。サイズ計算を触るときは論理ピクセルと物理ピクセルの区別に注意
- `useChartData` は `symbols.join(',')` を useEffect 依存にして配列の参照等価性問題を回避している

## ローソク足パターン（TS / Python 同値実装）

`lib/candlePatterns.ts`（TS 13 種）と `backend/src/analysis/candle_patterns.py`（Python 14 種）は同値実装で、**片方だけ変更してはいけない**。チャートに描かれるものと検証対象がズレると検証結果を UI に持ち込めない。差は `shooting_star`（UI 未移植）の 1 つのみ。

追加手順（**定数名が両言語で違う**ので取り違えないこと）:

1. `types.ts` の `CandlePatternType` union に型名を足す（`Record<CandlePatternType, _>` が以降の登録漏れを tsc に検出させる）
2. 両言語に検出器（純関数）を書く
3. TS は `DETECTORS`・`PATTERN_LABELS`・`PATTERN_SIGNALS`、Python は `DETECTORS`・`LABELS`・`SIGNALS` に登録
4. `lib/patternView.ts` の `PATTERN_DISPLAY_ORDER` に足す（tsc が強制できない唯一の登録先。`__tests__/patternView.test.ts` が漏れを落とす）
5. 共有フィクスチャ `tests/fixtures/candle_patterns_cases.json` に陽性ケースを足す（両言語のパリティテストが読む）

**表示ラベルの真実源は `PATTERN_LABELS` / `LABELS` / フィクスチャの `labels` の 3 者**。UI 側にラベル文字列を写し書きしない（写した時点で一致テストの管轄外になる）。

**`hammer` はトレンド文脈で三分されている**（下降後=ハンマー / 上昇後=首吊り線 / 横ばい=どちらも出さない。`HAMMER_TREND_LOOKBACK = 10` / `HAMMER_TREND_RATIO = 0.05`）。形状だけで判定していた旧定義は上昇後のハンマーに強気ラベルを出していた。Python の `shooting_star` は文脈を見ない非対称が残っている（UI に出さない検出器のため）。

**14 種は検証済みで、形状に予測力は無い**（2026-08・[docs/candle_pattern_backtest.md](docs/candle_pattern_backtest.md)）。ハンマーが有意に見えるのは形状ではなく `HAMMER_TREND_RATIO` の条件（＝短期リバーサル）由来。同じ文脈の非ハンマーと比べた増分は 8 行中 6 行で 0 を跨ぎ、残る 2 行は**形状があるほうが有意に悪い**（符号は期間で反転する）。**勝率・期待値を UI に出さない根拠**。ただし否決は表示をやめる理由にはならない（立場は中立な観察ツール）。**条件を 2 つ以上持つ検出器を足したら、条件ごとに分けて測ること。**

## バックテスト・データ品質

N字バックテストと OHLCV ストアを触る前に [docs/backtest_gotchas.md](docs/backtest_gotchas.md) を読むこと。統計の取り扱い（ブートストラップの単位、打ち切りの扱い、品質フィルタの両側適用）とベンチマーク汚染の罠がまとまっている。

## リリース

```bash
npm run release -- 1.1.0            # 事前チェック → typecheck → bump → push
npm run release -- 1.1.0 --dry-run
```

push 後は `tag-on-version-change.yml` が `v{version}` タグを生成し、`release.yml` がビルドして GitHub Release を作る。

- **コミット本文が GitHub Release のリリースノートになる**（`release.yml` が `git log -1 --pretty=%b` を読む）ため、bump コミットは必ず `main` の tip に置く
- タグ push には `GH_PAT` が必須（`GITHUB_TOKEN` で push したタグは他ワークフローをトリガーしない）
- `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` 未設定時はコード署名がスキップされる

## ブランディング

「KAIROS /TERMINAL」→「KANATA /TERMINAL」にリネーム済み。これから追加するキー・表示名も `KANATA` ブランドで揃える。
