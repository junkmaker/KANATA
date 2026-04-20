# KANATA API Interface Specification

Frontend (`http://localhost:3000`) ↔ Backend (`http://localhost:8000`) 間のインターフェース仕様。

---

## 共通仕様

### ベースURL

```
http://localhost:8000
```

環境変数 `VITE_API_URL` で上書き可能。

### レスポンスエンベロープ

Watchlists / Search エンドポイントは以下の共通エンベロープを返す。  
**Quotes エンドポイントはエンベロープなしで直接配列を返す**（例外）。

```typescript
interface ApiResponse<T> {
  success: boolean;
  data: T | null;      // 失敗時 null
  error: string | null; // 成功時 null
}
```

### CORS 設定

| 項目 | 値 |
|------|-----|
| Allow Origins | `http://localhost:3000`, `http://127.0.0.1:3000` |
| Allow Methods | `GET POST PUT PATCH DELETE` |
| Allow Headers | `*` |

### 認証

認証なし。`user_id` は `"local"` 固定（シングルユーザー運用）。

---

## エンドポイント一覧

### 1. ヘルスチェック

```
GET /api/health
```

**レスポンス** `200`

```json
{ "status": "ok" }
```

---

### 2. ウォッチリスト

#### 2-1. 全取得

```
GET /api/watchlists
```

**レスポンス** `200`

```json
{
  "success": true,
  "data": [Watchlist, ...],
  "error": null
}
```

---

#### 2-2. 作成

```
POST /api/watchlists
Content-Type: application/json
```

**リクエストボディ**

```typescript
{
  name: string   // 1〜128文字
}
```

**レスポンス** `201`

```json
{
  "success": true,
  "data": Watchlist,
  "error": null
}
```

**エラー**

| HTTP | detail | 原因 |
|------|--------|------|
| 409 | `"watchlist name already exists"` | 同名リストが既に存在 |

---

#### 2-3. 更新（名前変更 / デフォルト設定）

```
PATCH /api/watchlists/{list_id}
Content-Type: application/json
```

**リクエストボディ**（いずれか、または両方）

```typescript
{
  name?: string   // 1〜128文字
  is_default?: boolean
}
```

**レスポンス** `200`

```json
{
  "success": true,
  "data": Watchlist,
  "error": null
}
```

**エラー**

| HTTP | detail | 原因 |
|------|--------|------|
| 404 | `"watchlist not found"` | 指定IDが存在しない |
| 409 | `"watchlist name already exists"` | 同名リストが既に存在 |

---

#### 2-4. 削除

```
DELETE /api/watchlists/{list_id}
```

**レスポンス** `200`

```json
{
  "success": true,
  "data": { "id": 1 },
  "error": null
}
```

**エラー**

| HTTP | detail | 原因 |
|------|--------|------|
| 400 | `"cannot delete the last watchlist"` | 最後の1件は削除不可 |
| 404 | `"watchlist not found"` | 指定IDが存在しない |

---

#### 2-5. 順序変更

```
PUT /api/watchlists/reorder
Content-Type: application/json
```

**リクエストボディ**

```typescript
{
  ids: number[]  // 全ウォッチリストIDを新順序で指定（全件必須）
}
```

**レスポンス** `200`

```json
{
  "success": true,
  "data": [Watchlist, ...],
  "error": null
}
```

**エラー**

| HTTP | detail | 原因 |
|------|--------|------|
| 400 | `"ids must match existing watchlists exactly"` | IDセットが既存と不一致 |

---

### 3. ウォッチリストアイテム

#### 3-1. アイテム追加

```
POST /api/watchlists/{list_id}/items
Content-Type: application/json
```

**リクエストボディ**

```typescript
{
  symbol: string          // 1〜32文字（大文字化される）
  market?: string         // "US" | "JP"、デフォルト "US"（4桁数字は強制 "JP"）
  display_name?: string   // 最大128文字、省略可
}
```

**レスポンス** `201`

```json
{
  "success": true,
  "data": Watchlist,   // items を含む最新状態
  "error": null
}
```

**エラー**

| HTTP | detail | 原因 |
|------|--------|------|
| 404 | `"watchlist not found"` | 指定リストが存在しない |
| 409 | `"symbol already in watchlist"` | 同シンボルが既に存在 |

---

#### 3-2. アイテム削除

```
DELETE /api/watchlists/{list_id}/items/{symbol}
```

**レスポンス** `200`

```json
{
  "success": true,
  "data": Watchlist,
  "error": null
}
```

**エラー**

| HTTP | detail | 原因 |
|------|--------|------|
| 404 | `"item not found"` | 指定シンボルが存在しない |

---

#### 3-3. アイテム順序変更

```
PUT /api/watchlists/{list_id}/items/reorder
Content-Type: application/json
```

**リクエストボディ**

```typescript
{
  symbols: string[]  // リスト内全シンボルを新順序で指定（全件必須）
}
```

**レスポンス** `200`

```json
{
  "success": true,
  "data": Watchlist,
  "error": null
}
```

**エラー**

| HTTP | detail | 原因 |
|------|--------|------|
| 400 | `"symbols must match existing items exactly"` | シンボルセットが既存と不一致 |

---

### 4. 相場データ（OHLCV）

```
GET /api/quotes/{symbol}?timeframe={timeframe}
```

**パスパラメータ**

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `symbol` | string | ティッカーシンボル（例: `AAPL`, `7203`） |

**クエリパラメータ**

| パラメータ | 型 | デフォルト | 選択肢 |
|-----------|-----|----------|--------|
| `timeframe` | string | `1D` | `5m` `15m` `60m` `1D` `1W` `1M` |

