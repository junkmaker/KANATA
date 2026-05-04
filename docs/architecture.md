# KANATA Architecture

## 1. システム全体図

```mermaid
graph TB
    subgraph Electron["Electron App (Windows)"]
        subgraph MAIN["Main Process"]
            IDX["index.ts\nBrowserWindow (frameless)"]
            SIDECAR["pythonSidecar.ts\nサブプロセス管理"]
            IPC["ipc/bridge.ts\nipcMain handler (9チャンネル)"]
            PRE["preload.ts\ncontextBridge"]
        end
        subgraph RENDERER["Renderer Process"]
            VITE["React + Vite\nrenderer"]
        end
        subgraph SIDECARPROC["Python Sidecar (subprocess)"]
            UVICORN["Uvicorn / FastAPI\n動的ポート"]
            SQLITE["SQLite\n%APPDATA%/kanata/kanata.db"]
        end
    end
    EXT["yfinance (PyPI)\n外部株価データ"]

    IDX -- "spawn" --> SIDECAR
    SIDECAR -- "起動 --port 0" --> UVICORN
    IDX -- "register" --> IPC
    PRE -- "contextBridge" --> VITE
    VITE -- "IPC getBackendUrl()" --> IPC
    VITE -- "IPC ウィンドウ操作" --> IPC
    VITE -- "HTTP fetch\n動的ポート" --> UVICORN
    UVICORN -- "SQLAlchemy 2.x" --> SQLITE
    UVICORN -- "pip request" --> EXT
```

---

## 2. データフロー

```mermaid
sequenceDiagram
    participant B as Browser
    participant FE as React App
    participant HK as useChartData Hook
    participant API as api.ts
    participant BE as FastAPI
    participant CA as TTLCache
    participant YF as yfinance

    B->>FE: シンボル選択 / TF変更
    FE->>HK: symbols[], timeframe 更新
    HK->>API: fetchQuotes(symbol, tf)
    API->>BE: GET /api/quotes/{symbol}?timeframe=1D
    BE->>CA: キャッシュ確認

    alt キャッシュヒット
        CA-->>BE: OHLCBar[]
    else キャッシュミス
        BE->>YF: Ticker(symbol.T).history()
        YF-->>BE: DataFrame
        BE->>CA: キャッシュ保存
        CA-->>BE: OHLCBar[]
    end

    BE-->>API: OHLCBar[]
    API-->>HK: OHLCBar[]
    HK-->>FE: realData 更新
    FE->>B: Chart 再描画
```

---

## 3. フロントエンド コンポーネントツリー

```mermaid
graph TD
    APP["App.tsx\nAppState / localStorage\nuseWatchlists\nuseChartData"]

    APP --> TOPBAR["TopBar\nブランド / 現在値 / ステータス"]
    APP --> MAIN["main-grid"]
    APP --> STATUSBAR["StatusBar\nTF / ツール / 描画数"]
    APP --> TWEAKS["TweaksPanel\nテーマ / 密度 / 比較モード"]

    TOPBAR --> WC["WindowControls\n最小化 / 最大化 / 閉じる"]

    MAIN --> LP["LeftPanel\nTF選択 / 描画ツール\nインジケータ トグル"]
    MAIN --> CHART["Chart.tsx\nCanvas 2D (1368行)"]
    MAIN --> RP["RightPanel\nウォッチリスト / 検索\n基礎情報メトリクス"]

    CHART --> CANDLE["ローソク足\nグリッド / 価格軸"]
    CHART --> OVERLAY["オーバーレイ指標\nSMA / EMA / BOLL / PSAR / 一目"]
    CHART --> COMPARE["比較ライン\n複数シンボル % change"]
    CHART --> SUB["サブパネル"]
    CHART --> DRAWING["描画ツール\nhline / vline / trend / rect / ellipse / text"]

    SUB --> VOL["drawVolume.ts"]
    SUB --> STOCH["drawStoch.ts"]
    SUB --> MACD["drawMacd.ts"]
    SUB --> RSI["drawRsi.ts"]

    RP --> WLS["WatchlistSelector\nドロップダウン / CRUD"]
    RP --> ASF["AddSymbolForm\n検索 / 銘柄追加"]
    RP --> TICKER["銘柄行リスト\nスパークライン / 価格"]
    RP --> FIN["基礎情報パネル\nROE / ROIC / PER 等"]
```

---

## 4. 状態管理

```mermaid
graph LR
    subgraph APP["App.tsx (単一ソース)"]
        STATE["AppState\nselected[]\ntimeframe\nactiveTool\ndrawings[]\nselectedDrawingId\nindicators{}\nindicatorParams{}\nshowVolume\nshowFinancial\nfinancial{}"]
        AES["Aesthetic\ndark-blue / neutral\namber-crt / midnight"]
        DEN["Density\ncompact / comfortable"]
        AWL["activeWatchlistId"]
    end

    subgraph HOOKS["Custom Hooks"]
        USEWD["useWatchlists\n watchlists[]\n status\n CRUD メソッド"]
        USECD["useChartData\n realData{}\n status\n errors{}"]
        USEDS["useDebouncedSearch\n results[]\n loading\n 280ms debounce"]
    end

    subgraph LS["localStorage"]
        LS1["kanata.state"]
        LS2["kanata.aesthetic"]
        LS3["kanata.density"]
        LS4["kanata.activeWatchlistId"]
    end

    STATE <-- "JSON serialize" --> LS1
    AES <-- --> LS2
    DEN <-- --> LS3
    AWL <-- --> LS4

    USEWD -- "watchlists[]" --> APP
    USECD -- "realData{}" --> APP
    USEDS -- "results[]" --> ASF["AddSymbolForm"]
```

