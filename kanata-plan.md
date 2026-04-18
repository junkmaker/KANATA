# KANATA — 実装計画書
**Karte for Analytical Navigation And Technical Analysis**

## プロジェクト概要

Claude Designで作成したプロトタイプ（TradingViewライクな株式チャートWebアプリ）を、「KANATA」として Windows WSL上のDockerコンテナで動作する本格的なWebアプリケーションに仕立てる。Claude Codeを使って段階的に実装を進める。

---

## 現状のデザイン資産の分析

ZIPファイルに含まれるプロトタイプの構成：

| ファイル | 行数 | 役割 |
|---------|------|------|
| `Stock Chart Terminal.html` | 32行 | エントリーポイント（CDN経由のReact + Babel） |
| `app.jsx` | 196行 | アプリ全体の状態管理、TopBar、StatusBar、Tweaks |
| `chart.jsx` | 786行 | Canvas描画（ローソク足、インジケーター、クロスヘア） |
| `left-panel.jsx` | 112行 | タイムフレーム選択、描画ツール、テクニカル指標トグル |
| `right-panel.jsx` | 140行 | ウォッチリスト、検索、ファンダメンタルズカード |
| `data.js` | 123行 | 合成OHLCデータ生成（15銘柄 × 1500本） |
| `indicators.js` | 139行 | SMA/EMA/BOLL/STOCH/PSAR/Ichimoku |
| `styles.css` | 419行 | ダークテーマ4種、密度2種、全UIスタイル |

> **ブランディング変更：** プロトタイプの「KAIROS /TERMINAL」を「KANATA /TERMINAL」にリネーム。
> localStorage キーも `stockchart.*` → `kanata.*` に統一する。

**既に実装済みの機能：**
- ローソク足チャート（Canvas描画、高DPI対応）
- テクニカル指標 7種（SMA5/25/75, EMA20, Bollinger, Stochastics, PSAR, 一目均衡表）
- 描画ツール 6種（トレンドライン、水平線、垂直線、矩形、楕円、テキスト）
- ウォッチリスト（JP 7銘柄 + US 8銘柄、スパークライン付き）
- 複数銘柄比較（%チェンジモード）
- タイムフレーム切替（5m/15m/60m/1D/1W/1M）
- ファンダメンタルズペイン（ROE/ROIC/PER 20四半期分）
- 4種カラーテーマ + 密度設定
- パン・ズーム操作
- localStorage による状態永続化

---

## アーキテクチャ設計

### 技術スタック

```
┌─────────────────────────────────────────────┐
│  Browser (localhost:3000)                     │
│  React 18 + TypeScript + Vite                │
│  lightweight-charts / Canvas自前描画          │
│  Tailwind CSS (またはCSS Modules)             │
└──────────────┬──────────────────────────────┘
               │ REST API / WebSocket
┌──────────────▼──────────────────────────────┐
│  Backend (Node.js / FastAPI)                 │
│  ・株価データAPI プロキシ                       │
│  ・WebSocket リアルタイム配信                   │
│  ・ポートフォリオ・設定管理                      │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│  Docker Compose (WSL2)                       │
│  ├─ frontend   (Node 20, Vite dev server)   │
│  ├─ backend    (Python 3.12 / Node 20)      │
│  └─ db         (SQLite or PostgreSQL)       │
└─────────────────────────────────────────────┘
```

### ディレクトリ構成

```
kanata/
├── docker-compose.yml
├── .env.example
├── README.md
│
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── styles/
│       │   ├── globals.css          ← 既存styles.cssを移植
│       │   └── themes.css           ← 4テーマ定義
│       ├── components/
│       │   ├── TopBar.tsx
│       │   ├── StatusBar.tsx
│       │   ├── Chart/
│       │   │   ├── ChartCanvas.tsx   ← chart.jsx移植
│       │   │   ├── ChartLegend.tsx
│       │   │   ├── indicators.ts     ← indicators.js移植
│       │   │   └── drawing-tools.ts
│       │   ├── LeftPanel/
│       │   │   ├── LeftPanel.tsx
│       │   │   ├── TimeframeSelector.tsx
│       │   │   ├── DrawingTools.tsx
│       │   │   └── IndicatorToggles.tsx
│       │   ├── RightPanel/
│       │   │   ├── RightPanel.tsx
│       │   │   ├── WatchList.tsx
│       │   │   ├── TickerRow.tsx
│       │   │   └── FundamentalsCard.tsx
│       │   └── TweaksPanel.tsx
│       ├── hooks/
│       │   ├── useChartData.ts
│       │   ├── useWebSocket.ts
│       │   └── useLocalStorage.ts
│       ├── lib/
│       │   ├── api.ts
│       │   ├── formatters.ts
│       │   └── types.ts
│       └── stores/
│           └── chartStore.ts         ← Zustand or useReducer
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt             ← (Python版の場合)
│   ├── package.json                  ← (Node版の場合)
│   └── src/
│       ├── server.ts / main.py
│       ├── routes/
│       │   ├── quotes.ts            ← 株価データ取得
│       │   ├── watchlist.ts         ← ウォッチリスト管理
│       │   └── settings.ts          ← ユーザー設定
│       ├── services/
│       │   ├── data-provider.ts     ← 外部API連携
│       │   └── websocket.ts         ← WS配信
│       └── db/
│           └── schema.sql
│
└── scripts/
    ├── setup.sh                     ← 初期セットアップ
    └── seed-data.sh                 ← テストデータ投入
```