**レスポンス** `200`（エンベロープなし）

```typescript
OHLCBar[]
```

```typescript
interface OHLCBar {
  t: number;  // Unix timestamp（ミリ秒）
  o: number;  // 始値 (Open)
  h: number;  // 高値 (High)
  l: number;  // 安値 (Low)
  c: number;  // 終値 (Close)
  v: number;  // 出来高 (Volume)
}
```

**エラー**

| HTTP | detail | 原因 |
|------|--------|------|
| 404 | `"No data for {symbol}"` | データが存在しない |
| 502 | `"Data fetch failed: {error}"` | yfinance 取得失敗 |

**タイムフレーム → yfinance 変換**

| Frontend | yfinance interval | 取得期間 |
|----------|------------------|---------|
| `5m` | `5m` | 5日 |
| `15m` | `15m` | 30日 |
| `60m` | `60m` | 60日 |
| `1D` | `1d` | 1年 |
| `1W` | `1wk` | 5年 |
| `1M` | `1mo` | 10年 |

**JP銘柄の自動処理**  
4桁の数字シンボル（例: `7203`）はバックエンドで自動的に `7203.T` に変換して yfinance に渡す。フロントエンドは変換不要。

---

### 5. シンボル検索

```
GET /api/search?q={query}
```

**クエリパラメータ**

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `q` | string | 検索クエリ（省略 or 空文字 → プリセット全15件を返す） |

**レスポンス** `200`

```json
{
  "success": true,
  "data": [SearchResult, ...],
  "error": null
}
```

```typescript
interface SearchResult {
  code: string;
  name: string;
  market: 'JP' | 'US';
}
```

**検索ロジック**

1. 空クエリ → プリセット全15件を返す
2. プリセット内でコード/名前前方一致 → 該当プリセットのみ返す
3. プリセット未マッチ且つクエリ長 ≥ 2 → yfinance.Search で外部検索

**プリセット銘柄**

| コード | 企業名 | マーケット |
|--------|-------|-----------|
| 7203 | Toyota Motor | JP |
| 6758 | Sony Group | JP |
| 9984 | SoftBank Group | JP |
| 6861 | Keyence | JP |
| 8306 | Mitsubishi UFJ | JP |
| 9432 | NTT | JP |
| 7974 | Nintendo | JP |
| AAPL | Apple Inc. | US |
| MSFT | Microsoft | US |
| NVDA | NVIDIA | US |
| TSLA | Tesla | US |
| GOOGL | Alphabet | US |
| AMZN | Amazon | US |
| META | Meta Platforms | US |
| JPM | JPMorgan Chase | US |

---

## 型定義

### Watchlist

```typescript
interface Watchlist {
  id: number;
  name: string;
  position: number;       // 表示順（0オリジン）
  is_default: number;     // 0 or 1（boolean ではなく int）
  created_at: string;     // ISO 8601 datetime
  updated_at: string;
  items: WatchlistItem[];
}
```

### WatchlistItem

```typescript
interface WatchlistItem {
  id: number;
  symbol: string;
  market: string;           // "US" | "JP"
  display_name: string | null;
  position: number;
}
```

---

## バリデーション制約まとめ

| フィールド | 制約 |
|-----------|------|
| `Watchlist.name` | 1〜128文字 |
| `WatchlistItem.symbol` | 1〜32文字、保存時に大文字化 |
| `WatchlistItem.market` | 1〜16文字、デフォルト `"US"`、4桁数字は強制 `"JP"` |
| `WatchlistItem.display_name` | 最大128文字、省略可 |
| `(user_id, watchlist.name)` | ユニーク制約 |
| `(watchlist_id, item.symbol)` | ユニーク制約 |

---

## キャッシング

Quotes エンドポイントはプロセス内メモリの TTLCache を使用。Redis 等は不使用。

| timeframe | キャッシュ TTL |
|-----------|-------------|
| `5m` | 60秒 |
| `15m` | 5分 |
| `60m` | 15分 |
| `1D` | 1時間 |
| `1W` | 1日 |
| `1M` | 1日 |

---

## エラーハンドリング（フロントエンド）

`watchlistApi.ts` の `unwrap()` は以下の順でエラーを処理する：

1. `res.ok === false` → `res.json().detail` または `statusText` をメッセージに `Error` を throw
2. `body.success === false` → `body.error` をメッセージに `Error` を throw
3. `body.data === null` → `"API returned unsuccessful response"` を throw

Quotes / Search エンドポイントのエラーは呼び出し元で個別にハンドリング。

---

## 関連ファイル

| 役割 | ファイル |
|------|---------|
| Backend ルーター登録 | `backend/src/main.py` |
| Watchlists ルート | `backend/src/routes/watchlists.py` |
| Quotes ルート | `backend/src/routes/quotes.py` |
| Search ルート | `backend/src/routes/search.py` |
| Pydantic スキーマ | `backend/src/schemas/watchlist.py` |
| ApiResponse 定義 | `backend/src/schemas/common.py` |
| ORM モデル | `backend/src/db/models.py` |
| Watchlist API クライアント | `frontend/src/lib/watchlistApi.ts` |
| Quotes API クライアント | `frontend/src/lib/api.ts` |
| Search API クライアント | `frontend/src/lib/searchApi.ts` |
| TypeScript 型定義 | `frontend/src/types.ts` |
| Watchlist フック | `frontend/src/hooks/useWatchlists.ts` |
| Chart データフック | `frontend/src/hooks/useChartData.ts` |
| Search フック | `frontend/src/hooks/useDebouncedSearch.ts` |