---

## 5. バックエンド レイヤー構成

```mermaid
graph TB
    subgraph ROUTES["Routes (HTTP Handler)"]
        QR["quotes.py\nGET /api/quotes/{symbol}"]
        SR["search.py\nGET /api/search"]
        WR["watchlists.py\n8 エンドポイント"]
        FR["fundamentals.py\nGET /api/fundamentals/{symbol}/quarterly"]
        HR["/api/health"]
    end

    subgraph SERVICES["Services"]
        YFP["yfinance_provider.py\nto_yf_symbol()\nINTERVAL_MAP\nfetch_ohlcv()"]
        CACHE["cache.py\nTTLCache\n(in-memory)"]
    end

    subgraph SCHEMAS["Schemas (Pydantic v2)"]
        COMMON["common.py\nApiResponse[T]\nok() / fail()"]
        WSCH["watchlist.py\nWatchlistRead\nWatchlistCreate\nWatchlistUpdate\n..."]
    end

    subgraph DB["Database (SQLAlchemy 2.x)"]
        DBMOD["models.py\nWatchlist\nWatchlistItem"]
        DBINIT["init_db.py\ncreate_all()\ndefault seed"]
        DBCONN["database.py\nengine\nSessionLocal\nget_db()"]
    end

    QR --> YFP
    QR --> CACHE
    SR --> YFP
    FR --> YFP
    WR --> WSCH
    WR --> DBMOD
    DBMOD --> DBCONN
    DBCONN --> SQLITE[(SQLite\nkanata.db)]
    DBINIT --> DBCONN
```

---

## 6. データモデル

```mermaid
erDiagram
    Watchlist {
        int id PK
        string user_id "固定: local"
        string name "1-128文字"
        int position "表示順"
        int is_default "0 or 1"
        datetime created_at
        datetime updated_at
    }

    WatchlistItem {
        int id PK
        int watchlist_id FK
        string symbol "大文字 1-32文字"
        string market "JP or US"
        string display_name "nullable"
        int position "表示順"
        datetime created_at
    }

    Watchlist ||--o{ WatchlistItem : "items (CASCADE DELETE)"
```

---

## 7. IPC チャンネル一覧

| チャンネル定数 | チャンネル名 | 方向 | 用途 |
|---|---|---|---|
| `BACKEND_URL` | `kanata:backend-url` | invoke | FastAPI の動的ポート URL 取得 |
| `BACKEND_STATUS` | `kanata:backend-status` | invoke | サイドカー状態取得 (`SidecarStatus`) |
| `OPEN_LOGS` | `kanata:open-logs` | invoke | ログディレクトリを OS で開く |
| `APP_VERSION` | `kanata:app-version` | invoke | アプリバージョン取得 |
| `WINDOW_MINIMIZE` | `kanata:window-minimize` | invoke | ウィンドウ最小化 |
| `WINDOW_MAXIMIZE` | `kanata:window-maximize` | invoke | 最大化 / 元に戻す トグル |
| `WINDOW_CLOSE` | `kanata:window-close` | invoke | ウィンドウ閉じる |
| `WINDOW_IS_MAXIMIZED` | `kanata:window-is-maximized` | invoke | 最大化状態を取得 |
| `WINDOW_MAXIMIZE_CHANGED` | `kanata:window-maximize-changed` | push | 最大化状態変化イベント |

`PreloadApi` (`packages/shared-types`) が全チャンネルの型を定義し、`window.kanata` 経由でレンダラーに公開。

---

## 8. タイムフレーム変換

```mermaid
graph LR
    FE["Frontend\n5m / 15m / 60m\n1D / 1W / 1M"]
    BE["yfinance\n5m / 15m / 60m\n1d / 1wk / 1mo"]
    CA["TTL Cache\n60s / 5m / 15m\n1h / 1d / 1d"]

    FE -- "INTERVAL_MAP\n(yfinance_provider.py)" --> BE
    BE -- "キャッシュ TTL" --> CA
```

---

## インフラ構成サマリー

| 項目 | 値 |
|------|-----|
| Electron | v40 / Windows ネイティブアプリ（frameless window）|
| Frontend | React 18 + TypeScript + Vite / Node 20（Renderer Process）|
| Backend | FastAPI + SQLAlchemy 2.x / Python 3.12（Sidecar subprocess）|
| DB | SQLite（`%APPDATA%/kanata/kanata.db`）|
| 外部データ | yfinance（pip）|
| 認証 | なし（`user_id = "local"` 固定）|
| キャッシュ | プロセス内メモリ TTLCache（Redis 未使用）|
