# KANATA機能追加: PPP（パーフェクトオーダー）スクリーニング仕様

移動平均線が短期→長期の順に上から並ぶ状態（通称 PPP / パンパカパン）を、
既存の N字スクリーニングと同じ画面・同じスキャンジョブの上に追加する。

本書は設計決定とその**根拠**を残すことを目的とする。数値の妥当性は測っていない
（測定設計は [ppp_incremental_measurement.md](ppp_incremental_measurement.md) に分離）。

---

## 0. 決定事項サマリ

| # | 論点 | 決定 | 却下した案と理由 |
|---|------|------|-----------------|
| 1 | 移動平均線セット | **SMA 5 / 25 / 75** | 5/20/60/100/300（相場師朗のオリジナル）は取得期間を 2y 以上へ拡張する必要があり、300日線の助走で 1y では成立判定期間がほぼ消える |
| 2 | 事象か状態か | **成立イベント**（非PPP → PPP の転換日） | 状態を全件出すと上昇トレンド銘柄がほぼ全部並び、ユニバースの部分集合コピーになる |
| 3 | チャタリング抑制 | **ヒステリシス**（成立は厳格・崩壊は緩く） | 傾き条件は「短期が上」とほぼ同じ情報の二重掛けで交差の根本に効かない。クールダウン日数は期間の根拠が作れない |
| 4 | 乖離の単位 | **ATR 単位**（係数 `k` 1個） | 固定 % は銘柄のボラティリティで意味が変わる。`k` は「日足何本ぶんの値動きに相当する間隔か」という物理的意味を持つ |
| 5 | 崩壊の定義 | **負の閾値**（シュミットトリガ、`-k_exit`） | 即崩壊はチャタリングが戻る。日数猶予は暗黙のクールダウンが混ざり効果を切り分けられない |
| 6 | 窓先頭の初期状態 | **不明扱い**（崩壊を一度観測するまで成立を出さない） | 非PPP とみなすと 8ヶ月前の嘘の一斉成立が数百件出る。取得期間拡張は不要 |
| 7 | スキャン・保存 | **スキャン 1 周共有 / 結果 JSON はパターン別 / エンドポイント一般化** | 独立スキャンは数十分の取得をもう一周払う。1 JSON 混在は `ScreeningResult` を全 optional のユニオンにする |
| 8 | UI 配置 | **スクリーニング画面内のパターンタブ** | 別 view にするとスキャンボタンが 2 箇所に出て同じジョブを叩く。2表同時は行数が半減する |
| 9 | 数値表示 | **出さない**（列は コード / 銘柄名 / 時価総額 / 成立日 / サムネイル） | 乖離値を出すと大小比較が始まる。閾値でバッジ化するのはスコアの再発明 |
| 10 | 検証の位置づけ | **表示は検証を待たない**、条件別測定は後追い | 「否決は表示をやめる理由にはならない（中立な観察ツール）」という既存の立場と揃える |

後方互換は**不要**（旧 `n_pattern_results.json` を読めなくてよい）。結果 JSON は
スキーマごと作り直してよい。

---

## 1. 定義

### 1.1 PPP 状態

各バー `t` について、SMA(5) / SMA(25) / SMA(75)（終値ベース、`lib/indicators.ts` の
`SMA` と同値）を計算し、次の 2 つの乖離量を ATR 単位で定義する。

```
gap_short(t) = (sma5(t)  - sma25(t)) / atr(t)
gap_long(t)  = (sma25(t) - sma75(t)) / atr(t)
```

`atr(t)` は `ATR_PERIOD = 14` の因果的 ATR 系列（`n_pattern.py` の `_atr_series` と同じ
`rolling(min_periods=1).mean()`）。

- **成立条件**: `gap_short(t) >= k` **かつ** `gap_long(t) >= k`
- **崩壊条件**: `gap_short(t) < -k_exit` **または** `gap_long(t) < -k_exit`

両ペアに同じ `k` を使う。ペアごとに別の閾値を持たせない（自由度を増やさないため）。
成立と崩壊のあいだ（`-k_exit <= gap < k` の帯）は**直前の状態を維持する**。これが
ヒステリシスの実体で、線が接近して絡んでいる区間での往復を構造的に潰す。

