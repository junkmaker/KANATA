# KANATA機能追加: N字波動パターン スクリーニング機能

## 背景・目的
KANATA(個人用チャート分析デスクトップアプリ / Electron + FastAPI(yfinance) + React/TypeScript)に、
東証プライム銘柄を対象とした「N字波動パターン」の自動スクリーニング機能を追加する。

N字波動とは「安値→高値→押し目(直近安値を割らない)→高値更新」という上昇継続パターンを指す。
既存のMACDゴールデンクロス/デッドクロスのフェイクアウト判定ロジックと組み合わせ、
複合シグナルとして精度を上げることを最終目標とする。

---

## 1. スコープ

### 対象ユニバース
- 東証プライム全銘柄(約1,600社)のうち、**時価総額100億円以上**でフィルタ(概算800〜900社)
- 銘柄マスタ(コード・銘柄名・時価総額)は事前にCSVとして用意する方針
  - 取得元候補: JPXの月次公表データ、または株探/バフェットコードのスクリーニングCSVエクスポート
  - 初回はサンプルCSV(ダミーデータでも可)を読み込む形で実装し、後日実データに差し替え可能な設計にする

### 除外するもの(今回のスコープ外)
- 東証プライム以外の市場(スタンダード・グロース)
- リアルタイム/ザラ場中の逐次更新(日次バッチ処理を前提)

---

## 2. アルゴリズム仕様

### 2.1 ピボット検出(ZigZag方式)
- 単純な`scipy.signal.argrelextrema`ではなくノイズ除去のため、**閾値ベースのZigZag関数を自前実装**する
- 反転判定の閾値(`zigzag_pct`)は固定値ではなく、銘柄のATR(Average True Range)に応じて可変にする
  - 例: `zigzag_pct = max(3.0, ATR比率 * 係数)` のような形で、ボラティリティが高い銘柄は閾値を広げる
- 入力: 直近6ヶ月分の日足終値(またはOHLC)
- 出力: `[{index, date, price, type: 'low'|'high'}, ...]` のピボットリスト

### 2.2 N字パターン判定ロジック
直近4つのピボット `A(安値) → B(高値) → C(安値) → D(高値)` に対して、以下をすべて満たす場合に検出:

```
B.price > A.price          # 第一波上昇
A.price < C.price < B.price  # 押し目が直近安値(A)を割らない
D.price > B.price          # 高値更新(ブレイクポイント)
```

### 2.3 信頼度スコアリング(フェイクブレイク除去)
以下の要素を加点/減点方式でスコア化し、0〜100のスコアを返す:
- **出来高**: Dのブレイク時点の出来高が直近20日平均比+50%以上 → 加点
- **MACD**: ブレイク時点でMACDがゴールデンクロス方向 → 加点(既存のMACDフィルタリングロジックと連携)
- **押し目の深さ**: (B-C)/(B-A) が浅すぎる(<20%)場合は減点(押し目として機能していない可能性)
- **経過日数**: A→Dの期間が短すぎる(例: 5日未満)場合は減点(ノイズの可能性)

> **補足(2026-07 のバックテスト結果)**: このスコアにも構成要素にも前方リターンの予測力が無いことが
> 確定した(`docs/n_pattern_backtest_spec.md` §16.2、`TREND_BONUS = 0` の経緯は CLAUDE.md を参照)。
> スコアは**算出と API レスポンスには残すが、順位付け・絞り込み・UI 表示には使わない**。
> 再検証の経路(閾値を戻して測り直す)を潰さないための保存であって、有効性の主張ではない。

---

## 3. バックエンド実装(FastAPI)

### 3.1 新規モジュール
```
backend/
  analysis/
    n_pattern.py       # ZigZag抽出 + N字判定 + スコアリング
  data/
    prime_universe.csv # 銘柄マスタ(コード, 銘柄名, 時価総額)
```

### 3.2 関数シグネチャ(たたき台)
```python
def extract_zigzag_pivots(close: pd.Series, zigzag_pct: float) -> list[dict]:
    ...

def detect_n_pattern(df: pd.DataFrame, zigzag_pct: float = 3.0) -> dict | None:
    """
    Returns: {'detected': bool, 'score': int, 'pivots': [...]} or None
    """
    ...

def screen_n_pattern_prime(
    min_market_cap: int = 10_000_000_000,
    universe_csv: str = "data/prime_universe.csv"
) -> list[dict]:
    """
    銘柄マスタを読み込み→時価総額フィルタ→各銘柄でdetect_n_pattern実行
    Returns: [{'ticker', 'name', 'market_cap', 'score', 'pivots'}, ...] (score降順)
    """
    ...
```

