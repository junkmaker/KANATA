# マクロ指標: 米国債イールドカーブ（10年-2年）追加仕様

マクロダッシュボードに `t10y2y`（米10年債利回り − 米2年債利回り）を表示専用指標として 1 枚追加する。本書は設計判断とその根拠、および実装時の変更箇所を記録する。

- 対象: `backend/src/config/macro_thresholds.json` / `backend/src/services/macro_provider.py` / `backend/src/routes/macro.py` / `apps/renderer/src/components/Macro/*`
- 前提ドキュメント: [CLAUDE.md](../../CLAUDE.md)（マクロの規約）

---

## 1. 決定事項

| # | 論点 | 決定 | 主な理由 |
|---|---|---|---|
| 1 | 表示形態 | **スプレッドの時系列**（満期別カーブ図は作らない） | 既存の `IndicatorResponse.series` は `[{date, value}]` 固定。満期別カーブは横軸が満期になり契約に入らず、別 schema + 別チャート部品が必要になる |
| 2 | 系列 | **`T10Y2Y`**（10年-2年） | 予測力ではなく一貫性で選択。本アプリは「中立な観察ツール」の立場を採り勝率・期待値を UI に出さない方針のため、`T10Y3M` の予測力の優位は選択理由にならない。残る基準は「ユーザーが他の情報源で日常的に目にする数字と一致するか」 |
| 3 | シグナル | **水準の帯で判定**（`brent_wti` と同型） | イールドカーブは水準そのものに定義上の意味を持つ数少ない指標。0 は統計的に決めた閾値ではなく「短期金利 > 長期金利」という定義上の境界 |
| 4 | 総合シグナルへの寄与 | **なし（表示専用）** | `red_if_any_red: true` のため、逆イールド期間中（1〜2年続く）は総合が赤に固定される。中核3指標は「信用・流動性・幅」という一貫したレンズで選ばれており、金融政策サイクルは別レンズ |
| 5 | 基準線 | **0 のみ描画** | `MacroLineChart` は系列 min/max でオートスケールし軸ラベルもないため、0 線がないと符号が読めない。yellow 境界（+50bp）は仮置きの数値であり、実線化すると仮の値に見た目上の権威を与える |
| 6 | 単位 | **bp**（FRED の % を ×100） | `formatValue`/`formatChange` の `'bp'` 分岐をそのまま使え、レンダラーの書式コードを追加せずに済む。同じ「2つの利回りの差」である `hy_oas` と単位が揃う |
| 7 | 指標キー | **`t10y2y`** | 既存の指標キーは `rsp_spy` / `nikkei_topix` / `brent_wti` と「両脚の名前を並べる」規約。`yield_curve` は実体（1本のスプレッド）より名前が広く、将来 `t10y3m` を足すときに改名が必要になる |

### 派生する命名

| 対象 | 値 |
|---|---|
| エンドポイント | `GET /macro/t10y2y` |
| builder | `build_t10y2y(start, end, cfg)` |
| `TITLE` | `10年-2年` |
| `SUBTITLE` | `米国債スプレッド` |
| `lens` | `rates`（新設。ただし `lens` は `types.ts` に型があるだけで UI から参照されておらず実質メタデータ） |
| `meta.source` | `FRED` |

---

## 2. シグナル定義

`evaluate_signal` に `t10y2y` 分岐を追加する。水準のみを見る（直近 N 点の高値/安値は参照しない）。

| シグナル | 条件 |
|---|---|
| green | `latest > green_min_bp` |
| yellow | `0 <= latest <= green_min_bp` |
| red | `latest < 0`（逆イールド） |

`macro_thresholds.json` への追加:

```jsonc
"series": {
  "t10y2y": "T10Y2Y"
},
"thresholds": {
  "t10y2y": {
    "green_min_bp": 50.0,   // 仮置き。根拠となる検証は無い
    "red_max_bp": 0.0       // 定義上の境界（符号反転）
  }
}
```

**`green_min_bp: 50.0` は仮置きの値である。** 調整は本 JSON の編集のみで行うこと（CLAUDE.md「マクロの閾値をハードコードしない」）。

### 既知の性質（欠陥ではない）