### 1.2 状態機械

状態は `unknown` / `in`（PPP中） / `out`（非PPP）の 3 値。

```
初期状態 = unknown            # sma75 が立つ最初のバー以降で評価を開始

unknown → out   : 崩壊条件を満たしたバー（イベントは出さない）
unknown → in    : 遷移しない（unknown のまま持ち越す）
out     → in    : 成立条件を満たしたバー = 【成立イベント】
in      → out   : 崩壊条件を満たしたバー（イベントは出さない）
```

`unknown` から直接 `in` へ行かないのが Q6=A の実体。窓の先頭で既に並んでいる銘柄は、
「いつ成立したか」が窓の外にあるため成立と呼べない。一度崩壊を観測して初めて
`out` に落ち、そこから先の成立は正しく観測できる。

この状態機械は**因果的**である（時刻 `t` の判定が `t` 以前しか参照しない）。したがって
`walk_forward_signals` のように prefix を切って再実行する必要がなく、1 回の前方パスで
全イベントが得られる（O(n)）。N字の検証より計算量が桁で安い。

### 1.3 データ窓

`period="1y"`（≈245営業日）を**変更しない**。sma75 が立つのは 75 本目なので、
状態機械が動くのは約 170 本。Q1 で 5/25/75 を選んだことで取得期間の拡張が不要になり、
スキャン時間の増加はゼロ（N字と同じ df を使い回す）。

---

## 2. バックエンド構造

### 2.1 モジュール配置

```
backend/src/analysis/ppp.py          # 新規。純関数のみ・I/O なし
backend/src/services/screening_provider.py  # run_scan を 2 パターン対応に拡張
backend/src/routes/screening.py      # パターン別パスへ一般化
backend/src/schemas/screening.py     # PppResult / PppResultsResponse を追加
```

`analysis/ppp.py` は `n_pattern.py` と同じ規約に従う — 定数はモジュール先頭に集約、
pandas.DataFrame を受け取るだけでファイル I/O も yfinance 取得もしない。

**ATR 系列の共有**: `_atr_series` は現在 `n_pattern.py` のプライベート関数。
`ppp.py` から `n_pattern._atr_series` を直接呼ぶと analysis 内で横方向の依存が生まれる。
共通モジュール（例 `analysis/series.py`）へ切り出すか、`n_pattern.py` で公開名にする。
`storage.py` を他 services から独立させたのと同じ理由で、依存方向は明示的に決めること。

### 2.2 定数

```python
SMA_SHORT = 5
SMA_MID   = 25
SMA_LONG  = 75
ATR_PERIOD = 14        # n_pattern と揃える
PPP_GAP_K      = ?     # 成立の乖離下限（ATR 単位）— 未決、§5 参照
PPP_GAP_K_EXIT = ?     # 崩壊の乖離下限（ATR 単位）— 未決、§5 参照
MIN_BARS = SMA_LONG    # 状態機械の評価開始位置
```

### 2.3 スキャン

`run_scan` は銘柄ごとに `_fetch_daily_df` を **1 回**呼び、その df で
`detect_n_pattern` と `detect_ppp` の両方を回す。ヒット行の時価総額解決
（`_resolve_asof_cap`）は現行どおりヒット銘柄のみ。**どちらかのパターンに
ヒットした銘柄で 1 回だけ**解決し、両パターンの行で使い回す
（同じ銘柄に対して 2 回リクエストを撃たない）。

ジョブ状態（`_scan_state`）は**共通のまま 1 つ**。進捗 `done/total` は銘柄単位なので
パターンが増えても意味が変わらない。

代償: 「N字だけスキャンし直す」ができない。常に両方走る。

### 2.4 結果ファイル

パターン別に分けて書く。

```
<KANATA_DATA_DIR>/n_pattern_results.json
<KANATA_DATA_DIR>/ppp_results.json
```

`atomic_write_json` で個別に書く。両ファイルの `generated_at` / `universe_id` /
`universe_name` / `universe_count` / `scanned_count` は同一スキャンの値になる。