---

## 実装フェーズ

### Phase 1: 環境構築とプロトタイプ移植（Day 1-2）

**目標：** Docker上でプロトタイプがそのまま動くことを確認

Claude Codeへの指示例：
```
プロジェクト kanata を作成してください。
Docker Compose で frontend (Vite + React 18 + TypeScript) を構築し、
添付のZIPファイルのコードをTypeScriptに移植してください。
アプリ名は「KANATA」（Karte for Analytical Navigation And Technical Analysis）です。
まずは合成データのまま、既存UIが動くことを優先してください。
```

**タスク：**
1. `docker-compose.yml` 作成（frontend サービス）
2. Vite + React + TypeScript プロジェクト初期化
3. 既存の JSX/JS → TSX/TS に変換
   - `React.createElement` → JSX構文へ変換
   - 型定義（`types.ts`）の追加
4. CSS をそのまま移植（globals.css）
5. `docker compose up` で `localhost:3000` にアクセスして動作確認

**ポイント：**
- プロトタイプは `React.createElement` で書かれているため、JSX化が最大の作業
- Canvas描画ロジックはほぼそのまま移植可能
- フォント（Inter, JetBrains Mono）はGoogle Fontsから読み込み済み


### Phase 2: リアル株価データ連携（Day 3-5）

**目標：** 合成データ → 実際の株価データに置き換え

Claude Codeへの指示例：
```
backend サービスを追加してください。
Yahoo Finance (yfinance) または Alpha Vantage API を使って
日本株・米国株のOHLCVデータを取得するAPIを作成してください。
フロントエンドの data.js を置き換えて、APIからデータを取得するようにしてください。
```

**データソースの選択肢（個人利用向け）：**

| ソース | 日本株 | 米国株 | リアルタイム | コスト |
|--------|--------|--------|-------------|--------|
| yfinance (Python) | ○ | ○ | 15分遅延 | 無料 |
| Alpha Vantage | △ | ○ | 一部 | 無料枠あり |
| J-Quants API | ◎ | × | 終値 | 無料枠あり |
| Twelve Data | ○ | ○ | 一部 | 無料枠あり |
| stooq.com CSV | ○ | ○ | 終値 | 無料 |

**推奨構成：** yfinance（手軽さ重視）+ J-Quants（日本株補完）

**タスク：**
1. backend Dockerfile 作成（Python 3.12 + FastAPI）
2. `/api/quotes/{symbol}` エンドポイント
   - クエリパラメータ: `interval` (1m/5m/15m/1d/1wk/1mo), `range` (1d/5d/1mo/6mo/1y/5y)
3. `/api/search?q=xxx` 銘柄検索エンドポイント
4. キャッシュ層（Redis or インメモリ、API制限対策）
5. フロントの `useChartData` フック実装
6. ティッカーリストを動的化（ハードコード → API検索）


### Phase 3: リアルタイム更新とWebSocket（Day 6-7）

**目標：** チャートがリアルタイムに更新される

Claude Codeへの指示例：
```
WebSocketを使ってリアルタイムに株価を更新する機能を追加してください。
バックエンドで定期的にデータを取得し、WebSocketで配信してください。
フロントエンドではローソク足が動的に追加・更新されるようにしてください。
```

**タスク：**
1. WebSocket サーバー実装（FastAPI の WebSocket or Socket.IO）
2. バックグラウンドタスクで定期取得（30秒〜1分間隔）
3. フロントの `useWebSocket` フック
4. 新しいバーの追加、現在バーの更新ロジック
5. 接続状態表示（TopBar の LIVE インジケーター連携）


### Phase 4: ポートフォリオ・アラート機能（Day 8-10）

**目標：** 個人トレードの管理機能を追加

Claude Codeへの指示例：
```
以下の機能を追加してください：
1. ウォッチリストの保存・編集（SQLiteに永続化）
2. 保有株の登録と損益計算
3. 価格アラート（指定価格に到達したら通知）
```

**タスク：**
1. SQLite データベース追加（Docker volume で永続化）
2. ウォッチリスト CRUD API
3. ポートフォリオ管理
   - 保有銘柄・数量・取得単価の登録
   - 現在値との損益表示（RightPanel に追加）
4. 価格アラート
   - 条件設定 UI
   - バックエンドでの監視
   - ブラウザ通知（Notification API）


### Phase 5: 高度なチャート機能（Day 11-14）