### 3.3 新規APIエンドポイント

> 以下は実装済みの現行仕様。当初案にあった `min_market_cap` / `min_score` のクエリは**存在しない**
> （`min_market_cap` は実装されず、`min_score` はスコアの無効性が確定した時点で廃止した。§2.3 の補足を参照）。

```
GET /api/screening/n-pattern
  query params: なし
  response: {generated_at, universe_count, scanned_count, universe_id, universe_name, results[]}
            results は break_date 降順（同着は ticker 昇順）。キャッシュ済み JSON をそのまま返す

POST /api/screening/n-pattern/scan   -> 202 {status: "started"}（ボディ省略可 / {universe_id}）
GET  /api/screening/n-pattern/status -> {status, done, total, started_at, error}

GET    /api/screening/universes            -> {universes: [...]}
POST   /api/screening/universes            -> 201 UniverseInfo（{name, csv_text}）
DELETE /api/screening/universes/{id}       -> {status: "deleted"}
```

エンベロープ（`{success, data, error}`）は使わず、エラーは `HTTPException` + `detail` で返す（macro 系と同じ）。

results の各行は `market_cap`（CSV 登録値）に加えて `market_cap_asof`（実施日時点の実測値、
取得失敗時 null）と `market_cap_date`（その基準日 = 最終日足バーの日付）を持つ。
いずれも旧 JSON との後方互換のため既定 null。

### 3.4 パフォーマンス考慮
- yfinanceの`.info`は銘柄ごとに追加リクエストが発生し重いため、時価総額は**事前CSVでフィルタしてから**株価データ取得する
- **表示用の時価総額は「実施日時点」の実測値**（発行済株式数 × 最終日足終値）。ヒット銘柄だけ
  `Ticker.get_shares_full()` を 1 本追加で叩き、価格は既に取得済みの日足 df から使う。
  `fast_info.market_cap` を使わないのは、内部で 1 年分の履歴を**再取得**して 2 リクエストになるため。
  CSV の `market_cap` は**スキャン前の足切りフィルタ**（全銘柄に掛かるので実測化できない）と、
  実測値が取れなかった銘柄のフォールバック表示に使い続ける。
- 800〜900銘柄のループには`time.sleep(0.2)`等のレート制限対策を入れる
- 日次バッチとして実行し、結果をキャッシュ(DBまたはJSONファイル)して都度APIから返す設計にする(毎回全銘柄再計算しない)

---

## 4. フロントエンド実装(React/TypeScript)

> 現行仕様は [screening_ui_repositioning_plan.md](screening_ui_repositioning_plan.md) が正。以下は実装済みの要約。

- 既存のMACDシグナルバッジと同様のUI設計で、「N字候補」タブまたはセクションを追加
- 表示項目: 銘柄コード・銘柄名・時価総額（**実施日時点**。取れない場合は CSV 値へフォールバックし
  `*` と muted 色で出所を示す）・ブレイク日・発火要素バッジ・チャートサムネイル(ピボット点をマーカー表示)
- **スコアは表示しない**。並び順は `break_date` 降順(同着は ticker 昇順)、絞り込みはブレイク日の鮮度(全件 / 3日以内 / 7日以内)
- 要素は合成せずバッジで並べ、良し悪しを示す配色は使わない(強調した瞬間に「有望」と読まれ、消したはずの期待値の含意が戻るため)

---

## 5. 実装ステップ(推奨順序)

1. `extract_zigzag_pivots`関数の単体実装・テスト(既知のチャートパターンで検証)
2. `detect_n_pattern`関数の実装(ピボット4点判定ロジック)
3. スコアリングロジックの実装(既存MACDフィルタとの連携含む)
4. 銘柄マスタCSV(ダミーで可)の用意 + `screen_n_pattern_prime`実装
5. FastAPIエンドポイント`/api/screening/n-pattern`追加
6. フロントエンドUI追加(既存のMACDバッジUIを流用)
7. 日次バッチ実行の仕組み(スケジューラまたは手動トリガー)を検討

---

## 6. 備考
- 銘柄マスタの実データ取得方法は未確定。JPX公表データ or 株探/バフェットコードのCSVエクスポートを想定しているが、
  実装時点でユーザー側から最新のCSVを提供してもらう前提で進めてよい
- MACDゴールデンクロス/デッドクロスのフェイクアウト判定ロジック(既存実装)との連携部分は、
  既存コードのインターフェースを確認した上で接続すること