### 2.5 エンドポイント

```
GET  /api/screening/{pattern}          # pattern ∈ {n-pattern, ppp}
POST /api/screening/scan               # 全パターンを 1 ジョブで実行
GET  /api/screening/status             # 共通ジョブの進捗
```

スキャン・ステータスからパターン名を外す（1 ジョブなので `/n-pattern/scan` は嘘になる）。
未知の `pattern` は 404。ユニバース系（`/screening/universes`）は変更なし。

レスポンス形式は macro / quotes と同じ**生オブジェクト**（`{success,data,error}`
エンベロープを付けない）。エラーは `HTTPException` + `detail`。

### 2.6 スキーマ

```python
class PppResult(BaseModel):
    ticker: str
    name: str
    market_cap: int | None = None
    market_cap_asof: int | None = None
    market_cap_date: str | None = None
    established_date: str          # 成立イベント日（out → in の遷移バー）
    duration_days: int             # 成立日から最終バーまでの経過本数
    closes: list[ClosePoint] = []
```

`duration_days` は JSON に持つが**列にはしない**（成立日と 1 対 1 の情報で、
鮮度フィルタが既に同じ軸を扱っているため）。検証時に群分けの材料として使う。

乖離値（`gap_short` / `gap_long`）はレスポンスに**含めない**。N字がスコアを残したのは
「閾値を戻して測り直す」経路を潰さないためだが、PPP の乖離は検出条件そのものなので、
再計算は同じ df から常に可能で、保存する必要がない。

---

## 3. フロントエンド

### 3.1 配置

`ScreeningView` 内にパターンタブ（N字 / PPP）を置く。ツールバー
（スキャン実行 / ユニバース選択 / 進捗 / 最終スキャン / 鮮度 / 件数）は**共通**で、
表だけ差し替わる。スキャンジョブが 1 本である以上、スキャンボタンも 1 つに保つ。

- 鮮度フィルタは `AGE_OPTIONS` を共有し、**ラベル語だけ差し替える**
  （N字「ブレイク 3日以内」/ PPP「成立 3日以内」）。
- 選択中のパターンを `localStorage` の **`kanata.screening.pattern`** に永続化する
  （`kanata.screening.universeId` の隣）。次回起動時は前回のタブを開く。

### 3.2 表

| 列 | 内容 |
|----|------|
| コード | `ticker` |
| 銘柄名 | `name` |
| 時価総額 | `resolveMarketCap` をそのまま再利用（`*` とフォールバック規約も共通） |
| 成立日 | `established_date` |
| サムネイル | `closes` のみ |

**数値列を持たない**。乖離値も継続日数も出さない。「特徴」バッジ列も持たない
（PPP には N字の `score_detail` に相当するものが無く、乖離を閾値でバッジ化するのは
スコアの再発明になる）。

`ScreeningThumbnail` は現状 `pivots: ScreeningPivot[]` を必須で受け取る。PPP にピボットは
無いので、`pivots` を optional にするか、空配列を渡す規約にする。

### 3.3 純関数の共有

`screeningView.ts` の `ageInDays` / `filterByAge` / `formatMarketCap` /
`resolveMarketCap` はパターン非依存なのでそのまま使える。`sortByBreakDate` は
日付フィールド名が `break_date` 固定なので、フィールド名を引数に取る形へ一般化するか、
PPP 用の同型関数を足す。**並び順の規約は共通**（日付の新しい順、同着は ticker 昇順、
`sort` の安定性を使った 2 段階ソート）。

`useScreening` はパターンを引数に取り、対応するエンドポイントを叩く形へ拡張する。

---

## 4. スコープ外

- **逆PPP**（下降版、`sma5 < sma25 < sma75`）。同じ状態機械の符号反転で実装できるが、
  今回は上昇のみ。追加するなら本書の §1 を符号反転して読み替えること。
- 週足・月足での PPP（日足のみ）。
- N字との共起バッジ表示。同じスキャン結果なので技術的には無料だが、**共起に予測力が
  あるとは誰も測っていない**ため、バッジにすると「2つ揃ったほうが良い」という含意が付く。
  出すなら [ppp_incremental_measurement.md](ppp_incremental_measurement.md) の枠組みで
  先に測ること。