**目標：** TradingViewに近い操作感を実現

Claude Codeへの指示例：
```
チャート機能を強化してください：
1. 描画ツールの永続化（銘柄ごとにDBに保存）
2. フィボナッチリトレースメント描画ツールの追加
3. 出来高加重平均価格（VWAP）インジケーターの追加
4. MACD、RSI インジケーターの追加
5. チャートの分割表示（複数ペイン）
```

**追加インジケーター候補：**
- MACD (12, 26, 9)
- RSI (14)
- VWAP
- ATR (14)
- ADX (14)
- 出来高プロファイル

**追加描画ツール候補：**
- フィボナッチリトレースメント
- フィボナッチエクステンション
- ピッチフォーク
- 平行チャネル
- 計測ツール（値幅・期間）


### Phase 6: 仕上げとデプロイ最適化（Day 15-16）

**タスク：**
1. Vite プロダクションビルド最適化
2. Docker イメージのマルチステージビルド（サイズ削減）
3. nginx リバースプロキシ設定
4. レスポンシブ対応の検討
5. キーボードショートカット
6. パフォーマンス計測と最適化（Canvas描画の負荷軽減）

---

## Docker 構成の詳細

### docker-compose.yml のテンプレート

```yaml
version: "3.9"
services:
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    volumes:
      - ./frontend/src:/app/src    # ホットリロード用
    environment:
      - VITE_API_URL=http://localhost:8000
    depends_on:
      - backend

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    volumes:
      - ./backend/src:/app/src
      - db-data:/app/data
    environment:
      - DATABASE_URL=sqlite:///data/kanata.db
      - YFINANCE_CACHE_TTL=60
    env_file:
      - .env

volumes:
  db-data:
```

### frontend/Dockerfile

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
```

### backend/Dockerfile

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

---

## Claude Code での作業の進め方

### 推奨ワークフロー

```
1. Claude Code でプロジェクトルートを開く
2. Phase 1 の指示を投げる（上記の指示例を参考に）
3. 動作確認 → 問題があれば修正指示
4. git commit で区切りをつける
5. 次の Phase へ進む
```

### Claude Code への効果的な指示のコツ

**具体的なファイル名・パスを指定する：**
```
src/components/Chart/ChartCanvas.tsx を修正して、
MACD インジケーターの描画を追加してください。
MACDの計算ロジックは src/components/Chart/indicators.ts に追加してください。
```

**既存コードを参照させる：**
```
添付の chart.jsx の drawCandles 関数を参考に、
TypeScript版の ChartCanvas コンポーネントを作成してください。
Canvas描画ロジックはそのまま活用してください。
```

**段階的に進める：**
```
まず型定義（types.ts）だけ作成してください。
次に ChartCanvas コンポーネントの骨格を作成してください。
最後に描画ロジックを移植してください。
```

---

## WSL2 での注意事項

1. **ポートフォワーディング：** WSL2 内の Docker コンテナのポートは Windows 側からアクセス可能（`localhost:3000`）
2. **ファイルシステム性能：** プロジェクトは WSL2 のファイルシステム内に置く（`/home/user/` 以下）。Windows 側 (`/mnt/c/`) に置くとI/O性能が大幅に劣化する
3. **Docker Desktop：** WSL2 バックエンドを使用する設定にする
4. **メモリ：** `.wslconfig` で WSL2 のメモリ上限を設定（最低 4GB 推奨）
5. **GPU：** Canvas描画はCPUで行うため、GPU不要

---

## セットアップ手順（クイックスタート）

```bash
# 1. WSL2 ターミナルで作業ディレクトリを作成
mkdir -p ~/projects/kanata
cd ~/projects/kanata

# 2. Claude Code を起動
claude

# 3. 最初の指示
# 「このZIPファイルのデザインを元に、Docker Compose + Vite + React + TypeScript の
#   プロジェクトを作成してください。アプリ名は KANATA です。
#   まずPhase 1として、既存の合成データのままUIが動くようにしてください。」

# 4. ZIPファイルの内容をClaude Codeのコンテキストに渡す
# （ファイルをドラッグ&ドロップ or /add コマンド）

# 5. Docker 起動
docker compose up --build

# 6. ブラウザでアクセス
# http://localhost:3000
```

---

## 優先度マトリクス

| 優先度 | 機能 | Phase |
|--------|------|-------|
| ★★★ | Docker環境 + プロトタイプ移植 | 1 |
| ★★★ | リアル株価データ連携 | 2 |
| ★★☆ | リアルタイム更新 | 3 |
| ★★☆ | ウォッチリスト永続化 | 4 |
| ★☆☆ | ポートフォリオ管理 | 4 |
| ★☆☆ | 追加インジケーター | 5 |
| ★☆☆ | 追加描画ツール | 5 |
| ☆☆☆ | レスポンシブ対応 | 6 |

Phase 1-2 が完了すれば、実用的な個人チャートツールとして使い始められます。
