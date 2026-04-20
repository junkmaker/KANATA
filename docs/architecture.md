# KANATA Architecture

## 1. システム全体図

```mermaid
graph TB
    subgraph Host["WSL2 Host"]
        subgraph DC["Docker Compose"]
            subgraph FE["Frontend Container (Node 20)"]
                VITE["Vite Dev Server\n:3000"]
            end
            subgraph BE["Backend Container (Python 3.12)"]
                UVICORN["Uvicorn / FastAPI\n:8000"]
            end
            subgraph VOL["Named Volume"]
                SQLITE["SQLite\nkanata.db"]
            end
        end
        subgraph FS["Host Filesystem"]
            SRC_FE["./frontend/src"]
            SRC_BE["./backend/src"]
        end
    end
    EXT["yfinance (PyPI)\n外部株価データ"]

    VITE -- "HTTP fetch\nVITE_API_URL" --> UVICORN
    UVICORN -- "SQLAlchemy 2.x" --> SQLITE
    UVICORN -- "pip request" --> EXT
    SRC_FE -- "bind mount\nホットリロード" --> VITE
    SRC_BE -- "bind mount\nホットリロード" --> UVICORN

    Browser["Browser\nlocalhost:3000"] -- "HTTP" --> VITE
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
    FE->>FE: realData で syntheticData を上書き
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

    MAIN --> LP["LeftPanel\nTF選択 / 描画ツール\nインジケータ トグル"]
    MAIN --> CHART["Chart.tsx\nCanvas 2D (717行)"]
    MAIN --> RP["RightPanel\nウォッチリスト / 検索\n基礎情報メトリクス"]

    CHART --> CANDLE["ローソク足\nグリッド / 価格軸"]
    CHART --> OVERLAY["オーバーレイ指標\nSMA / EMA / BOLL / PSAR / 一目"]
    CHART --> COMPARE["比較ライン\n複数シンボル % change"]
    CHART --> SUB["サブパネル"]
    CHART --> DRAWING["描画ツール\nトレンドライン / 水平線 等"]

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
        STATE["AppState\nselected[]\ntimeframe\nactiveTool\ndrawings[]\nindicators{}\nindicatorParams{}"]
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

## 7. データ二層構造（合成 vs リアル）

```mermaid
graph LR
    subgraph SYNTH["合成データ層 (常時)"]
        GEN["lib/data.ts\ngenSeries()\n15銘柄分 OHLC\n(GBM + seed乱数)"]
    end

    subgraph REAL["リアルデータ層 (selected銘柄のみ)"]
        HK["useChartData\n→ /api/quotes/{symbol}"]
    end

    subgraph MERGE["App.tsx でマージ"]
        APP["realData[sym] があれば\nsyntheticData[sym] を上書き"]
    end

    subgraph USES["用途"]
        U1["ウォッチリスト スパークライン\n(全銘柄)"]
        U2["バックエンド停止時\nフォールバック"]
        U3["非選択銘柄の\n比較チャート"]
        U4["選択銘柄の\nメインチャート"]
    end

    GEN --> APP
    HK --> APP
    APP --> U1
    APP --> U2
    APP --> U3
    APP --> U4
```

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
| Frontend | React 18 + TypeScript + Vite / Node 20 |
| Backend | FastAPI + SQLAlchemy 2.x / Python 3.12 |
| DB | SQLite（Docker Named Volume `kanata-db`） |
| 外部データ | yfinance（pip）|
| コンテナ化 | Docker Compose（開発モード：bind mount + ホットリロード） |
| WSL2 監視 | `CHOKIDAR_USEPOLLING=true` + Vite `usePolling` |
| 認証 | なし（`user_id = "local"` 固定）|
| キャッシュ | プロセス内メモリ TTLCache（Redis 未使用）|