- ザラ場中の逐次更新（日次バッチ前提、N字と同じ）。

---

## 5. 未決事項

実装前に決める必要がある。

### 5.1 `k` と `k_exit` の初期値 【要決定】

ATR 単位の乖離下限。`k` を大きくすると成立が減り、`k_exit` を大きくすると崩壊が減って
再成立が抑制される。**両方とも根拠のある初期値をまだ持っていない。**

決め方の提案: 適当な数値を先に置かず、ユニバースの実データで
「`k` を 0.1 刻みで振ったときの日次成立件数」を出してから、**1 日あたりの表示件数が
実用的な範囲（数件〜数十件）に収まる最小の `k`** を採る。閾値を効果で選ぶと
in-sample への当てはめになる（`TREND_BONUS` を反転させなかったのと同じ理由）ので、
**件数という運用上の制約だけで決める**こと。

`k_exit` は `k` との比で置く（例 `k_exit = k / 2`）と自由度が 1 個で済む。

### 5.2 1 銘柄あたりのイベント数と鮮度の扱い 【要決定】

状態機械を 1 年分舐めると、1 銘柄から**複数の成立イベント**が出る。一方で結果 JSON と
表は現状「1 銘柄 1 行」を前提にしている（`ScreeningTable` の `key={r.ticker}`）。

N字は `RECENCY_MAX_BARS = 10` で「進行中のブレイクのみ採用」として同じ問題を解いている。
PPP でも同等の制約が要る。候補:

- **(a)** 各銘柄の**最新の成立イベントのみ**を採用し、さらに成立日から最終バーまでが
  N 本以内のものだけ出す（N字の `RECENCY_MAX_BARS` と同じ発想）。
- **(b)** 最新の成立イベントのみを採用し、鮮度の制限は UI の `filterByAge` に任せる
  （結果 JSON には古い成立も残る）。
- **(c)** 複数イベントを行として持つ（`key` を `ticker + established_date` に変更）。

**推奨は (b)** — バックエンドで打ち切ると「なぜ出ないのか」が JSON を見ても分からなくなる。
UI 側の既定は「全件」なので、絞るかどうかは利用時に選べる。ただし成立から半年経った
銘柄が既定で並ぶことになるので、**既定の鮮度を PPP だけ変える**か検討が要る。
(c) は表の行数が跳ね上がるうえ、同じ銘柄が複数行に出る意味が薄い。

### 5.3 ATR 系列の共有先モジュール

§2.1 参照。`analysis/series.py` を新設するか、`n_pattern._atr_series` を公開名にするか。

---

## 6. 実装ステップ（推奨順序）

1. `analysis/ppp.py` — 状態機械と `detect_ppp`（純関数、単体テスト付き）
2. ATR 系列の共有（§5.3 の決定に従う）
3. `k` / `k_exit` の件数キャリブレーション（§5.1）。この時点で実データが要る
4. `screening_provider.run_scan` の 2 パターン対応 + パターン別 JSON 書き出し
5. `routes/screening.py` のパス一般化 + スキーマ追加
6. `screeningApi.ts` / `useScreening` のパターン対応
7. `ScreeningView` のタブ + `kanata.screening.pattern` 永続化
8. `PppTable`（または `ScreeningTable` のパターン分岐）
9. 増分測定（[ppp_incremental_measurement.md](ppp_incremental_measurement.md)）— リリースの前提条件ではない

---

## 7. 検証の立場

表示は検証を待たない。これは既存の立場と揃えたもので、N字もローソク足 14 種も
**否決された後で表示を続けている**（立場は中立な観察ツール）。PPP だけ「未検証」の
注記を付けると、検証済みで否決された N字より劣って見える逆転が起きる。

ただし CLAUDE.md の「**条件を 2 つ以上持つ検出器を足したら、条件ごとに分けて測ること**」
は PPP に直接かかる（並び + 乖離 `k` + ヒステリシス `k_exit`）。測定設計は
[ppp_incremental_measurement.md](ppp_incremental_measurement.md) に分離した。
