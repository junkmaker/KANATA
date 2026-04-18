# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

KANATA (Karte for Analytical Navigation And Technical Analysis) は TradingView ライクな株式チャート Web アプリ。WSL2 上の Docker Compose で動作する個人トレード用ターミナル。Claude Design で作った HTML/JSX プロトタイプ (`stock-chart.zip`) を TypeScript + React + FastAPI 構成に段階的に移植している。フェーズ別の実装計画は [kanata-plan.md](kanata-plan.md) を参照（現在 Phase 2 実装初期）。

## 開発コマンド

起動は Docker Compose を基本とする：

```bash
docker compose up --build        # 両サービスをビルドして起動
docker compose up frontend       # フロントエンドのみ
docker compose up backend        # バックエンドのみ
docker compose logs -f backend   # ログ追跡
```

コンテナ外で個別に動かす場合：

```bash
# frontend (http://localhost:3000)
cd frontend && npm install && npm run dev
npm run build          # tsc 型チェック + Vite プロダクションビルド
npm run preview        # ビルド結果の確認

# backend (http://localhost:8000, /docs で Swagger)
cd backend && pip install -r requirements.txt
uvicorn src.main:app --reload --port 8000
```

現状 lint / test ランナーは未導入。型チェックは `npm run build` 経由の `tsc --noEmit` のみ。追加する場合はまず既存ワークフロー（Docker volume マウントでホットリロード）と整合する形にする。

## アーキテクチャ

### データフロー

```
yfinance → backend (FastAPI + TTLCache) → /api/quotes/{symbol}?timeframe=X
                                              ↓ fetch
                                    frontend useChartData フック
                                              ↓ merge
                                    App.tsx: realData で syntheticData を上書き
                                              ↓ props
                                    Chart.tsx (Canvas 描画)
```

ポイントは **合成データと実データの二層構造**：
- `lib/data.ts` が 15 銘柄分の合成 OHLC を生成する（ウォッチリストのスパークライン、API 失敗時のフォールバック、選択外銘柄の比較表示に常時使用）
- `useChartData` が `state.selected` の銘柄だけをバックエンドから取得
- `App.tsx` で `realData[sym]` があれば `syntheticData[sym]` を上書きしてマージ
- この設計のため、バックエンド停止時もフロントは壊れない

### バックエンド (`backend/src/`)

- `main.py` — FastAPI エントリ。CORS を `localhost:3000` 限定で開放
- `routes/quotes.py` — `GET /api/quotes/{symbol}?timeframe=...` TTL キャッシュ経由
- `routes/search.py` — `GET /api/search?q=...` プリセット 15 銘柄 → 不一致時に yfinance.Search へフォールバック
- `services/yfinance_provider.py` — **タイムフレーム変換の要所**。`INTERVAL_MAP` で frontend の `5m/15m/60m/1D/1W/1M` を yfinance の `interval/period/cache TTL` に対応付ける。数字のみの JP 銘柄には `.T` サフィックスを自動付与（`to_yf_symbol`）
- `services/cache.py` — プロセス内メモリの TTLCache（Redis 等は未使用）

### フロントエンド (`frontend/src/`)

- `App.tsx` — 全状態の単一ソース。`localStorage` キーは `kanata.state` / `kanata.aesthetic` / `kanata.density` で統一（旧プロトタイプの `stockchart.*` からリネーム済み）
- `components/Chart/Chart.tsx` — **717 行**の Canvas 描画コンポーネント。ローソク足、インジケーター、描画ツール、クロスヘア、パン・ズームを単一ファイルで扱う。800 行上限に近いので分割候補
- `lib/indicators.ts` — SMA/EMA/BOLL/STOCH/PSAR/Ichimoku をクライアント側で計算
- `lib/data.ts` — 合成 OHLC 生成 + `retime()` でタイムフレーム変換
- `hooks/useChartData.ts` — `symbols.join(',')` を useEffect 依存にして配列の参照等価性問題を回避している
- `styles/globals.css` — 4 種カラーテーマ (`data-aesthetic`) + 2 種密度 (`data-density`) を CSS カスタムプロパティで切替

### 型定義 (`frontend/src/types.ts`)

`OHLCBar` / `Ticker` / `AppState` / 各インジケーター結果型が集中管理されている。新しい描画ツールやインジケーターを追加する際はここを起点に変更する。

## 実装上の注意点

- **タイムフレーム文字列は前後で違う**。フロントは `5m/15m/60m/1D/1W/1M`、yfinance は `5m/15m/60m/1d/1wk/1mo`。変換は必ず `INTERVAL_MAP` 経由にする
- **JP 銘柄コードは 4 桁数字**（例 `7203`）。yfinance に渡す前に `.T` を付ける処理が `to_yf_symbol` に集約されているので、新規ルートで yfinance を呼ぶ場合も同関数を使う
- **描画ツールは OHLC インデックスと価格で保存**（`DrawingObject`）、座標ではない。タイムフレーム変更でも位置が維持される設計
- **Canvas は高 DPI 対応**（`devicePixelRatio`）。サイズ計算を触るときは論理ピクセルと物理ピクセルの区別に注意
- **ホットリロードは Docker volume + `CHOKIDAR_USEPOLLING=true` + Vite `usePolling` で成立**。WSL2 のファイル監視は inotify が届かないのでポーリング必須
- **WSL2 ではプロジェクトを `/home/` 配下に置く**。`/mnt/c/` だと I/O が著しく劣化する

## ブランディング

「KAIROS /TERMINAL」→「KANATA /TERMINAL」にリネーム済み。localStorage キーも `kanata.*` に統一済み。これから追加するキー・表示名も `KANATA` ブランドで揃える。