逆イールドは一度入ると 1〜2 年継続する（直近では 2022年半ば〜2024年後半）。その間このカードは red に張り付き、`default_lookback_days: 730`（UI 最長表示 2Y）ではチャート全体がマイナス圏の平坦な線になる。**これは指標の故障ではなく事実の正しい反映**として受け入れる。表示専用（決定 #4）にしているため、総合シグナルは汚染されない。

### 採用しなかった案: 逆イールドの「解消」を red にする

「逆イールドそのものより再スティープ化の方が警戒すべき」という読み方は、「過去 N 日以内に逆イールドがあった」×「現在プラスに復帰」の **2 条件検出器**になる。CLAUDE.md の「条件を 2 つ以上持つ検出器を足したら、条件ごとに分けて測ること」に該当し、実装前に条件ごとの検証が必要になる。スコープが「カード 1 枚追加」から「バックテスト付き」に跳ね上がるため、本タスクからは切り出す。将来採用する場合は [candle_pattern_backtest.md](candle_pattern_backtest.md) と同じ扱い（条件分解して測る）を前提とすること。

---

## 3. 実装時の変更箇所

### バックエンド

- `config/macro_thresholds.json` — `series.t10y2y` と `thresholds.t10y2y` を追加
- `services/macro_provider.py`
  - `_THRESHOLD_TEXT` に `t10y2y` エントリ
  - `evaluate_signal` に `t10y2y` 分岐（水準判定）
  - `build_t10y2y` を追加。`build_hy_oas` と同型（FRED 単系列 → `×100` → 判定 → `_indicator`）。`MissingFredKey` は `_unavailable` に degrade
  - `build_dashboard` の **`extras` 側**に追加（`core` ではない）
- `routes/macro.py` — `get_t10y2y` を追加（他ルートと同じキャッシュ + 502 パターン）

### レンダラー

- `components/Macro/MacroCard.tsx`
  - `TITLE` / `SUBTITLE` に `t10y2y`
  - `thresholdLines` を渡す経路を新設。現状 `MacroLineChart` の `thresholdLines` prop は実装済みだがどこからも渡されていない。`t10y2y` のときだけ `[{ value: 0 }]` を渡す
  - `LOW_LINE_INDICATORS` には**追加しない**（安値線は上昇=良好かつ安値割れが red の指標用の補助線であり、水準判定の本指標では系列 min に判断上の意味がない）
  - `YFINANCE_INDICATORS` には**追加しない**（FRED 由来なので unavailable 時に `FRED_API_KEY` ヒントを出すのが正しい）
- `components/Macro/macroInfo.ts` — `t10y2y` エントリを `displayOnly: true` 付きで追加

`MacroLineChart` の `extraVals` に `thresholdLines` の値が入るため、0 を渡すだけで **y 軸レンジに 0 が必ず含まれる**（描画とスケーリングが同時に解決する）。チャート部品側の変更は不要。

### 既存テストの更新（ハードコードされた「6」）

| ファイル | 箇所 |
|---|---|
| `apps/renderer/src/__tests__/macroInfo.test.ts` | `EXPECTED_KEYS`（6→7）、テスト名「期待する6キー集合」、`displayOnly` 期待リスト（3→4） |
| `backend/tests/test_macro_api.py:155` | `assert len(body["indicators"]) == 6` → `== 7` |

`OVERALL_INFO.what` の「中核3指標」は**変更しない**（表示専用のため中核は3のままで、同ファイルの `toContain('中核3指標')` も維持される）。

### 追加するテスト

- `test_macro_provider.py` — `evaluate_signal('t10y2y', ...)` の green / yellow / red 境界（`-1bp` / `0bp` / `50bp` / `51bp`）
- `test_macro_provider.py` — `build_t10y2y` の単位変換（FRED の `0.53` → `53.0 bp`）
- `test_macro_api.py` — `FRED_API_KEY` 未設定時に `available: false` / `signal: "gray"` へ degrade し、ダッシュボード全体は 200 を返すこと

---

## 4. 未決事項

- `green_min_bp: 50.0` の妥当性（仮置き。検証していない）
- カードの並び順（`extras` 内での位置）
- `T10Y3M` の追加可否（今回は見送り。追加する場合はキー `t10y3m` で同型に並べる）
